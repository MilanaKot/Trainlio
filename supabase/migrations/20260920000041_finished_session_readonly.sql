-- ---------------------------------------------------------------------------
-- A finished training is read-only.
--
-- Once a training's end_at has passed, it is a record: who was booked, where,
-- and when. Editing it, closing or reopening its registration, cancelling it,
-- adding an athlete to it or removing one from it would each rewrite that
-- record — and most of them would also e-mail the families about a training
-- that is already over. The coach's screen offers none of these for a past
-- training (§K6b's copy is the only action left); this is the same rule where
-- it cannot be skipped (CLAUDE.md principles 3 and 5).
--
-- "Finished" is end_at < now(), the rule that already files a training under
-- `Minulé` (listCoachSessions). A training in progress is not finished: a
-- coach may still add the athlete who turned up late.
--
-- Guardians were already stopped at the start (book_athletes_as_guardian,
-- cancel_own_booking); this covers the five staff operations. Each function is
-- restated whole from its latest migration with one block added, right after
-- the existing cancelled check (cancel_booking_as_coach has none; there it
-- follows the authorization check). Nothing else changes. The new refusal code
-- is SESSION_FINISHED.
--
-- duplicate_training_session is deliberately untouched: copying a past
-- training is exactly what the screen offers.
-- ---------------------------------------------------------------------------

-- update_training_session, restated from migration 34.
create or replace function public.update_training_session(
  p_training_session_id         uuid,
  p_local_date                  date,
  p_local_start_time            time,
  p_local_end_time              time,
  p_facility_id                 uuid,
  p_capacity                    integer,
  p_eligibility_mode            public.eligibility_mode,
  p_birth_year_from             integer default null,
  p_birth_year_to               integer default null,
  p_changing_room               text default null,
  p_public_notes                text default null,
  p_internal_notes              text default null,
  p_main_coach_profile_id       uuid default null,
  p_confirm_over_capacity       boolean default false,
  p_confirm_ineligible_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := public.current_profile_id();
  v_session      record;
  v_timezone     text;
  v_location_id  uuid;
  v_coach        uuid;
  v_start        timestamptz;
  v_end          timestamptz;
  v_confirmed    integer;
  v_affected     uuid[];
  v_significant  boolean := false;
  -- text[]: each append casts explicitly, because an untyped literal on the
  -- right of || is parsed as an array literal rather than as one element.
  v_events       text[] := '{}';
  v_event_id     uuid;
  v_change       jsonb;
  v_changing     text := nullif(btrim(coalesce(p_changing_room, '')), '');
  v_public       text := nullif(btrim(coalesce(p_public_notes, '')), '');
  v_internal     text := nullif(btrim(coalesce(p_internal_notes, '')), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session from public.training_sessions s where s.id = p_training_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- D-07: a cancelled session is terminal. Nothing about it may be edited,
  -- because its cancellation emails may already have gone out.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  -- The single serialization point. Taken before reading the confirmed count,
  -- so a booking cannot land between the capacity check and the write.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = p_training_session_id for update;

  select o.confirmed_count into v_confirmed
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  select w.timezone into v_timezone from public.workspaces w where w.id = v_session.workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, v_session.workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  v_start := (p_local_date + p_local_start_time) at time zone v_timezone;
  v_end   := (p_local_date + p_local_end_time)   at time zone v_timezone;
  v_coach := coalesce(p_main_coach_profile_id, v_session.main_coach_profile_id);

  -- BR-051 / AC-051. The warning is a server-side gate, not a dialog: without
  -- the flag the change is refused, and the count is returned so the UI can say
  -- how many are already booked. Existing bookings are preserved either way.
  if p_capacity < v_confirmed and not p_confirm_over_capacity then
    return jsonb_build_object('ok', false, 'code', 'CAPACITY_BELOW_OCCUPANCY',
      'details', jsonb_build_object('confirmed_count', v_confirmed, 'requested_capacity', p_capacity));
  end if;

  -- D-08. Narrowing never auto-cancels. The coach is told how many confirmed
  -- bookings would fall outside the new range and must confirm.
  if p_eligibility_mode = 'BIRTH_YEAR_RANGE' then
    select array_agg(x) into v_affected
    from public.bookings_outside_birth_year_range(p_training_session_id, p_birth_year_from, p_birth_year_to) x;
  end if;

  if v_affected is not null and array_length(v_affected, 1) > 0 and not p_confirm_ineligible_bookings then
    return jsonb_build_object('ok', false, 'code', 'BOOKINGS_WOULD_BECOME_INELIGIBLE',
      'details', jsonb_build_object('affected_count', array_length(v_affected, 1)));
  end if;

  -- D-11: significance is date, start, end, location, facility and main coach.
  -- Not capacity, changing room, notes or assistant coaches.
  if v_session.start_at is distinct from v_start or v_session.end_at is distinct from v_end then
    v_significant := true;
    v_events := v_events || 'SESSION_SCHEDULE_CHANGED'::text;
  end if;
  if v_session.location_id is distinct from v_location_id then
    v_significant := true;
    v_events := v_events || 'SESSION_LOCATION_CHANGED'::text;
  end if;
  if v_session.facility_id is distinct from p_facility_id then
    v_significant := true;
    v_events := v_events || 'SESSION_FACILITY_CHANGED'::text;
  end if;
  if v_session.main_coach_profile_id is distinct from v_coach then
    v_significant := true;
    v_events := v_events || 'SESSION_MAIN_COACH_CHANGED'::text;
  end if;

  begin
    update public.training_sessions s
       set start_at         = v_start,
           end_at           = v_end,
           location_id      = v_location_id,
           facility_id      = p_facility_id,
           capacity         = p_capacity,
           eligibility_mode = p_eligibility_mode,
           birth_year_from  = case when p_eligibility_mode = 'BIRTH_YEAR_RANGE' then p_birth_year_from end,
           birth_year_to    = case when p_eligibility_mode = 'BIRTH_YEAR_RANGE' then p_birth_year_to end,
           changing_room    = v_changing,
           public_notes     = v_public,
           significant_changed_at =
             case when v_significant then now() else s.significant_changed_at end
     where s.id = p_training_session_id;

    if v_session.main_coach_profile_id is distinct from v_coach then
      -- The association table is canonical; the mirror column follows by
      -- trigger, so only this row is written.
      update public.training_session_coaches c
         set profile_id = v_coach
       where c.training_session_id = p_training_session_id and c.role = 'MAIN';
    end if;

    if v_internal is null then
      delete from public.training_session_internal_notes n
       where n.training_session_id = p_training_session_id;
    else
      insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
      values (p_training_session_id, v_internal, v_actor)
      on conflict (training_session_id) do update
        set notes = excluded.notes, updated_by = excluded.updated_by;
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  -- One event per save, not one per field (EMAILS.md §2): a coach who moves a
  -- training and changes the hall in one go sends one e-mail with both rows
  -- highlighted, not two e-mails a minute apart.
  --
  -- The event type is still the specific one when a single thing changed, so
  -- the subject can say `Změna haly` rather than `Změna tréninku`; several
  -- changes take SESSION_CHANGED, which is the label the design gives that case.
  --
  -- What moved comes from `significant_change`, read back after both update
  -- statements above. It is computed by the trigger of migration 28 and holds
  -- the guardian-visible previous values — the same record the card and the
  -- booking screen draw, so the e-mail cannot disagree with the app about what
  -- the training used to be. Read back rather than recomputed here: the main
  -- coach moves in a second statement, and a comparison in this function would
  -- miss it (migration 28 says why).
  if array_length(v_events, 1) is not null then
    select s.significant_change into v_change
    from public.training_sessions s where s.id = p_training_session_id;

    insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
    values (
      v_session.workspace_id,
      p_training_session_id,
      case when array_length(v_events, 1) = 1 then v_events[1] else 'SESSION_CHANGED' end,
      jsonb_strip_nulls(jsonb_build_object(
        'start_at', v_start,
        'end_at', v_end,
        'facility_id', p_facility_id,
        'actor_profile_id', v_actor,
        'change', v_change)));
  end if;

  -- D-08: the affected bookings are stamped individually, and their guardians
  -- alone are notified. A session-level marker would flag every booked family.
  if v_affected is not null and array_length(v_affected, 1) > 0 then
    update public.bookings b
       set eligibility_narrowed_at = now()
     where b.training_session_id = p_training_session_id
       and b.status = 'CONFIRMED'
       and b.athlete_id = any(v_affected);

    insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
    values (v_session.workspace_id, p_training_session_id, 'SESSION_ELIGIBILITY_NARROWED',
            jsonb_strip_nulls(jsonb_build_object(
              'affected_athlete_ids', to_jsonb(v_affected),
              'birth_year_from', p_birth_year_from,
              'birth_year_to', p_birth_year_to,
              -- E06 prints the range that was, struck through, under the one
              -- that is.
              'previous_birth_year_from', v_session.birth_year_from,
              'previous_birth_year_to', v_session.birth_year_to,
              'previous_eligibility_mode', v_session.eligibility_mode,
              'actor_profile_id', v_actor)))
    returning id into v_event_id;

    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
    values (v_session.workspace_id, v_actor, 'SESSION_ELIGIBILITY_NARROWED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('birth_year_from', v_session.birth_year_from, 'birth_year_to', v_session.birth_year_to),
            jsonb_build_object('birth_year_from', p_birth_year_from, 'birth_year_to', p_birth_year_to),
            jsonb_build_object('affected_athlete_ids', to_jsonb(v_affected)));
  end if;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values (v_session.workspace_id, v_actor, 'SESSION_UPDATED', 'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('start_at', v_session.start_at, 'end_at', v_session.end_at,
                             'facility_id', v_session.facility_id, 'capacity', v_session.capacity,
                             'main_coach_profile_id', v_session.main_coach_profile_id),
          jsonb_build_object('start_at', v_start, 'end_at', v_end,
                             'facility_id', p_facility_id, 'capacity', p_capacity,
                             'main_coach_profile_id', v_coach),
          jsonb_build_object('significant', v_significant, 'events', to_jsonb(v_events)));

  if v_session.capacity is distinct from p_capacity then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (v_session.workspace_id, v_actor, 'SESSION_CAPACITY_CHANGED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('capacity', v_session.capacity, 'confirmed_count', v_confirmed),
            jsonb_build_object('capacity', p_capacity));
  end if;

  if v_session.main_coach_profile_id is distinct from v_coach then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (v_session.workspace_id, v_actor, 'SESSION_MAIN_COACH_CHANGED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('main_coach_profile_id', v_session.main_coach_profile_id),
            jsonb_build_object('main_coach_profile_id', v_coach));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'training_session_id', p_training_session_id,
    'significant', v_significant,
    'events', to_jsonb(v_events),
    'affected_athlete_count', coalesce(array_length(v_affected, 1), 0)
  ));
end;
$$;

-- set_session_booking_state, restated from migration 13.
create or replace function public.set_session_booking_state(
  p_training_session_id uuid,
  p_open                boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_new     public.session_status;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session from public.training_sessions s where s.id = p_training_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- D-07. Reopening a cancelled session is refused here and by trigger.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  v_new := case when p_open then 'OPEN' else 'CLOSED' end;

  update public.training_sessions s set status = v_new where s.id = p_training_session_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (v_session.workspace_id, v_actor,
          case when p_open then 'SESSION_BOOKING_REOPENED' else 'SESSION_BOOKING_CLOSED' end,
          'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('status', v_session.status),
          jsonb_build_object('status', v_new));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('status', v_new));
end;
$$;

-- cancel_training_session, restated from migration 13.
create or replace function public.cancel_training_session(
  p_training_session_id uuid,
  p_reason              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_booked  integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

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

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  select o.confirmed_count into v_booked
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  update public.training_sessions s
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_actor
   where s.id = p_training_session_id;

  -- BR-072/073: one event, expanded into one delivery per guardian by the
  -- drain job, each naming that guardian's own affected athletes.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, p_training_session_id, 'SESSION_CANCELLED',
          jsonb_build_object('start_at', v_session.start_at, 'end_at', v_session.end_at,
                             'facility_id', v_session.facility_id,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values (v_session.workspace_id, v_actor, 'SESSION_CANCELLED', 'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('status', v_session.status),
          jsonb_build_object('status', 'CANCELLED'),
          jsonb_build_object('confirmed_at_cancellation', v_booked,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'training_session_id', p_training_session_id,
    'confirmed_at_cancellation', v_booked
  ));
end;
$$;

-- book_athlete_as_coach, restated from migration 34.
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

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
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

  -- DR-12, E08: the parent is told. Not for their own bookings — this function
  -- is the coach's path, and a parent who just booked does not need an e-mail
  -- about it (EMAILS.md §4).
  --
  -- Raised for an over-capacity addition too: that the coach had to override
  -- the limit is their business, and the parent's business is that their child
  -- is on the training and until when they may undo it.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, p_training_session_id, 'BOOKING_ADDED_BY_COACH',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(p_athlete_id),
            'actor_profile_id', v_actor));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'booking_id', v_booking_id,
    'capacity_override', v_override
  ));
end;
$$;

-- cancel_booking_as_coach, restated from migration 34.
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
  v_message text := nullif(btrim(coalesce(p_reason, '')), '');
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

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  -- The form limits this too; a caller that is not the form does not.
  if length(coalesce(v_message, '')) > 200 then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_TOO_LONG');
  end if;

  update public.bookings b
     set status = 'CANCELLED_BY_COACH',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = v_message
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CANCELLED_BY_COACH', 'BOOKING', p_booking_id,
     jsonb_build_object('status', 'CONFIRMED'),
     jsonb_build_object('status', 'CANCELLED_BY_COACH'),
     jsonb_build_object('athlete_id', v_booking.athlete_id, 'reason', v_message));

  -- The parent drives to the rink otherwise.
  --
  -- `actor_profile_id` is new in migration 34: E07 names the coach who removed
  -- the athlete and prints their number, because D-06 leaves ringing them as the
  -- only thing the parent can do.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, v_booking.training_session_id, 'BOOKING_REMOVED_BY_COACH',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(v_booking.athlete_id),
            'actor_profile_id', v_actor,
            'reason', v_message));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;
