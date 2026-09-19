-- Initial Supabase/PostgreSQL schema
-- This is a domain starting point, not a substitute for reviewed migrations.

create extension if not exists pgcrypto;

create type public.app_role as enum ('USER', 'COACH', 'ADMIN');
create type public.access_status as enum ('ACTIVE', 'INVITED', 'REVOKED');
create type public.session_status as enum ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');
create type public.booking_status as enum ('CONFIRMED', 'CANCELLED_BY_USER', 'CANCELLED_BY_COACH');
create type public.booking_creator_role as enum ('USER', 'COACH', 'ADMIN');
create type public.eligibility_mode as enum ('ALL', 'BIRTH_YEAR_RANGE');
create type public.coach_session_role as enum ('MAIN', 'ASSISTANT');
create type public.facility_type as enum ('RINK', 'PITCH', 'COURT', 'POOL', 'LANE', 'GYM', 'ROOM', 'OTHER');

create table public.app_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sports (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_sport_id uuid not null references public.sports(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(workspace_id, user_id, role)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  date_of_birth date not null,
  photo_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.guardian_athlete_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  relationship_code text not null default 'GUARDIAN',
  permission_level text not null default 'MANAGE',
  status public.access_status not null default 'ACTIVE',
  invited_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, athlete_id)
);

create table public.athlete_sport_profiles (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  sport_id uuid not null references public.sports(id) on delete cascade,
  club_name text,
  team_or_category text,
  jersey_number text,
  attributes jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(athlete_id, sport_id)
);

create table public.workspace_athlete_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  athlete_sport_profile_id uuid not null references public.athlete_sport_profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(workspace_id, athlete_id, athlete_sport_profile_id)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  code text not null,
  name text not null,
  facility_type public.facility_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(location_id, code)
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sport_id uuid not null references public.sports(id),
  location_id uuid not null references public.locations(id),
  facility_id uuid not null references public.facilities(id),
  main_coach_user_id uuid not null references auth.users(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  changing_room text,
  capacity integer not null default 10 check (capacity > 0),
  eligibility_mode public.eligibility_mode not null default 'ALL',
  birth_year_from integer,
  birth_year_to integer,
  status public.session_status not null default 'DRAFT',
  notes text,
  updated_marker boolean not null default false,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id),
  check (end_at > start_at),
  check (
    eligibility_mode = 'ALL'
    or (
      eligibility_mode = 'BIRTH_YEAR_RANGE'
      and birth_year_from is not null
      and birth_year_to is not null
      and birth_year_from <= birth_year_to
    )
  )
);

create index idx_training_sessions_workspace_start
  on public.training_sessions(workspace_id, start_at);

create table public.training_session_coaches (
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.coach_session_role not null,
  primary key(training_session_id, user_id)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  training_session_id uuid not null references public.training_sessions(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete cascade,
  status public.booking_status not null default 'CONFIRMED',
  created_by_user_id uuid not null references auth.users(id),
  created_by_role public.booking_creator_role not null,
  coach_capacity_override boolean not null default false,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references auth.users(id)
);

create unique index uq_confirmed_booking_per_athlete_session
  on public.bookings(training_session_id, athlete_id)
  where status = 'CONFIRMED';

create index idx_bookings_session_status
  on public.bookings(training_session_id, status);

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  training_session_id uuid references public.training_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  status text not null default 'PENDING',
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(event_id, recipient_user_id)
);

-- Hockey profile validation helper.
create or replace function public.validate_hockey_attributes()
returns trigger
language plpgsql
as $$
declare
  sport_code text;
  pos text;
  side text;
begin
  select code into sport_code from public.sports where id = new.sport_id;

  if sport_code = 'HOCKEY' then
    pos := new.attributes->>'position';
    side := new.attributes->>'stick_side';

    if pos is null or pos not in ('GOALIE','DEFENSE','CENTER','LEFT_WING','RIGHT_WING','UTILITY') then
      raise exception 'Invalid hockey position';
    end if;

    if side is null or side not in ('LEFT','RIGHT','UNKNOWN') then
      raise exception 'Invalid hockey stick_side';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_hockey_attributes
before insert or update on public.athlete_sport_profiles
for each row execute function public.validate_hockey_attributes();

-- Helper count
create or replace function public.confirmed_booking_count(p_session_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.bookings
  where training_session_id = p_session_id
    and status = 'CONFIRMED';
$$;

-- NOTE:
-- RLS policies and booking RPCs should be implemented as reviewed migrations.
-- Do not ship permissive default policies.
--
-- Required transactional functions:
--   book_athlete_normal(...)
--   book_athlete_as_coach(...)
--   cancel_booking_as_guardian(...)
--   cancel_booking_as_coach(...)
--
-- book_athlete_normal MUST serialize the final-capacity check.
