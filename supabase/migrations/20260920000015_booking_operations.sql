-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 15 — the booking engine
--
-- Contract: docs/DOMAIN_OPERATIONS.md.
--
-- Guardians hold no INSERT or UPDATE grant on public.bookings. This file is the
-- only way a booking is created or cancelled, which is what makes capacity, the
-- cancellation deadline, eligibility and the coach-removal rule impossible to
-- bypass from a client.

-- ---------------------------------------------------------------------------
-- The picker's data source.
--
-- One call instead of one per child, and the eligibility rule stays on the
-- server: the list a parent sees is produced by the same function the booking
-- path consults, so the UI cannot offer a child the write would refuse.
-- ---------------------------------------------------------------------------

create or replace function public.guardian_session_athletes(p_training_session_id uuid)
returns table (
  athlete_id     uuid,
  first_name     text,
  last_name      text,
  date_of_birth  date,
  eligibility    text,
  booking_status public.booking_status,
  removed_by_coach boolean,
  can_book       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.first_name,
    a.last_name,
    a.date_of_birth,
    public.athlete_eligibility_for_session(p_training_session_id, a.id),
    latest.status,
    public.guardian_rebooking_blocked(p_training_session_id, a.id),
    public.athlete_eligibility_for_session(p_training_session_id, a.id) = 'ELIGIBLE'
      and coalesce(latest.status, 'CANCELLED_BY_USER') <> 'CONFIRMED'
      and not public.guardian_rebooking_blocked(p_training_session_id, a.id)
  from public.athletes a
  join public.guardian_athlete_access g
    on g.athlete_id = a.id
   and g.profile_id = public.current_profile_id()
   and g.status = 'ACTIVE'
   and g.permission_level = 'MANAGE'
  left join lateral (
    select b.status
    from public.bookings b
    where b.training_session_id = p_training_session_id
      and b.athlete_id = a.id
    order by b.created_at desc, b.id desc
    limit 1
  ) latest on true
  order by a.first_name, a.last_name;
$$;

revoke all on function public.guardian_session_athletes(uuid) from public;
grant execute on function public.guardian_session_athletes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardian booking. Atomic across every selected athlete (D-05).
--
-- Partial success is refused on purpose: one confirmation must not leave one
-- sibling booked and another not. The parent is told how many places remain and
-- reduces the selection themselves.
--
-- Nothing is written before the final loop, so a rejection leaves no row behind
-- without depending on a rollback to undo it.
-- ---------------------------------------------------------------------------

create or replace function public.book_athletes_as_guardian(
  p_training_session_id uuid,
  p_athlete_ids         uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := public.current_profile_id();
  v_session     record;
  v_confirmed   integer;
  v_available   integer;
  v_requested   integer;
  v_athlete     uuid;
  v_reason      text;
  v_ineligible  jsonb := '[]'::jsonb;
  v_booking_id  uuid;
  v_ids         uuid[] := '{}';
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if p_athlete_ids is null or array_length(p_athlete_ids, 1) is null then
    return jsonb_build_object('ok', false, 'code', 'EMPTY_SELECTION');
  end if;

  v_requested := array_length(p_athlete_ids, 1);

  -- A duplicated id would otherwise consume two places for one child and then
  -- fail on the unique index, after the capacity check had already passed.
  if v_requested <> (select count(distinct x) from unnest(p_athlete_ids) x) then
    return jsonb_build_object('ok', false, 'code', 'DUPLICATE_ATHLETE_IN_REQUEST');
  end if;

  -- THE serialization point. Everything that reads or changes the confirmed
  -- count takes this row first, so no booking can land between the capacity
  -- check below and the inserts at the end (BR-032, AC-022).
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = p_training_session_id
   for update;

  -- Re-read AFTER the lock. Reading before it would be reading a state another
  -- transaction may still be changing.
  select * into v_session
  from public.training_sessions s
  where s.id = p_training_session_id;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if v_session.status <> 'OPEN' then
    return jsonb_build_object('ok', false, 'code',
      case when v_session.status = 'CANCELLED' then 'SESSION_CANCELLED' else 'SESSION_NOT_OPEN' end);
  end if;

  -- PRD §10: bookable until the session starts, not until some earlier cutoff.
  if now() >= v_session.start_at then
    return jsonb_build_object('ok', false, 'code', 'SESSION_ALREADY_STARTED');
  end if;

  foreach v_athlete in array p_athlete_ids loop
    if not public.has_athlete_manage_access(v_athlete) then
      return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
    end if;

    v_reason := public.athlete_eligibility_for_session(p_training_session_id, v_athlete);
    if v_reason <> 'ELIGIBLE' then
      v_ineligible := v_ineligible || jsonb_build_object('athlete_id', v_athlete, 'reason', v_reason);
    end if;

    if exists (
      select 1 from public.bookings b
      where b.training_session_id = p_training_session_id
        and b.athlete_id = v_athlete
        and b.status = 'CONFIRMED'
    ) then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_BOOKED',
        'details', jsonb_build_object('athlete_id', v_athlete));
    end if;

    -- D-06: a coach's removal is not something a parent can undo.
    if public.guardian_rebooking_blocked(p_training_session_id, v_athlete) then
      return jsonb_build_object('ok', false, 'code', 'REMOVED_BY_COACH',
        'details', jsonb_build_object('athlete_id', v_athlete));
    end if;
  end loop;

  if jsonb_array_length(v_ineligible) > 0 then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE',
      'details', jsonb_build_object('athletes', v_ineligible));
  end if;

  select o.confirmed_count into v_confirmed
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  v_available := greatest(v_session.capacity - coalesce(v_confirmed, 0), 0);

  -- D-05. The whole selection is refused, and the parent is told how many
  -- places remain so they can choose which child to book.
  if v_requested > v_available then
    return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CAPACITY',
      'details', jsonb_build_object(
        'requested', v_requested,
        'available_places', v_available,
        'capacity', v_session.capacity,
        'confirmed_count', coalesce(v_confirmed, 0)));
  end if;

  foreach v_athlete in array p_athlete_ids loop
    insert into public.bookings
      (training_session_id, athlete_id, status, created_by, created_by_role, coach_capacity_override)
    values
      (p_training_session_id, v_athlete, 'CONFIRMED', v_actor, 'USER', false)
    returning id into v_booking_id;

    v_ids := v_ids || v_booking_id;

    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
    values
      (v_session.workspace_id, v_actor, 'BOOKING_CREATED_BY_GUARDIAN', 'BOOKING', v_booking_id,
       jsonb_build_object('training_session_id', p_training_session_id, 'athlete_id', v_athlete));
  end loop;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'booking_ids', to_jsonb(v_ids),
    'booked_count', v_requested
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Guardian cancellation.
--
-- The deadline is computed here, from the session's own start time and the
-- workspace's own setting, on database time. A client-supplied indication that
-- cancellation is allowed is never read (PERMISSIONS).
--
-- D-09: this path never consults athletes.is_active. A deactivated athlete's
-- guardian must still be able to cancel the booking the athlete already holds,
-- or deactivation would strand the family.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking_as_guardian(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_booking  record;
  v_session  record;
  v_deadline integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  -- Cancelling changes the confirmed count, so it takes the same lock as
  -- booking does.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = v_booking.training_session_id
   for update;

  select * into v_session
  from public.training_sessions s
  where s.id = v_booking.training_session_id;

  if not public.has_athlete_manage_access(v_booking.athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  -- The session's own cancellation carries it; there is nothing for a guardian
  -- to withdraw from a session that no longer happens.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  select w.cancellation_deadline_hours into v_deadline
  from public.workspaces w where w.id = v_session.workspace_id;

  -- D-02, decided: allowed at exactly the deadline.
  --   12:00:01 before start -> allowed
  --   12:00:00 before start -> allowed
  --   11:59:59 before start -> blocked
  if now() > v_session.start_at - make_interval(hours => v_deadline) then
    return jsonb_build_object('ok', false, 'code', 'CANCELLATION_DEADLINE_PASSED',
      'details', jsonb_build_object('deadline_hours', v_deadline));
  end if;

  update public.bookings b
     set status = 'CANCELLED_BY_USER',
         cancelled_at = now(),
         cancelled_by = v_actor
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CANCELLED_BY_GUARDIAN', 'BOOKING', p_booking_id,
     jsonb_build_object('status', 'CONFIRMED'),
     jsonb_build_object('status', 'CANCELLED_BY_USER'));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.book_athletes_as_guardian(uuid, uuid[])',
    'public.cancel_booking_as_guardian(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
