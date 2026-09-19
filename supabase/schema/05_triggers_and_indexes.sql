-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS
-- 05 — triggers that maintain derived state, and indexes for RLS/query paths

-- ---------------------------------------------------------------------------
-- updated_at (S-08). The columns existed on six tables with nothing writing them.
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'app_profiles', 'workspaces', 'workspace_members', 'athletes',
    'guardian_athlete_access', 'athlete_sport_profiles',
    'workspace_athlete_memberships', 'locations', 'facilities',
    'session_series', 'training_sessions', 'bookings',
    'notification_deliveries'
  ]
  loop
    execute format(
      'create trigger trg_%s_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workspace timezone must be a real IANA zone (approved finding 2).
-- Enforced by trigger rather than CHECK: the zone database is a STABLE lookup.
-- ---------------------------------------------------------------------------

create or replace function public.validate_workspace_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
    raise exception 'Unknown IANA timezone: %', new.timezone
      using errcode = 'invalid_parameter_value';
  end if;
  return new;
end;
$$;

create trigger trg_workspaces_validate_timezone
  before insert or update of timezone on public.workspaces
  for each row execute function public.validate_workspace_timezone();

-- ---------------------------------------------------------------------------
-- Sport attribute validation (M-12). Required values plus a key whitelist, so
-- a client cannot smuggle arbitrary JSON into a sport profile.
-- Deliberately a per-sport branch rather than a generic schema registry
-- (CLAUDE.md principle 12).
-- ---------------------------------------------------------------------------

create or replace function public.validate_sport_profile_attributes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sport_code text;
  v_position   text;
  v_stick_side text;
  v_unknown    text[];
begin
  select s.code into v_sport_code
  from public.sports s
  where s.id = new.sport_id;

  if v_sport_code = 'HOCKEY' then
    v_position   := new.attributes ->> 'position';
    v_stick_side := new.attributes ->> 'stick_side';

    if v_position is null or v_position not in
       ('GOALIE', 'DEFENSE', 'CENTER', 'LEFT_WING', 'RIGHT_WING', 'UTILITY') then
      raise exception 'Invalid hockey position: %', coalesce(v_position, 'null')
        using errcode = 'invalid_parameter_value';
    end if;

    if v_stick_side is null or v_stick_side not in ('LEFT', 'RIGHT', 'UNKNOWN') then
      raise exception 'Invalid hockey stick_side: %', coalesce(v_stick_side, 'null')
        using errcode = 'invalid_parameter_value';
    end if;

    select array_agg(k) into v_unknown
    from jsonb_object_keys(new.attributes) k
    where k not in ('position', 'stick_side');

    if v_unknown is not null then
      raise exception 'Unknown hockey attribute keys: %', array_to_string(v_unknown, ', ')
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_sport_profile_attributes
  before insert or update on public.athlete_sport_profiles
  for each row execute function public.validate_sport_profile_attributes();

-- ---------------------------------------------------------------------------
-- Occupancy projection maintenance (approved finding 1).
-- Full recompute rather than delta arithmetic: rosters are small (capacity is
-- bounded at 200) and a recompute cannot drift. Callers already hold the
-- occupancy row lock, so this does not widen the critical section.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_session_occupancy_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.training_session_occupancy (training_session_id, confirmed_count)
  values (new.id, 0)
  on conflict (training_session_id) do nothing;
  return new;
end;
$$;

create trigger trg_training_sessions_ensure_occupancy
  after insert on public.training_sessions
  for each row execute function public.ensure_session_occupancy_row();

create or replace function public.refresh_session_occupancy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT, so neither can
  -- be referenced unconditionally.
  v_session_id uuid := case tg_op
                         when 'DELETE' then old.training_session_id
                         else new.training_session_id
                       end;
begin
  update public.training_session_occupancy o
     set confirmed_count = (
           select count(*)
           from public.bookings b
           where b.training_session_id = v_session_id
             and b.status = 'CONFIRMED'
         ),
         updated_at = now()
   where o.training_session_id = v_session_id;

  return null;
end;
$$;

create trigger trg_bookings_refresh_occupancy
  after insert or update of status or delete on public.bookings
  for each row execute function public.refresh_session_occupancy();

-- ---------------------------------------------------------------------------
-- D-06: an athlete removed by a coach cannot be re-booked by a guardian.
--
-- Modelled explicitly rather than inferred at the call site. The predicate is
-- "the most recent booking row for this (session, athlete) was cancelled by a
-- coach", which handles restoration correctly:
--
--   coach removes        -> latest is CANCELLED_BY_COACH -> guardian blocked
--   coach re-adds        -> latest is CONFIRMED          -> not blocked
--   guardian then cancels-> latest is CANCELLED_BY_USER  -> re-bookable (approved)
--
-- Enforced by trigger so the rule holds even if a future code path forgets it;
-- the RPC checks first so the guardian gets a typed error, not a raw exception.
-- ---------------------------------------------------------------------------

create or replace function public.guardian_rebooking_blocked(
  p_training_session_id uuid,
  p_athlete_id          uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select b.status = 'CANCELLED_BY_COACH'
      from public.bookings b
      where b.training_session_id = p_training_session_id
        and b.athlete_id = p_athlete_id
      order by b.created_at desc, b.id desc
      limit 1
    ),
    false
  );
$$;

create or replace function public.enforce_coach_removal_block()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'CONFIRMED'
     and new.created_by_role = 'USER'
     and public.guardian_rebooking_blocked(new.training_session_id, new.athlete_id)
  then
    raise exception 'Athlete was removed from this session by a coach and cannot be re-booked by a guardian'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger trg_bookings_enforce_coach_removal_block
  before insert on public.bookings
  for each row execute function public.enforce_coach_removal_block();

-- ---------------------------------------------------------------------------
-- S-09: keep training_sessions.main_coach_user_id in step with the canonical
-- MAIN row in training_session_coaches. The association table is authoritative
-- (DATA_MODEL); the column is a query convenience that must never diverge.
-- ---------------------------------------------------------------------------

create or replace function public.sync_main_coach_mirror()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'MAIN' then
    update public.training_sessions s
       set main_coach_user_id = new.user_id
     where s.id = new.training_session_id
       and s.main_coach_user_id is distinct from new.user_id;
  end if;
  return null;
end;
$$;

create trigger trg_session_coaches_sync_main
  after insert or update on public.training_session_coaches
  for each row execute function public.sync_main_coach_mirror();

-- ---------------------------------------------------------------------------
-- Indexes (S-16). Every guardian read path filters through
-- guardian_athlete_access; every coach read path through workspace_members.
-- Without these, each RLS predicate is a sequential scan.
-- ---------------------------------------------------------------------------

create index idx_guardian_access_user_active
  on public.guardian_athlete_access (user_id) where status = 'ACTIVE';

create index idx_guardian_access_athlete_active
  on public.guardian_athlete_access (athlete_id) where status = 'ACTIVE';

create index idx_workspace_members_user_active
  on public.workspace_members (user_id) where is_active;

create index idx_workspace_members_workspace_active
  on public.workspace_members (workspace_id) where is_active;

create index idx_wam_workspace_athlete_active
  on public.workspace_athlete_memberships (workspace_id, athlete_id) where is_active;

create index idx_wam_athlete_active
  on public.workspace_athlete_memberships (athlete_id) where is_active;

create index idx_athlete_sport_profiles_athlete
  on public.athlete_sport_profiles (athlete_id) where is_active;

create index idx_training_sessions_workspace_status_start
  on public.training_sessions (workspace_id, status, start_at);

create index idx_training_sessions_series
  on public.training_sessions (series_id) where series_id is not null;

create index idx_bookings_session_status
  on public.bookings (training_session_id, status);

create index idx_bookings_athlete_status
  on public.bookings (athlete_id, status);

create index idx_bookings_session_athlete_recent
  on public.bookings (training_session_id, athlete_id, created_at desc);

create index idx_notification_events_undispatched
  on public.notification_events (created_at) where dispatched_at is null;

create index idx_notification_deliveries_pending
  on public.notification_deliveries (created_at) where status in ('PENDING', 'FAILED');

create index idx_audit_log_workspace_created
  on public.audit_log (workspace_id, created_at desc);

create index idx_audit_log_entity
  on public.audit_log (entity_type, entity_id, created_at desc);
