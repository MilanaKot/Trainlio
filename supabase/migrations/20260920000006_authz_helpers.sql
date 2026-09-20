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
--   * minimum surface: each returns a boolean, a uuid or a count, never a row
--     set that could leak identities;
--   * EXECUTE revoked from PUBLIC and granted explicitly.

-- ---------------------------------------------------------------------------
-- Identity resolution (D-18 constraint).
--
-- Policies authorize against the durable profile id, not auth.uid() directly,
-- because auth_user_id is severable. This one hop is what lets an account be
-- deleted later without orphaning or misattributing any history.
-- ---------------------------------------------------------------------------

create or replace function public.current_profile_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
  from public.app_profiles p
  where p.auth_user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Role predicates (D-17)
-- ---------------------------------------------------------------------------

-- Platform administration is explicit membership of platform_admins. It is
-- never inferred from a workspace role, and a WORKSPACE_ADMIN is not a platform
-- admin.
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.profile_id = public.current_profile_id()
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
      and wm.profile_id = public.current_profile_id()
      and wm.is_active
  );
$$;

-- COACH or WORKSPACE_ADMIN. Both may run coach domain operations within their
-- own workspace. A user may hold both roles; membership is tested with EXISTS.
create or replace function public.is_workspace_coach(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = public.current_profile_id()
      and wm.is_active
      and wm.role in ('COACH', 'WORKSPACE_ADMIN')
  );
$$;

-- Workspace configuration rights, deliberately narrower than is_workspace_coach.
create or replace function public.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.profile_id = public.current_profile_id()
      and wm.is_active
      and wm.role = 'WORKSPACE_ADMIN'
  );
$$;

-- ---------------------------------------------------------------------------
-- Guardian predicates.
--
-- D-17: guardian authorization runs entirely through athlete access and
-- workspace athlete membership. There is no guardian workspace role, and none
-- of these predicates consults workspace_members.
-- ---------------------------------------------------------------------------

create or replace function public.has_athlete_access(p_athlete_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.guardian_athlete_access gaa
    where gaa.athlete_id = p_athlete_id
      and gaa.profile_id = public.current_profile_id()
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
      and gaa.profile_id = public.current_profile_id()
      and gaa.status = 'ACTIVE'
      and gaa.permission_level = 'MANAGE'
  );
$$;

-- D-01: a guardian sees a workspace's sessions only while at least one of their
-- athletes holds an active membership there. An authenticated user with no
-- athlete relationship sees nothing, so possession of the app URL grants no
-- access.
--
-- Note the absence of an is_active check on the athlete: D-09 requires that
-- deactivating an athlete never removes visibility of existing bookings or
-- sessions. Deactivation blocks new bookings only, and that is enforced in
-- athlete_eligibility_for_session below.
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
      and gaa.profile_id = public.current_profile_id()
      and gaa.status = 'ACTIVE'
  );
$$;

-- D-11 clarification: the coach is the product, so a guardian must be able to
-- see who leads a session. True when the profile is active staff of a workspace
-- the caller can see.
--
-- This MUST be a SECURITY DEFINER function rather than an inline EXISTS in the
-- policy. workspace_members carries its own RLS, and a guardian cannot select
-- from it, so an inline subquery evaluates to false and the coach's name
-- silently disappears. Caught in validation; it is the same trap as S-R1.
create or replace function public.is_visible_staff_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.profile_id = p_profile_id
      and wm.is_active
      and (public.is_workspace_member(wm.workspace_id)
           or public.guardian_can_see_workspace(wm.workspace_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- Cross-role predicate: a coach may read an athlete only through an active
-- workspace membership in a workspace where the coach is an active member
-- (S-T3, AC-091). Deactivating either side removes visibility immediately.
--
-- D-09: an inactive athlete remains visible to the coach, because their
-- existing bookings remain on the roster.
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
      and wm.profile_id = public.current_profile_id()
      and wm.is_active
      and wm.role in ('COACH', 'WORKSPACE_ADMIN')
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
--
-- This governs NEW bookings only. It is never consulted when cancelling or
-- removing a booking, which is what makes D-09 and D-08 work: an inactive
-- athlete, or one outside a narrowed range, keeps a booking that can still be
-- cancelled normally.
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
  select ts.id, ts.workspace_id, ts.sport_id, ts.status, ts.eligibility_mode,
         ts.birth_year_from, ts.birth_year_to
    into s
  from public.training_sessions ts
  where ts.id = p_training_session_id;

  if not found then
    return 'SESSION_NOT_FOUND';
  end if;

  -- D-07: a cancelled session is terminal.
  if s.status = 'CANCELLED' then
    return 'SESSION_CANCELLED';
  end if;

  select ath.id, ath.date_of_birth, ath.is_active
    into a
  from public.athletes ath
  where ath.id = p_athlete_id;

  if not found then
    return 'ATHLETE_NOT_FOUND';
  end if;

  -- D-09: an inactive athlete may not take a NEW place. Existing bookings are
  -- untouched and remain cancellable.
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
-- D-08 support: how many confirmed bookings would fall outside a proposed
-- birth-year range. The coach warning needs the count before saving, and
-- recipient expansion needs the athlete list after.
-- ---------------------------------------------------------------------------

create or replace function public.bookings_outside_birth_year_range(
  p_training_session_id uuid,
  p_birth_year_from     integer,
  p_birth_year_to       integer
)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select b.athlete_id
  from public.bookings b
  join public.athletes a on a.id = b.athlete_id
  where b.training_session_id = p_training_session_id
    and b.status = 'CONFIRMED'
    and (p_birth_year_from is not null and p_birth_year_to is not null)
    and extract(year from a.date_of_birth)::int
        not between p_birth_year_from and p_birth_year_to;
$$;

-- ---------------------------------------------------------------------------
-- Explicit EXECUTE privileges (approved: "Review function EXECUTE privileges
-- explicitly"). Default PUBLIC EXECUTE on functions is revoked in every case.
--
-- bookings_outside_birth_year_range is granted to no client role: it returns
-- athlete ids across families and is for the coach domain operation only.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.current_profile_id()',
    'public.is_platform_admin()',
    'public.is_workspace_member(uuid)',
    'public.is_workspace_coach(uuid)',
    'public.is_workspace_admin(uuid)',
    'public.has_athlete_access(uuid)',
    'public.has_athlete_manage_access(uuid)',
    'public.guardian_can_see_workspace(uuid)',
    'public.coach_can_see_athlete(uuid)',
    'public.is_visible_staff_profile(uuid)',
    'public.session_confirmed_count(uuid)',
    'public.athlete_eligibility_for_session(uuid, uuid)',
    'public.guardian_rebooking_blocked(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function public.bookings_outside_birth_year_range(uuid, integer, integer) from public;

-- Trigger-only functions are never callable by clients.
revoke all on function public.set_updated_at() from public;
revoke all on function public.validate_workspace_timezone() from public;
revoke all on function public.validate_sport_profile_attributes() from public;
revoke all on function public.enforce_cancelled_session_is_terminal() from public;
revoke all on function public.enforce_booking_insert_rules() from public;
revoke all on function public.ensure_session_occupancy_row() from public;
revoke all on function public.refresh_session_occupancy() from public;
revoke all on function public.sync_main_coach_mirror() from public;
revoke all on function public.assert_profile_is_workspace_staff(uuid, uuid) from public;
revoke all on function public.enforce_session_main_coach_is_staff() from public;
revoke all on function public.enforce_session_coach_is_staff() from public;
revoke all on function public.audit_log_is_append_only() from public;
