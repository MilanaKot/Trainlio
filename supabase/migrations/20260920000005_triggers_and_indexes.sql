-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS
-- 05 — triggers that maintain derived state or enforce lifecycle rules,
--      and indexes for RLS/query paths

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
    'session_series', 'training_sessions', 'training_session_internal_notes',
    'bookings', 'notification_deliveries'
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
-- D-07: CANCELLED is a terminal session status.
--
-- Cancellation notifications may already have been sent, so reopening the same
-- record would produce ambiguous history and contradictory communication. A
-- coach who cancelled by mistake uses Duplicate Session, and the cancelled
-- session is preserved as historical evidence.
--
-- Enforced at database level so no future code path can reopen a session.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_cancelled_session_is_terminal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'CANCELLED' and new.status <> 'CANCELLED' then
    raise exception 'A cancelled session is terminal and cannot be reopened (was %, attempted %)',
      old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger trg_training_sessions_cancel_is_terminal
  before update of status on public.training_sessions
  for each row execute function public.enforce_cancelled_session_is_terminal();

-- ---------------------------------------------------------------------------
-- D-06 and D-07, both enforced on booking insert.
--
-- D-06: an athlete a coach removed cannot be re-booked by a guardian. The
-- predicate is "the most recent booking row for this (session, athlete) was
-- cancelled by a coach", which handles restoration correctly:
--
--   coach removes        -> latest is CANCELLED_BY_COACH -> guardian blocked
--   coach re-adds        -> latest is CONFIRMED          -> not blocked
--   guardian then cancels-> latest is CANCELLED_BY_USER  -> re-bookable (approved)
--
-- D-07: no booking of any kind may be added to a cancelled session, guardian
-- or coach.
--
-- Enforced by trigger so the rules hold even if a future code path forgets
-- them; the RPCs check first so the caller gets a typed error.
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

create or replace function public.enforce_booking_insert_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.session_status;
begin
  -- D-07: terminal cancelled session accepts no new booking, from anyone.
  select s.status into v_status
  from public.training_sessions s
  where s.id = new.training_session_id;

  if v_status = 'CANCELLED' then
    raise exception 'Session is cancelled and cannot accept new bookings'
      using errcode = 'restrict_violation';
  end if;

  -- D-06: guardian re-booking after a coach removal.
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

create trigger trg_bookings_enforce_insert_rules
  before insert on public.bookings
  for each row execute function public.enforce_booking_insert_rules();

-- ---------------------------------------------------------------------------
-- Occupancy projection maintenance (approved finding 1).
--
-- Full recompute rather than delta arithmetic: rosters are small (capacity is
-- bounded at 200) and a recompute cannot be thrown off by a missed event.
--
-- The trigger takes the occupancy row lock itself before recounting. This is
-- not redundant with the lock the booking RPCs take, and it is not optional.
--
-- Found in validation: with two concurrent inserts and no lock, both triggers
-- recounted from their own statement snapshots, neither saw the other's
-- committed row, and the projection settled at 2 while three CONFIRMED bookings
-- existed. At READ COMMITTED an UPDATE that blocks on a row lock re-reads its
-- target row but does NOT re-evaluate its subqueries, so the recount must be a
-- statement that begins after the competing writer has committed.
--
-- Acquiring the lock here makes the projection correct regardless of caller
-- discipline, so a future code path, migration or admin script that writes a
-- booking without going through an RPC cannot silently desynchronise the count.
-- For the RPCs, which already hold the lock, re-acquiring it in the same
-- transaction is free.
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
  -- Serialise against any other writer for this session, then recount in a
  -- statement whose snapshot is taken after they committed. See the note above.
  perform 1
  from public.training_session_occupancy o
  where o.training_session_id = v_session_id
  for update;

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
-- S-09: keep training_sessions.main_coach_profile_id in step with the canonical
-- MAIN row in training_session_coaches. The association table is authoritative
-- (DATA_MODEL); the column is a query convenience that must never diverge.
--
-- Note for D-11: a main-coach change is significant and must produce an email
-- and an audit entry. That is the update RPC's job, not this trigger's — this
-- only prevents the two representations from disagreeing.
-- ---------------------------------------------------------------------------

create or replace function public.sync_main_coach_mirror()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'MAIN' then
    update public.training_sessions s
       set main_coach_profile_id = new.profile_id
     where s.id = new.training_session_id
       and s.main_coach_profile_id is distinct from new.profile_id;
  end if;
  return null;
end;
$$;

create trigger trg_session_coaches_sync_main
  after insert or update on public.training_session_coaches
  for each row execute function public.sync_main_coach_mirror();

-- ---------------------------------------------------------------------------
-- A session's coaches must be active staff of that session's workspace.
--
-- Found during validation of D-11. Without this, a session could name a coach
-- from another workspace: a cross-tenant leak of the same family as the
-- composite foreign keys in file 02, but not expressible as one, because
-- workspace_members is unique on (workspace_id, profile_id, role) and a user may
-- hold two roles.
--
-- It also keeps the guardian-facing coach name resolvable: guardians may read
-- the display name of active staff in a workspace they can see, so a session
-- coach who is not a member would show as blank.
-- ---------------------------------------------------------------------------

create or replace function public.assert_profile_is_workspace_staff(
  p_workspace_id uuid,
  p_profile_id   uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = p_profile_id
      and wm.is_active
      and wm.role in ('COACH', 'WORKSPACE_ADMIN')
  ) then
    raise exception 'Profile % is not active staff of workspace %', p_profile_id, p_workspace_id
      using errcode = 'foreign_key_violation';
  end if;
end;
$$;

create or replace function public.enforce_session_main_coach_is_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_profile_is_workspace_staff(new.workspace_id, new.main_coach_profile_id);
  return new;
end;
$$;

create trigger trg_training_sessions_main_coach_is_staff
  before insert or update of main_coach_profile_id, workspace_id on public.training_sessions
  for each row execute function public.enforce_session_main_coach_is_staff();

create trigger trg_session_series_main_coach_is_staff
  before insert or update of main_coach_profile_id, workspace_id on public.session_series
  for each row execute function public.enforce_session_main_coach_is_staff();

create or replace function public.enforce_session_coach_is_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select ts.workspace_id into v_workspace_id
  from public.training_sessions ts
  where ts.id = new.training_session_id;

  perform public.assert_profile_is_workspace_staff(v_workspace_id, new.profile_id);
  return new;
end;
$$;

create trigger trg_session_coaches_is_staff
  before insert or update on public.training_session_coaches
  for each row execute function public.enforce_session_coach_is_staff();

-- ---------------------------------------------------------------------------
-- Indexes (S-16). Every guardian read path filters through
-- guardian_athlete_access; every coach read path through workspace_members.
-- Without these, each RLS predicate is a sequential scan.
-- ---------------------------------------------------------------------------

create index idx_guardian_access_profile_active
  on public.guardian_athlete_access (profile_id) where status = 'ACTIVE';

create index idx_guardian_access_athlete_active
  on public.guardian_athlete_access (athlete_id) where status = 'ACTIVE';

create index idx_workspace_members_profile_active
  on public.workspace_members (profile_id) where is_active;

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

-- "My sessions" for a coach, on both the canonical association table and the
-- mirror column. These exist for the query, not for the foreign key check:
-- every parent here is protected by ON DELETE RESTRICT and never deleted, so an
-- index added only to satisfy a linter would slow every insert for nothing.
create index idx_training_sessions_main_coach
  on public.training_sessions (main_coach_profile_id, start_at);

create index idx_session_coaches_profile
  on public.training_session_coaches (profile_id);

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
