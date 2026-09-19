-- Trainlio — Sports Training Booking Platform
-- Layer: RLS AUTHORIZATION (predicates)
-- 06 — SECURITY DEFINER helper predicates used by RLS policies
--
-- Why these exist (S-R1): a policy on workspace_members that queries
-- workspace_members, or on guardian_athlete_access that queries itself, recurses
-- infinitely under RLS. Wrapping the membership lookup in a SECURITY DEFINER
-- function breaks the cycle because the function body is not re-filtered.
--
-- Rules every function in this file obeys (approved):
--   * SECURITY DEFINER with STABLE volatility;
--   * set search_path = '' and every identifier schema-qualified, so no
--     attacker-controlled schema can shadow a referenced object (S-R2);
--   * minimum surface: each returns a boolean or a count, never a row set that
--     could leak identities;
--   * EXECUTE revoked from PUBLIC and granted explicitly.

-- ---------------------------------------------------------------------------
-- Role predicates
-- ---------------------------------------------------------------------------

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_active
  );
$$;

-- COACH or workspace ADMIN. Both may run coach domain operations.
create or replace function public.is_workspace_coach(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.is_active
      and wm.role in ('COACH', 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------------
-- Guardian predicates
-- ---------------------------------------------------------------------------

create or replace function public.has_athlete_access(p_athlete_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.guardian_athlete_access gaa
    where gaa.athlete_id = p_athlete_id
      and gaa.user_id = auth.uid()
      and gaa.status = 'ACTIVE'
  );
$$;

create or replace function public.has_athlete_manage_access(p_athlete_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.guardian_athlete_access gaa
    where gaa.athlete_id = p_athlete_id
      and gaa.user_id = auth.uid()
      and gaa.status = 'ACTIVE'
      and gaa.permission_level = 'MANAGE'
  );
$$;

-- D-01 (approved): a guardian sees a workspace's sessions only while at least
-- one of their athletes holds an active membership there. An authenticated user
-- with no athlete relationship sees nothing, so possession of the app URL grants
-- no access.
create or replace function public.guardian_can_see_workspace(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_athlete_memberships wam
    join public.guardian_athlete_access gaa
      on gaa.athlete_id = wam.athlete_id
    where wam.workspace_id = p_workspace_id
      and wam.is_active
      and gaa.user_id = auth.uid()
      and gaa.status = 'ACTIVE'
  );
$$;

-- ---------------------------------------------------------------------------
-- Cross-role predicate: a coach may read an athlete only through an active
-- workspace membership in a workspace where the coach is an active member
-- (S-T3, AC-091). Deactivating either side removes visibility immediately.
-- ---------------------------------------------------------------------------

create or replace function public.coach_can_see_athlete(p_athlete_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_athlete_memberships wam
    join public.workspace_members wm
      on wm.workspace_id = wam.workspace_id
    where wam.athlete_id = p_athlete_id
      and wam.is_active
      and wm.user_id = auth.uid()
      and wm.is_active
      and wm.role in ('COACH', 'ADMIN')
  );
$$;

-- ---------------------------------------------------------------------------
-- Occupancy. Replaces the previous confirmed_booking_count(), which was STABLE
-- but not SECURITY DEFINER and therefore returned each guardian only their own
-- bookings (M-03). Reads the projection, never the booking rows.
-- ---------------------------------------------------------------------------

create or replace function public.session_confirmed_count(p_training_session_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select o.confirmed_count
     from public.training_session_occupancy o
     where o.training_session_id = p_training_session_id),
    0
  );
$$;

-- ---------------------------------------------------------------------------
-- Eligibility (PRD §9). Shared by the booking RPCs and by the athlete picker so
-- the UI cannot offer an athlete the server will reject.
-- Returns a code rather than a boolean so the UI can explain the reason.
-- ---------------------------------------------------------------------------

create or replace function public.athlete_eligibility_for_session(
  p_training_session_id uuid,
  p_athlete_id          uuid
)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  a record;
begin
  select ts.id, ts.workspace_id, ts.sport_id, ts.eligibility_mode,
         ts.birth_year_from, ts.birth_year_to
    into s
  from public.training_sessions ts
  where ts.id = p_training_session_id;

  if not found then
    return 'SESSION_NOT_FOUND';
  end if;

  select ath.id, ath.date_of_birth, ath.is_active
    into a
  from public.athletes ath
  where ath.id = p_athlete_id;

  if not found then
    return 'ATHLETE_NOT_FOUND';
  end if;

  -- D-09 (OPEN): an inactive athlete may not take a new place.
  if not a.is_active then
    return 'ATHLETE_INACTIVE';
  end if;

  -- AC-031: an active sport profile matching the session sport, plus an active
  -- membership of the session workspace.
  if not exists (
    select 1
    from public.workspace_athlete_memberships wam
    join public.athlete_sport_profiles asp
      on asp.id = wam.athlete_sport_profile_id
    where wam.athlete_id = p_athlete_id
      and wam.workspace_id = s.workspace_id
      and wam.is_active
      and asp.sport_id = s.sport_id
      and asp.is_active
  ) then
    return 'NO_WORKSPACE_SPORT_PROFILE';
  end if;

  -- AC-030 / AC-032: birth year derived from the full date of birth.
  if s.eligibility_mode = 'BIRTH_YEAR_RANGE'
     and extract(year from a.date_of_birth)::int
         not between s.birth_year_from and s.birth_year_to then
    return 'BIRTH_YEAR_OUT_OF_RANGE';
  end if;

  return 'ELIGIBLE';
end;
$$;

-- ---------------------------------------------------------------------------
-- D-12 (OPEN): changing room is shown to a guardian only when one of their
-- athletes holds a confirmed booking on that session.
-- ---------------------------------------------------------------------------

create or replace function public.guardian_has_confirmed_booking(p_training_session_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.bookings b
    join public.guardian_athlete_access gaa
      on gaa.athlete_id = b.athlete_id
    where b.training_session_id = p_training_session_id
      and b.status = 'CONFIRMED'
      and gaa.user_id = auth.uid()
      and gaa.status = 'ACTIVE'
  );
$$;

-- ---------------------------------------------------------------------------
-- Explicit EXECUTE privileges (approved: "Review function EXECUTE privileges
-- explicitly"). Default PUBLIC EXECUTE on functions is revoked in every case.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.is_platform_admin()',
    'public.is_workspace_member(uuid)',
    'public.is_workspace_coach(uuid)',
    'public.has_athlete_access(uuid)',
    'public.has_athlete_manage_access(uuid)',
    'public.guardian_can_see_workspace(uuid)',
    'public.coach_can_see_athlete(uuid)',
    'public.session_confirmed_count(uuid)',
    'public.athlete_eligibility_for_session(uuid, uuid)',
    'public.guardian_has_confirmed_booking(uuid)',
    'public.guardian_rebooking_blocked(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- Trigger-only functions are never callable by clients.
revoke all on function public.set_updated_at() from public;
revoke all on function public.validate_workspace_timezone() from public;
revoke all on function public.validate_sport_profile_attributes() from public;
revoke all on function public.ensure_session_occupancy_row() from public;
revoke all on function public.refresh_session_occupancy() from public;
revoke all on function public.enforce_coach_removal_block() from public;
revoke all on function public.sync_main_coach_mirror() from public;
revoke all on function public.audit_log_is_append_only() from public;
