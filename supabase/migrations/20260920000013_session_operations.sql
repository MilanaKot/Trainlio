-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 13 — coach session management
--
-- Contract: docs/DOMAIN_OPERATIONS.md.
--
-- These are the only path that may write a session. Coaches hold no UPDATE
-- policy on training_sessions precisely so that the significant-change marker,
-- the notification outbox row and the audit entry are produced in the same
-- transaction as the change they describe. A direct table write could move a
-- session without the email that D-11 requires.
--
-- Times are given as workspace-local wall clock and converted here. The client
-- never does timezone arithmetic: a coach types 09:00 and means 09:00 in
-- Příbram, whatever the device or the server thinks the hour is.

-- ---------------------------------------------------------------------------
-- Shared helper: resolve a facility to its location and validate the workspace.
-- A session stores both, and the composite foreign keys require them to agree;
-- deriving the location from the facility means they cannot disagree.
-- ---------------------------------------------------------------------------

create or replace function public.facility_location_for_workspace(
  p_facility_id  uuid,
  p_workspace_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.facilities f
  join public.locations l on l.id = f.location_id
  where f.id = p_facility_id
    and l.workspace_id = p_workspace_id
    and f.is_active
    and l.is_active;
$$;

revoke all on function public.facility_location_for_workspace(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------

create or replace function public.create_training_session(
  p_workspace_id          uuid,
  p_local_date            date,
  p_local_start_time      time,
  p_local_end_time        time,
  p_facility_id           uuid,
  p_capacity              integer default 10,
  p_eligibility_mode      public.eligibility_mode default 'ALL',
  p_birth_year_from       integer default null,
  p_birth_year_to         integer default null,
  p_changing_room         text default null,
  p_public_notes          text default null,
  p_internal_notes        text default null,
  p_main_coach_profile_id uuid default null,
  p_status                public.session_status default 'OPEN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := public.current_profile_id();
  v_timezone    text;
  v_location_id uuid;
  v_coach       uuid;
  v_session_id  uuid;
  v_start       timestamptz;
  v_end         timestamptz;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_status not in ('DRAFT', 'OPEN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_STATUS');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, p_workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  -- Converted from the workspace's wall clock, one occurrence at a time. The
  -- same rule that keeps a recurring series on 09:00 across a DST boundary.
  v_start := (p_local_date + p_local_start_time) at time zone v_timezone;
  v_end   := (p_local_date + p_local_end_time)   at time zone v_timezone;

  v_coach := coalesce(p_main_coach_profile_id, v_actor);

  begin
    insert into public.training_sessions (
      workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
      start_at, end_at, changing_room, capacity,
      eligibility_mode, birth_year_from, birth_year_to,
      status, public_notes, created_by
    )
    select p_workspace_id, w.primary_sport_id, v_location_id, p_facility_id, v_coach,
           v_start, v_end, nullif(btrim(coalesce(p_changing_room, '')), ''), p_capacity,
           p_eligibility_mode, p_birth_year_from, p_birth_year_to,
           p_status, nullif(btrim(coalesce(p_public_notes, '')), ''), v_actor
    from public.workspaces w
    where w.id = p_workspace_id
    returning id into v_session_id;

    insert into public.training_session_coaches (training_session_id, profile_id, role)
    values (v_session_id, v_coach, 'MAIN');

    if nullif(btrim(coalesce(p_internal_notes, '')), '') is not null then
      insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
      values (v_session_id, btrim(p_internal_notes), v_actor);
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values (p_workspace_id, v_actor, 'SESSION_CREATED', 'TRAINING_SESSION', v_session_id,
          jsonb_build_object('start_at', v_start, 'end_at', v_end, 'capacity', p_capacity,
                             'status', p_status, 'facility_id', p_facility_id));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('training_session_id', v_session_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Update. A full replace, not a patch: the coach sees and submits the whole
-- session, so there is no ambiguity between "unchanged" and "cleared" — which
-- matters for changing_room and the notes fields, whose empty value is null.
-- ---------------------------------------------------------------------------

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
  v_event        text;
  v_event_id     uuid;
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

  -- One outbox event per significant change, so the drain job can compose a
  -- message that names what moved.
  foreach v_event in array v_events loop
    insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
    values (v_session.workspace_id, p_training_session_id, v_event,
            jsonb_build_object('start_at', v_start, 'end_at', v_end, 'facility_id', p_facility_id));
  end loop;

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
            jsonb_build_object('affected_athlete_ids', to_jsonb(v_affected),
                               'birth_year_from', p_birth_year_from,
                               'birth_year_to', p_birth_year_to))
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

-- ---------------------------------------------------------------------------
-- Close and reopen booking (BR-024). Independent of capacity: a coach may close
-- a half-empty session, and reopen one, for reasons the system does not model.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Cancel (D-07). Terminal.
--
-- Bookings are deliberately NOT modified: they stay CONFIRMED so the roster of
-- who was booked at the moment of cancellation is preserved (BR-071), and the
-- session's own status carries the cancellation into My Bookings. Occupancy is
-- therefore unchanged, which is right — it describes the session, not its
-- validity.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Duplicate.
--
-- Copies configuration and the coach roster. Never copies bookings, series_id,
-- significant_changed_at or the cancellation columns — the new session is
-- independent and has its own history from this moment.
--
-- This is also the supported recovery from a mistaken cancellation (D-07),
-- which is why it accepts a cancelled session as the source.
-- ---------------------------------------------------------------------------

create or replace function public.duplicate_training_session(
  p_training_session_id uuid,
  p_local_date          date,
  p_local_start_time    time default null,
  p_local_end_time      time default null,
  p_status              public.session_status default 'OPEN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_source   record;
  v_timezone text;
  v_new_id   uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_start_t  time;
  v_end_t    time;
  v_notes    text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_source from public.training_sessions s where s.id = p_training_session_id;
  if v_source.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_source.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_status not in ('DRAFT', 'OPEN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_STATUS');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = v_source.workspace_id;

  -- Times default to the source's own wall-clock times in the workspace zone,
  -- not to the same instant: duplicating a 09:00 session onto a date after a
  -- daylight-saving change must still produce 09:00.
  v_start_t := coalesce(p_local_start_time, (v_source.start_at at time zone v_timezone)::time);
  v_end_t   := coalesce(p_local_end_time,   (v_source.end_at   at time zone v_timezone)::time);

  if v_end_t <= v_start_t then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  v_start := (p_local_date + v_start_t) at time zone v_timezone;
  v_end   := (p_local_date + v_end_t)   at time zone v_timezone;

  insert into public.training_sessions (
    workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
    start_at, end_at, changing_room, capacity,
    eligibility_mode, birth_year_from, birth_year_to,
    status, public_notes, created_by
  )
  values (
    v_source.workspace_id, v_source.sport_id, v_source.location_id, v_source.facility_id,
    v_source.main_coach_profile_id, v_start, v_end, v_source.changing_room, v_source.capacity,
    v_source.eligibility_mode, v_source.birth_year_from, v_source.birth_year_to,
    p_status, v_source.public_notes, v_actor
  )
  returning id into v_new_id;

  -- The whole coach roster, assistants included.
  insert into public.training_session_coaches (training_session_id, profile_id, role)
  select v_new_id, c.profile_id, c.role
  from public.training_session_coaches c
  where c.training_session_id = p_training_session_id
  on conflict do nothing;

  select n.notes into v_notes
  from public.training_session_internal_notes n
  where n.training_session_id = p_training_session_id;

  if v_notes is not null then
    insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
    values (v_new_id, v_notes, v_actor);
  end if;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, after, metadata)
  values (v_source.workspace_id, v_actor, 'SESSION_DUPLICATED', 'TRAINING_SESSION', v_new_id,
          jsonb_build_object('start_at', v_start, 'end_at', v_end, 'status', p_status),
          jsonb_build_object('source_training_session_id', p_training_session_id));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('training_session_id', v_new_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Explicit EXECUTE privileges.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_training_session(uuid, date, time, time, uuid, integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status)',
    'public.update_training_session(uuid, date, time, time, uuid, integer, public.eligibility_mode, integer, integer, text, text, text, uuid, boolean, boolean)',
    'public.set_session_booking_state(uuid, boolean)',
    'public.cancel_training_session(uuid, text)',
    'public.duplicate_training_session(uuid, date, time, time, public.session_status)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
