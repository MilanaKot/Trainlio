-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS
-- 03 — sessions, series, bookings, occupancy projection

-- ---------------------------------------------------------------------------
-- Session series (approved). Generation metadata only.
-- Generated sessions are fully independent: editing or cancelling one occurrence
-- never touches its siblings (BR-081). There is no "this and all following"
-- editing in MVP.
-- ---------------------------------------------------------------------------

create table public.session_series (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete restrict,
  sport_id           uuid not null,
  location_id        uuid not null,
  facility_id        uuid not null,
  main_coach_user_id uuid not null references auth.users(id) on delete restrict,

  -- Recurrence pattern, expressed in workspace-local wall clock.
  frequency          public.recurrence_frequency not null default 'WEEKLY',
  by_weekday         integer not null,              -- ISO-8601: 1 = Monday .. 7 = Sunday
  local_date_from    date not null,
  local_date_to      date not null,
  local_start_time   time not null,
  local_end_time     time not null,

  -- Provenance (approved: "retain enough metadata to identify how/when the
  -- series was generated"). Snapshotted so a later workspace timezone change
  -- does not rewrite the history of how these timestamps were produced.
  generated_in_timezone text not null,
  generated_count       integer not null default 0,
  generated_at          timestamptz,

  -- Template applied to every generated occurrence at creation time.
  capacity           integer not null default 10,
  eligibility_mode   public.eligibility_mode not null default 'ALL',
  birth_year_from    integer,
  birth_year_to      integer,
  changing_room      text,
  notes              text,

  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint session_series_weekday_range  check (by_weekday between 1 and 7),
  constraint session_series_date_range     check (local_date_to >= local_date_from),
  constraint session_series_time_range     check (local_end_time > local_start_time),
  constraint session_series_capacity_range check (capacity between 1 and 200),
  constraint session_series_eligibility_consistent check (
    (eligibility_mode = 'ALL'
      and birth_year_from is null and birth_year_to is null)
    or
    (eligibility_mode = 'BIRTH_YEAR_RANGE'
      and birth_year_from is not null and birth_year_to is not null
      and birth_year_from <= birth_year_to
      and birth_year_from between 1900 and 2100
      and birth_year_to   between 1900 and 2100)
  ),
  constraint session_series_location_in_workspace
    foreign key (location_id, workspace_id)
    references public.locations (id, workspace_id) on delete restrict,
  constraint session_series_facility_at_location
    foreign key (facility_id, location_id)
    references public.facilities (id, location_id) on delete restrict,
  constraint session_series_sport_matches_workspace
    foreign key (workspace_id, sport_id)
    references public.workspaces (id, primary_sport_id) on delete restrict
);

comment on column public.session_series.local_start_time is
  'Wall-clock time in generated_in_timezone. Occurrences are built per local date and converted individually, so a series spanning a DST boundary keeps the same local start time (approved finding 2).';

-- ---------------------------------------------------------------------------
-- Training sessions
-- ---------------------------------------------------------------------------

create table public.training_sessions (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete restrict,
  sport_id           uuid not null,
  location_id        uuid not null,
  facility_id        uuid not null,
  main_coach_user_id uuid not null references auth.users(id) on delete restrict,
  series_id          uuid references public.session_series(id) on delete restrict,

  start_at           timestamptz not null,
  end_at             timestamptz not null,

  changing_room      text,
  capacity           integer not null default 10,
  eligibility_mode   public.eligibility_mode not null default 'ALL',
  birth_year_from    integer,
  birth_year_to      integer,
  status             public.session_status not null default 'DRAFT',
  notes              text,

  -- S-11, replaces the former updated_marker boolean.
  -- Non-null means a significant change has occurred; the guardian-facing
  -- "ZMĚNĚNO" badge compares this against the booking's created_at so a
  -- guardian who booked after the change is not shown a stale marker.
  -- OPEN (D-11): confirm which fields count as significant.
  last_significant_change_at timestamptz,

  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancelled_by_user_id uuid references auth.users(id) on delete restrict,

  constraint training_sessions_time_range check (end_at > start_at),
  constraint training_sessions_capacity_range check (capacity between 1 and 200),

  constraint training_sessions_eligibility_consistent check (
    (eligibility_mode = 'ALL'
      and birth_year_from is null and birth_year_to is null)
    or
    (eligibility_mode = 'BIRTH_YEAR_RANGE'
      and birth_year_from is not null and birth_year_to is not null
      and birth_year_from <= birth_year_to
      and birth_year_from between 1900 and 2100
      and birth_year_to   between 1900 and 2100)
  ),

  -- S-07: cancellation columns and status cannot disagree.
  constraint training_sessions_cancellation_consistent check (
    (status =  'CANCELLED' and cancelled_at is not null and cancelled_by_user_id is not null)
    or
    (status <> 'CANCELLED' and cancelled_at is null     and cancelled_by_user_id is null)
  ),

  -- Approved finding 3, invariant 1: the facility belongs to this location.
  constraint training_sessions_facility_at_location
    foreign key (facility_id, location_id)
    references public.facilities (id, location_id) on delete restrict,

  -- Approved finding 3, invariant 2: the location belongs to this workspace.
  -- This is the constraint that makes a cross-tenant session impossible at the
  -- data level rather than only in application code.
  constraint training_sessions_location_in_workspace
    foreign key (location_id, workspace_id)
    references public.locations (id, workspace_id) on delete restrict,

  -- Approved finding 3, invariant 4: the session sport is the workspace sport.
  constraint training_sessions_sport_matches_workspace
    foreign key (workspace_id, sport_id)
    references public.workspaces (id, primary_sport_id) on delete restrict
);

create table public.training_session_coaches (
  training_session_id uuid not null references public.training_sessions(id) on delete restrict,
  user_id             uuid not null references auth.users(id) on delete restrict,
  role                public.coach_session_role not null,
  created_at          timestamptz not null default now(),
  primary key (training_session_id, user_id)
);

-- S-09: exactly one MAIN coach per session; mirrored onto
-- training_sessions.main_coach_user_id by trigger so the two cannot diverge.
create unique index uq_session_single_main_coach
  on public.training_session_coaches (training_session_id)
  where role = 'MAIN';

-- ---------------------------------------------------------------------------
-- Bookings. Never hard-deleted (BR-044, BR-071); cancellation is a status change.
-- ---------------------------------------------------------------------------

create table public.bookings (
  id                      uuid primary key default gen_random_uuid(),
  training_session_id     uuid not null references public.training_sessions(id) on delete restrict,
  athlete_id              uuid not null references public.athletes(id) on delete restrict,
  status                  public.booking_status not null default 'CONFIRMED',
  created_by_user_id      uuid not null references auth.users(id) on delete restrict,
  created_by_role         public.booking_creator_role not null,
  coach_capacity_override boolean not null default false,
  cancellation_reason     text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  cancelled_at            timestamptz,
  cancelled_by_user_id    uuid references auth.users(id) on delete restrict,

  -- S-07
  constraint bookings_cancellation_consistent check (
    (status =  'CONFIRMED' and cancelled_at is null     and cancelled_by_user_id is null)
    or
    (status <> 'CONFIRMED' and cancelled_at is not null and cancelled_by_user_id is not null)
  ),

  -- BR-033/BR-034: only a coach or admin can hold an override flag.
  constraint bookings_override_requires_privileged_creator check (
    coach_capacity_override = false or created_by_role in ('COACH', 'ADMIN')
  )
);

-- BR-031 / AC-023. A backstop, not the mechanism: the booking RPC checks first
-- and returns a typed error. Allows re-booking after a cancellation by design.
create unique index uq_confirmed_booking_per_athlete_session
  on public.bookings (training_session_id, athlete_id)
  where status = 'CONFIRMED';

-- ---------------------------------------------------------------------------
-- Occupancy projection (approved finding 1).
--
-- Purpose 1 — privacy: guardians must see "3 / 10" without being able to read
--   another family's booking rows (BR-090, BR-091, AC-090). This table holds a
--   count and nothing else: no athlete ids, no booker ids, no per-booking
--   timestamps. Nothing here can identify who is booked.
-- Purpose 2 — Realtime: this is the only booking-derived object guardians
--   subscribe to. public.bookings is never added to the Realtime publication.
-- Purpose 3 — concurrency: this row is the lock target that serialises the
--   capacity check (BR-032, AC-022).
--
-- confirmed_count is maintained exclusively by trigger from public.bookings.
-- No application code and no RPC ever writes it (BR-050, as amended).
-- ---------------------------------------------------------------------------

create table public.training_session_occupancy (
  training_session_id uuid primary key
    references public.training_sessions(id) on delete cascade,
  confirmed_count     integer not null default 0,
  updated_at          timestamptz not null default now(),
  constraint training_session_occupancy_count_non_negative check (confirmed_count >= 0)
);

comment on table public.training_session_occupancy is
  'Database-maintained projection of CONFIRMED bookings per session. Cascade delete is intentional and safe: this is a derived row with no historical value, and its parent session is itself protected by ON DELETE RESTRICT everywhere else.';
