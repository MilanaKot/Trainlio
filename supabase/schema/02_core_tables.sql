-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS
-- 02 — core domain tables
--
-- Deletion policy (approved finding 4):
--   Tables carrying operational history use ON DELETE RESTRICT. Domain entities
--   are deactivated (is_active), never deleted. The only cascades that remain are
--   on rows that are pure projections or pure join rows with no historical value.
--   Account deletion / anonymisation is a separate strategy (OPEN D-18).
--
-- Composite unique keys ending in a surrogate id exist solely so that a child
-- table can carry a composite foreign key. They are redundant with the primary
-- key by design and cost one index each.

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.app_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.app_profiles is
  'Application profile for an authenticated user. Never stores email: email lives in auth.users and is read server-side only (PERMISSIONS, email privacy).';

-- OPEN (D-17): platform-level administration, distinct from workspace ADMIN.
create table public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sport and tenancy
-- ---------------------------------------------------------------------------

create table public.sports (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  created_at timestamptz not null default now(),
  constraint sports_code_format check (code ~ '^[A-Z][A-Z0-9_]*$')
);

comment on column public.sports.name is
  'Administrative label only. UI text is resolved from code via i18n (PRD §21).';

create table public.workspaces (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  primary_sport_id            uuid not null references public.sports(id) on delete restrict,
  -- Approved finding 2. All wall-clock reasoning (session display, series
  -- generation, "Upcoming"/"Past" day grouping) happens in this zone.
  timezone                    text not null default 'Europe/Prague',
  -- D-03 / S-17. Same 12 hours as the MVP rule, but not a hardcoded constant.
  cancellation_deadline_hours integer not null default 12,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Validity of the IANA name is enforced by trigger, not CHECK: the timezone
  -- database is a STABLE lookup and must not be frozen into a constraint.
  constraint workspaces_cancellation_deadline_range
    check (cancellation_deadline_hours between 0 and 168),
  -- Enables the composite FK that pins a session/membership to the workspace sport.
  constraint workspaces_id_primary_sport_key unique (id, primary_sport_id)
);

create table public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id      uuid not null references auth.users(id) on delete restrict,
  role         public.workspace_role not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, user_id, role)
);

comment on table public.workspace_members is
  'A user may hold several roles in a workspace, so role checks must use EXISTS, never equality.';

-- ---------------------------------------------------------------------------
-- Athletes
-- ---------------------------------------------------------------------------

create table public.athletes (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null,
  last_name     text not null,
  date_of_birth date not null,
  photo_path    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint athletes_first_name_not_blank check (length(btrim(first_name)) > 0),
  constraint athletes_last_name_not_blank  check (length(btrim(last_name)) > 0),
  constraint athletes_dob_sane             check (date_of_birth > date '1900-01-01'),
  -- Photos are addressed by athlete id inside a private bucket (PERMISSIONS).
  constraint athletes_photo_path_scoped
    check (photo_path is null or photo_path = 'athletes/' || id::text || '/' || split_part(photo_path, '/', 3))
);

comment on table public.athletes is
  'Sport-independent athlete identity (BR-004). No sport-specific columns may ever be added here.';

create table public.guardian_athlete_access (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete restrict,
  athlete_id         uuid not null references public.athletes(id) on delete restrict,
  relationship_code  text not null default 'GUARDIAN',
  permission_level   public.access_permission_level not null default 'MANAGE',
  status             public.access_status not null default 'ACTIVE',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, athlete_id)
);

comment on table public.guardian_athlete_access is
  'M:N from day one (BR-002). MVP creates one ACTIVE row per athlete; the invitation flow is post-MVP.';

create table public.athlete_sport_profiles (
  id               uuid primary key default gen_random_uuid(),
  athlete_id       uuid not null references public.athletes(id) on delete restrict,
  sport_id         uuid not null references public.sports(id) on delete restrict,
  club_name        text,
  team_or_category text,
  jersey_number    text,
  attributes       jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (athlete_id, sport_id),
  -- Approved finding 3: lets a membership prove the profile is this athlete's.
  constraint athlete_sport_profiles_id_athlete_key unique (id, athlete_id),
  -- Approved finding 3: lets a membership prove the profile's sport.
  constraint athlete_sport_profiles_id_sport_key   unique (id, sport_id)
);

comment on column public.athlete_sport_profiles.attributes is
  'Sport-specific attributes (BR-010). Validated per sport by trigger; unknown keys are rejected.';

create table public.workspace_athlete_memberships (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null,
  athlete_id               uuid not null references public.athletes(id) on delete restrict,
  athlete_sport_profile_id uuid not null,
  -- Denormalised only to carry the two composite FKs below. Never written directly.
  sport_id                 uuid not null,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (workspace_id, athlete_id, athlete_sport_profile_id),

  -- Approved finding 3, invariant 3: the sport profile belongs to this athlete.
  constraint wam_profile_belongs_to_athlete
    foreign key (athlete_sport_profile_id, athlete_id)
    references public.athlete_sport_profiles (id, athlete_id) on delete restrict,

  -- Approved finding 3, invariant 4a: sport_id is the profile's sport.
  constraint wam_profile_sport_matches
    foreign key (athlete_sport_profile_id, sport_id)
    references public.athlete_sport_profiles (id, sport_id) on delete restrict,

  -- Approved finding 3, invariant 4b: that sport is the workspace's primary sport.
  -- Together these three make a cross-sport or cross-athlete membership
  -- structurally impossible rather than merely discouraged.
  constraint wam_workspace_sport_matches
    foreign key (workspace_id, sport_id)
    references public.workspaces (id, primary_sport_id) on delete restrict
);

comment on table public.workspace_athlete_memberships is
  'Workspace membership, distinct from club membership (BR-103, AC-111). One athlete may belong to several workspaces (BR-102).';

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------

create table public.locations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name         text not null,
  address      text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Approved finding 3: lets a session prove the location is its workspace's.
  constraint locations_id_workspace_key unique (id, workspace_id)
);

create table public.facilities (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.locations(id) on delete restrict,
  code          text not null,
  name          text not null,
  facility_type public.facility_type not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (location_id, code),
  -- Approved finding 3: lets a session prove the facility is at its location.
  constraint facilities_id_location_key unique (id, location_id)
);
