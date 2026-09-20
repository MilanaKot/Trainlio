-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 16 — the coach roster
--
-- Contract: docs/DOMAIN_OPERATIONS.md.

-- ---------------------------------------------------------------------------
-- The roster a coach sees (UI_SPEC): who is booked, who booked them and when.
--
-- A function rather than a query, because of one row of the specification.
-- BR-092 says the coach may see who created a booking, but app_profiles is
-- readable only for your own profile or for visible workspace staff — a
-- guardian's profile is not readable by a coach, and deliberately so. Widening
-- that policy would let a coach read every guardian profile in the workspace
-- for any purpose; this returns the one name, in the one place the
-- specification asks for it.
-- ---------------------------------------------------------------------------

create or replace function public.session_roster(p_training_session_id uuid)
returns table (
  booking_id        uuid,
  athlete_id        uuid,
  first_name        text,
  last_name         text,
  birth_year        integer,
  position_code     text,
  stick_side_code   text,
  jersey_number     text,
  club_name         text,
  status            public.booking_status,
  created_by_role   public.booking_creator_role,
  booked_by_name    text,
  booked_at         timestamptz,
  capacity_override boolean,
  cancelled_at      timestamptz,
  cancellation_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    a.id,
    a.first_name,
    a.last_name,
    extract(year from a.date_of_birth)::int,
    asp.attributes ->> 'position',
    asp.attributes ->> 'stick_side',
    asp.jersey_number,
    asp.club_name,
    b.status,
    b.created_by_role,
    booker.display_name,
    b.created_at,
    b.coach_capacity_override,
    b.cancelled_at,
    b.cancellation_reason
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.athletes a on a.id = b.athlete_id
  left join public.app_profiles booker on booker.id = b.created_by
  left join public.athlete_sport_profiles asp
    on asp.athlete_id = a.id and asp.sport_id = s.sport_id
  where b.training_session_id = p_training_session_id
    -- The only authorization in this function, and it is the same predicate the
    -- row policies use.
    and public.is_workspace_coach(s.workspace_id)
  order by b.status, a.first_name, a.last_name;
$$;

revoke all on function public.session_roster(uuid) from public;
grant execute on function public.session_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Athletes a coach may add to a session: everyone active in the workspace, with
-- the server's own verdict on each.
--
-- Returns the ineligible ones too, with their reason, unlike the guardian
-- picker. A coach adding a child needs to know why a name is unavailable —
-- "wrong birth year" and "already booked" call for different actions.
-- ---------------------------------------------------------------------------

create or replace function public.coach_session_candidates(p_training_session_id uuid)
returns table (
  athlete_id      uuid,
  first_name      text,
  last_name       text,
  birth_year      integer,
  position_code   text,
  eligibility     text,
  booking_status  public.booking_status,
  can_add         boolean
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
    extract(year from a.date_of_birth)::int,
    asp.attributes ->> 'position',
    public.athlete_eligibility_for_session(p_training_session_id, a.id),
    latest.status,
    public.athlete_eligibility_for_session(p_training_session_id, a.id) = 'ELIGIBLE'
      and coalesce(latest.status, 'CANCELLED_BY_USER') <> 'CONFIRMED'
  from public.training_sessions s
  join public.workspace_athlete_memberships m
    on m.workspace_id = s.workspace_id and m.is_active
  join public.athletes a on a.id = m.athlete_id
  left join public.athlete_sport_profiles asp
    on asp.id = m.athlete_sport_profile_id
  left join lateral (
    select b.status
    from public.bookings b
    where b.training_session_id = p_training_session_id
      and b.athlete_id = a.id
    order by b.created_at desc, b.id desc
    limit 1
  ) latest on true
  where s.id = p_training_session_id
    and public.is_workspace_coach(s.workspace_id)
  order by a.first_name, a.last_name;
$$;

revoke all on function public.coach_session_candidates(uuid) from public;
grant execute on function public.coach_session_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Coach manual booking. One athlete per call.
--
-- Differs from the guardian path in exactly the ways the specification says,
-- and no others:
--
--   * capacity may be exceeded, but only on an explicit confirmation, and the
--     override is recorded on the booking and in the audit log (BR-033, BR-034);
--   * the coach-removal block does not apply — this is how a coach puts back an
--     athlete they removed (D-06);
--   * a closed, draft or completed session still accepts an addition; only a
--     cancelled one does not (D-07).
--
-- Eligibility still applies (PRD §10: "may add eligible managed athletes").
-- Capacity is the only rule a coach overrides.
-- ---------------------------------------------------------------------------

create or replace function public.book_athlete_as_coach(
  p_training_session_id   uuid,
  p_athlete_id            uuid,
  p_confirm_over_capacity boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.current_profile_id();
  v_session    record;
  v_confirmed  integer;
  v_reason     text;
  v_override   boolean;
  v_booking_id uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  -- Same serialization point as every other path that reads the count.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = p_training_session_id
   for update;

  select * into v_session from public.training_sessions s where s.id = p_training_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  v_reason := public.athlete_eligibility_for_session(p_training_session_id, p_athlete_id);
  if v_reason <> 'ELIGIBLE' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE',
      'details', jsonb_build_object('athlete_id', p_athlete_id, 'reason', v_reason));
  end if;

  if exists (
    select 1 from public.bookings b
    where b.training_session_id = p_training_session_id
      and b.athlete_id = p_athlete_id
      and b.status = 'CONFIRMED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_BOOKED');
  end if;

  select o.confirmed_count into v_confirmed
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  v_override := coalesce(v_confirmed, 0) >= v_session.capacity;

  -- AC-050. The warning is a server-side gate: without the confirmation the
  -- addition is refused, and the counts come back so the UI can show
  -- "Trénink je již plný (10 / 10)".
  if v_override and not p_confirm_over_capacity then
    return jsonb_build_object('ok', false, 'code', 'WOULD_EXCEED_CAPACITY',
      'details', jsonb_build_object(
        'capacity', v_session.capacity,
        'confirmed_count', coalesce(v_confirmed, 0)));
  end if;

  insert into public.bookings
    (training_session_id, athlete_id, status, created_by, created_by_role, coach_capacity_override)
  values
    (p_training_session_id, p_athlete_id, 'CONFIRMED', v_actor, 'COACH', v_override)
  returning id into v_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CREATED_BY_COACH', 'BOOKING', v_booking_id,
     jsonb_build_object('training_session_id', p_training_session_id, 'athlete_id', p_athlete_id));

  -- BR-034: an override is explicit and auditable, as its own entry rather than
  -- a flag buried in the booking's.
  if v_override then
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
    values
      (v_session.workspace_id, v_actor, 'BOOKING_CAPACITY_OVERRIDDEN', 'BOOKING', v_booking_id,
       jsonb_build_object('capacity', v_session.capacity,
                          'confirmed_before', coalesce(v_confirmed, 0),
                          'confirmed_after', coalesce(v_confirmed, 0) + 1));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'booking_id', v_booking_id,
    'capacity_override', v_override
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Coach removal. No deadline (BR-042, AC-042).
--
-- This is what makes guardian_rebooking_blocked true for the athlete and
-- session, so a parent cannot quietly undo it (D-06). Only a coach can put the
-- athlete back.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking_as_coach(
  p_booking_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_booking record;
  v_session record;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  perform 1 from public.training_session_occupancy o
   where o.training_session_id = v_booking.training_session_id
   for update;

  select * into v_session
  from public.training_sessions s where s.id = v_booking.training_session_id;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  update public.bookings b
     set status = 'CANCELLED_BY_COACH',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CANCELLED_BY_COACH', 'BOOKING', p_booking_id,
     jsonb_build_object('status', 'CONFIRMED'),
     jsonb_build_object('status', 'CANCELLED_BY_COACH'),
     jsonb_build_object('athlete_id', v_booking.athlete_id,
                        'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.book_athlete_as_coach(uuid, uuid, boolean)',
    'public.cancel_booking_as_coach(uuid, text)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
