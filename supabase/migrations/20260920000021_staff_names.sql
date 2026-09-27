-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS + DOMAIN OPERATIONS
-- 21 — given name and surname, and the administrator who fills them in
--
-- D-11 says the coach is the product: a guardian must be able to see who leads
-- a session. The schema could not deliver that. `display_name` was a single
-- free-form column, nullable, and writable by its owner and nobody else — so a
-- coach who never opened Účet stayed nameless, every session page read
-- "Hlavní trenér —", and no administrator had any way to correct it.
--
-- Two changes, and they belong together:
--
--   1. The name becomes structured — first_name and last_name, exactly as
--      athletes already are (BR-004's table has carried both from the start).
--      `display_name` stays, derived, so every read path keeps working.
--   2. A workspace administrator may set the name of the workspace's own staff,
--      through a domain function that records the change.
--
-- Why derived rather than replaced: sixteen places in the schema and five in the
-- application read `display_name`, and none of them wants to compose a name.
-- Deriving it in a trigger makes the two representations incapable of
-- disagreeing, which a pair of columns plus a hand-maintained third would not.

-- ---------------------------------------------------------------------------
-- The columns.
-- ---------------------------------------------------------------------------

alter table public.app_profiles
  add column first_name text,
  add column last_name  text;

-- Backfill: the last whitespace-separated token is the surname, and a
-- single-token name is a given name. Nothing in production has a name yet —
-- `display_name` starts null by design (migration 10) — so this exists for
-- development databases and for the test fixtures.
update public.app_profiles p
   set first_name = case
         when btrim(p.display_name) ~ '\s'
           then btrim(regexp_replace(btrim(p.display_name), '\s+\S+$', ''))
         else btrim(p.display_name)
       end,
       last_name = case
         when btrim(p.display_name) ~ '\s'
           then substring(btrim(p.display_name) from '\S+$')
         else null
       end
 where nullif(btrim(coalesce(p.display_name, '')), '') is not null;

alter table public.app_profiles
  add constraint app_profiles_first_name_not_blank
    check (first_name is null or length(btrim(first_name)) > 0),
  add constraint app_profiles_last_name_not_blank
    check (last_name is null or length(btrim(last_name)) > 0),
  -- A surname with no given name is a half-finished form, not a name. The
  -- reverse is allowed: a guardian may be "Jana" and never say more.
  add constraint app_profiles_last_name_needs_first
    check (last_name is null or first_name is not null);

comment on column public.app_profiles.first_name is
  'Given name. Null until the person or a workspace administrator sets it.';
comment on column public.app_profiles.last_name is
  'Surname. Null is allowed; a surname without a given name is not.';
comment on column public.app_profiles.display_name is
  'Derived from first_name and last_name by trigger. Never written directly.';

-- ---------------------------------------------------------------------------
-- display_name is now a projection of the two columns.
--
-- A trigger rather than a generated column for one reason: anonymize_profile()
-- (migration 19) writes `display_name = null`, and a generated column cannot be
-- written at all. The stamp is also the place to erase the name, and doing it
-- here rather than in that function means *any* path that stamps anonymized_at
-- erases it — including a future administrative tool nobody has written yet.
-- ---------------------------------------------------------------------------

create or replace function public.app_profiles_derive_display_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- D-18. The name is the only personal datum this table holds.
  if tg_op = 'UPDATE' and new.anonymized_at is not null and old.anonymized_at is null then
    new.first_name := null;
    new.last_name  := null;
  end if;

  new.first_name   := nullif(btrim(coalesce(new.first_name, '')), '');
  new.last_name    := nullif(btrim(coalesce(new.last_name, '')), '');
  new.display_name := nullif(btrim(concat_ws(' ', new.first_name, new.last_name)), '');

  return new;
end;
$$;

revoke all on function public.app_profiles_derive_display_name() from public;

create trigger trg_app_profiles_derive_display_name
  before insert or update on public.app_profiles
  for each row execute function public.app_profiles_derive_display_name();

-- The owner writes the two real columns now. Leaving display_name writable
-- would leave a column a client can set and the trigger silently overwrites,
-- which is worse than no grant at all.
revoke update (display_name) on public.app_profiles from authenticated;
grant update (first_name, last_name) on public.app_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- An administrator names the workspace's staff.
--
-- Not a column grant: a grant wide enough to let an administrator write another
-- profile's row would also let them write any profile's row, including every
-- guardian in the club. This function can reach exactly the active members of a
-- workspace the caller administers, and it says so in the audit log.
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    'SESSION_CREATED',
    'SESSION_UPDATED',
    'SESSION_CAPACITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED',
    'SESSION_ELIGIBILITY_NARROWED',
    'SESSION_BOOKING_CLOSED',
    'SESSION_BOOKING_REOPENED',
    'SESSION_CANCELLED',
    'SESSION_SERIES_CREATED',
    'SESSION_DUPLICATED',
    'BOOKING_CREATED_BY_GUARDIAN',
    'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN',
    'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED',
    'ATHLETE_ANONYMIZED',
    'OCCUPANCY_REPAIRED',
    -- One person changed another person's name, or their place on the staff.
    -- Recorded because these are changes to what guardians see, made by
    -- someone other than their subject.
    'MEMBER_NAME_CHANGED',
    'MEMBER_ADDED',
    'MEMBER_ACTIVATED',
    'MEMBER_DEACTIVATED'
  )
);

create or replace function public.set_member_name(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_first_name   text,
  p_last_name    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_first   text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last    text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_before  record;
  v_display text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Staff only, and only this workspace's. A guardian's name is theirs to give,
  -- and an administrator of one club has no business in another's roster.
  --
  -- Membership need not be active: a coach who has left still appears on last
  -- season's rosters, and correcting a misspelling there is the same act as
  -- correcting it anywhere else. What is refused is an erased profile (D-18),
  -- and it is refused as MEMBER_NOT_FOUND rather than as its own code, because
  -- saying which of the two it is answers a question about a person who asked
  -- to be forgotten.
  if not exists (
    select 1
      from public.workspace_members m
      join public.app_profiles p on p.id = m.profile_id
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and p.anonymized_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  -- Both halves. A parent asks for "trenér Novák", so a surname is not optional
  -- for the person leading a session (D-11) — unlike a guardian's own name,
  -- which stays as informal as they like.
  if v_first is null or v_last is null then
    return jsonb_build_object('ok', false, 'code', 'NAME_REQUIRED');
  end if;

  select p.first_name, p.last_name
    into v_before
    from public.app_profiles p
   where p.id = p_profile_id;

  update public.app_profiles p
     set first_name = v_first,
         last_name  = v_last
   where p.id = p_profile_id
  returning p.display_name into v_display;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_NAME_CHANGED', 'PROFILE', p_profile_id,
     jsonb_build_object('first_name', v_before.first_name, 'last_name', v_before.last_name),
     jsonb_build_object('first_name', v_first, 'last_name', v_last));

  return jsonb_build_object('ok', true, 'display_name', v_display);
end;
$$;

revoke all on function public.set_member_name(uuid, uuid, text, text) from public;
grant execute on function public.set_member_name(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The roster an administrator edits.
--
-- workspace_members and staff profiles are both readable by staff already, so
-- this exists for one reason: it names which member rows the caller may write,
-- rather than leaving the screen to infer it from a role it read elsewhere.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_staff(p_workspace_id uuid)
returns table (
  profile_id     uuid,
  first_name     text,
  last_name      text,
  display_name   text,
  roles          public.workspace_role[],
  is_active      boolean,
  has_login      boolean,
  is_editable    boolean,
  future_sessions integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    p.display_name,
    array_agg(distinct m.role),
    bool_or(m.is_active),
    p.auth_user_id is not null,
    public.is_workspace_admin(p_workspace_id) and p.anonymized_at is null,
    (select count(*)::int
       from public.training_sessions s
      where s.workspace_id = p_workspace_id
        and s.main_coach_profile_id = p.id
        and s.status <> 'CANCELLED'
        and s.start_at > now())
  from public.workspace_members m
  join public.app_profiles p on p.id = m.profile_id
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  group by p.id, p.first_name, p.last_name, p.display_name, p.auth_user_id, p.anonymized_at
  order by bool_or(m.is_active) desc, p.last_name nulls last, p.first_name nulls last;
$$;

revoke all on function public.workspace_staff(uuid) from public;
grant execute on function public.workspace_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding a coach who has never signed in.
--
-- The club's first coach exists on the ice before they exist in a database, and
-- an administrator building next month's schedule should not have to wait for
-- them to open an email. D-18 already made this representable: `auth_user_id`
-- is nullable because a profile outlives its login, and the same nullability
-- lets one exist before it. The profile is a real actor record from the start —
-- it can lead sessions, appear on rosters, and be named to guardians — it
-- simply has nobody signing in as it yet.
--
-- Linking such a profile to a login when the coach does eventually sign up is
-- deliberately NOT done here. The signup trigger gives them a new profile, and
-- merging the two is an administrative decision with history attached to both
-- (migration 10 says the same about the reverse case). It needs its own
-- operation, its own audit entry and its own conversation.
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace_coach(
  p_workspace_id uuid,
  p_first_name   text,
  p_last_name    text,
  p_role         public.workspace_role default 'COACH'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_first   text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last    text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_profile uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if v_first is null or v_last is null then
    return jsonb_build_object('ok', false, 'code', 'NAME_REQUIRED');
  end if;

  insert into public.app_profiles (first_name, last_name)
  values (v_first, v_last)
  returning id into v_profile;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (p_workspace_id, v_profile, p_role);

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_ADDED', 'PROFILE', v_profile,
     jsonb_build_object('first_name', v_first, 'last_name', v_last, 'role', p_role));

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile,
    'display_name', v_first || ' ' || v_last);
end;
$$;

revoke all on function public.create_workspace_coach(uuid, text, text, public.workspace_role) from public;
grant execute on function public.create_workspace_coach(uuid, text, text, public.workspace_role) to authenticated;

-- ---------------------------------------------------------------------------
-- A coach leaves, or comes back.
--
-- Never a delete. A coach who led a training last winter is part of that
-- training's record, and `workspace_members.profile_id` is `on delete restrict`
-- precisely so nobody can remove them from it.
--
-- Two refusals, both about consequences the administrator cannot see from the
-- screen they are on:
--
--   * a workspace with no active administrator has nobody who can undo
--     anything, including this;
--   * a coach still leading future trainings is a session that can no longer be
--     edited — `enforce_session_main_coach_is_staff` requires the main coach to
--     be active staff — so the count comes back and the call must be repeated
--     with the confirmation, exactly as an over-capacity booking is (BR-033).
-- ---------------------------------------------------------------------------

create or replace function public.set_member_active(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_is_active    boolean,
  p_confirm      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_was      boolean;
  v_future   integer;
  v_admins   integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select bool_or(m.is_active) into v_was
    from public.workspace_members m
    join public.app_profiles p on p.id = m.profile_id
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id
     and p.anonymized_at is null;

  if v_was is null then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  if v_was = p_is_active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if not p_is_active then
    select count(*) into v_admins
      from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
       and m.profile_id <> p_profile_id;

    if v_admins = 0 and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id
         and m.profile_id = p_profile_id
         and m.role = 'WORKSPACE_ADMIN'
         and m.is_active
    ) then
      return jsonb_build_object('ok', false, 'code', 'LAST_ADMIN');
    end if;

    select count(*)::int into v_future
      from public.training_sessions s
     where s.workspace_id = p_workspace_id
       and s.main_coach_profile_id = p_profile_id
       and s.status <> 'CANCELLED'
       and s.start_at > now();

    if v_future > 0 and not p_confirm then
      return jsonb_build_object('ok', false, 'code', 'LEADS_FUTURE_SESSIONS',
        'details', jsonb_build_object('future_sessions', v_future));
    end if;
  end if;

  update public.workspace_members m
     set is_active = p_is_active
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor,
     case when p_is_active then 'MEMBER_ACTIVATED' else 'MEMBER_DEACTIVATED' end,
     'PROFILE', p_profile_id,
     jsonb_build_object('is_active', v_was),
     jsonb_build_object('is_active', p_is_active,
                        'future_sessions', coalesce(v_future, 0)));

  return jsonb_build_object('ok', true, 'is_active', p_is_active);
end;
$$;

revoke all on function public.set_member_active(uuid, uuid, boolean, boolean) from public;
grant execute on function public.set_member_active(uuid, uuid, boolean, boolean) to authenticated;
