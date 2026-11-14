-- ---------------------------------------------------------------------------
-- Joining a club by its link, the administrator's approval, and a second
-- parent invited by the first (decided with the product 12–13 November 2026;
-- PRD §6, D-39 to D-41).
--
-- Until now registering a child was how a parent joined: any signed-in person
-- could add a child to any active club (migration 12), which was tolerable
-- while the app was reachable only by the coach's link and is not once it is
-- in a store. Three things change:
--
--   1. **The club's link.** Each workspace has a join code, in a column no
--      client role can read. A parent who opens the link (or scans its QR)
--      holds a grant for that club; only a club they hold a grant for — or
--      already have an approved child in, or staff — is joinable.
--   2. **Approval.** A child registered by a parent waits (`PENDING`) with
--      its membership inactive, so every existing predicate — sessions a
--      guardian sees (D-01), booking eligibility, what a coach sees — already
--      leaves it out. An administrator approves or rejects; a rejected request
--      can be sent again. Both sides are e-mailed (E11, E12).
--   3. **The second parent.** A guardian invites another by e-mail address to
--      one or more of their children. The invitation is accepted by signing in
--      with that address — a code to it, or Google with it — and gives the same
--      access, without a second approval and without a duplicate child.
--
-- Children registered before this migration are approved (product, 13
-- November 2026: they are test data).
-- ---------------------------------------------------------------------------

create type public.membership_approval as enum ('PENDING', 'APPROVED', 'REJECTED');

alter table public.workspace_athlete_memberships
  add column approval     public.membership_approval not null default 'APPROVED',
  add column requested_by uuid references public.app_profiles(id) on delete restrict,
  add column requested_at timestamptz,
  add column decided_by   uuid references public.app_profiles(id) on delete restrict,
  add column decided_at   timestamptz,
  -- The whole point: nothing that reads `is_active` can see a child that is
  -- not approved.
  add constraint wam_active_only_when_approved check (not is_active or approval = 'APPROVED');

comment on column public.workspace_athlete_memberships.approval is
  'Migration 50: PENDING until a workspace administrator decides; only APPROVED may be active.';

-- ---------------------------------------------------------------------------
-- The join code. Eight characters from an alphabet without 0/O and 1/I/L,
-- from the cryptographic generator: 32^8 is about 10^12, so it cannot be
-- guessed, and a code that leaked is replaced by issuing a new one.
-- ---------------------------------------------------------------------------

create or replace function public.new_join_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
  from extensions.gen_random_bytes(8) b, generate_series(0, 7) i;
$$;

revoke all on function public.new_join_code() from public;

alter table public.workspaces add column join_code text;
update public.workspaces set join_code = public.new_join_code() where join_code is null;
alter table public.workspaces
  alter column join_code set not null,
  alter column join_code set default public.new_join_code(),
  add constraint workspaces_join_code_unique unique (join_code),
  add column join_code_rotated_at timestamptz;
-- `authenticated` held SELECT on the whole table, which would include the new
-- column: every coach and every parent of the club could read the code. The
-- grant becomes column by column, every column but the code and when it last
-- changed, so only the functions below reveal it, and only to administrators.
revoke select on public.workspaces from authenticated;
grant select (id, name, short_name, primary_sport_id, timezone, is_active,
              cancellation_deadline_hours, delivery_email_retention_days,
              logo_path, logo_background, logo_updated_at, created_at, updated_at)
  on public.workspaces to authenticated;

-- Who opened a club's link. One row per person and club; no client role reads
-- or writes it.
create table public.workspace_join_grants (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  profile_id   uuid not null references public.app_profiles(id) on delete restrict,
  granted_at   timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);
alter table public.workspace_join_grants enable row level security;
revoke all on public.workspace_join_grants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Second parents, invited by address (PRD §6).
-- ---------------------------------------------------------------------------

create table public.guardian_invitations (
  id           uuid primary key default extensions.gen_random_uuid(),
  email        text not null,
  athlete_ids  uuid[] not null,
  invited_by   uuid not null references public.app_profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid references public.app_profiles(id) on delete restrict,
  revoked_at   timestamptz,
  constraint guardian_invitations_email_shape
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint guardian_invitations_some_athlete check (cardinality(athlete_ids) between 1 and 20),
  constraint guardian_invitations_one_outcome check (accepted_at is null or revoked_at is null)
);
create index idx_guardian_invitations_open on public.guardian_invitations (email)
  where accepted_at is null and revoked_at is null;
alter table public.guardian_invitations enable row level security;
revoke all on public.guardian_invitations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Audit and outbox vocabularies.
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    'SESSION_CREATED', 'SESSION_UPDATED', 'SESSION_CAPACITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED', 'SESSION_ELIGIBILITY_NARROWED',
    'SESSION_BOOKING_CLOSED', 'SESSION_BOOKING_REOPENED', 'SESSION_CANCELLED',
    'SESSION_SERIES_CREATED', 'SESSION_DUPLICATED', 'SESSION_ASSISTANTS_CHANGED',
    'BOOKING_CREATED_BY_GUARDIAN', 'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN', 'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH', 'BOOKING_PAYMENT_MARKED', 'BOOKING_NOTE_CHANGED',
    'BOOKING_MESSAGE_SENT', 'BOOKING_ATTENDANCE_MARKED',
    'BOOKING_GUARDIAN_CONFIRMED',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    'MEMBER_ROLE_CHANGED', 'MEMBER_PERMISSION_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED',
    -- Migration 50.
    'WORKSPACE_JOIN_CODE_ROTATED',
    'ATHLETE_JOIN_REQUESTED', 'ATHLETE_JOIN_APPROVED', 'ATHLETE_JOIN_REJECTED',
    'GUARDIAN_INVITED', 'GUARDIAN_INVITATION_REVOKED', 'GUARDIAN_INVITATION_ACCEPTED'
  )
);

alter table public.notification_events drop constraint notification_events_type_known;
alter table public.notification_events add constraint notification_events_type_known check (
  event_type in (
    'SESSION_CANCELLED',            -- BR-072, AC-071..073 · E01
    'SESSION_SCHEDULE_CHANGED',     -- date / start / end (D-11) · E02
    'SESSION_LOCATION_CHANGED',     -- D-11 · E03
    'SESSION_FACILITY_CHANGED',     -- MH <-> VH (D-11) · E04
    'SESSION_MAIN_COACH_CHANGED',   -- D-11: the coach IS the product · E05
    'SESSION_ELIGIBILITY_NARROWED', -- D-08, a subset of the families · E06
    'BOOKING_REMOVED_BY_COACH',     -- D-06 · E07
    'SESSION_CHANGED',
    'BOOKING_ADDED_BY_COACH',       -- DR-12 · E08
    'COACH_MESSAGE_TO_GUARDIAN',    -- E09
    'GUARDIAN_ABSENCE_TO_COACH',    -- E10
    -- Migration 50: a child waits for approval, and the club decided.
    'ATHLETE_APPROVAL_REQUESTED',   -- E11, to the administrators
    'ATHLETE_JOIN_DECIDED'          -- E12, to the guardians
  )
);

-- ---------------------------------------------------------------------------
-- The link, as an administrator sees it (`Přístup do klubu`), and a new one.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_join_code(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_code text; v_rotated timestamptz;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;
  select w.join_code, w.join_code_rotated_at into v_code, v_rotated
    from public.workspaces w where w.id = p_workspace_id;
  return jsonb_build_object('ok', true, 'data',
    jsonb_build_object('code', v_code, 'rotated_at', v_rotated));
end;
$$;

create or replace function public.rotate_workspace_join_code(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;
  -- The old code stops working at once. Grants already given stay: they are
  -- people who opened the link when it was still the club's.
  update public.workspaces w
     set join_code = public.new_join_code(), join_code_rotated_at = now()
   where w.id = p_workspace_id
  returning w.join_code into v_code;
  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (p_workspace_id, public.current_profile_id(), 'WORKSPACE_JOIN_CODE_ROTATED', 'WORKSPACE',
          p_workspace_id, '{}'::jsonb, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('code', v_code));
end;
$$;

-- ---------------------------------------------------------------------------
-- The link, as a parent opens it. The preview answers without a session — the
-- landing page shows the club before anybody signs in — and says nothing but
-- the club's name and mark. Joining needs a session.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_join_preview(p_code text)
returns table (
  id uuid, name text, short_name text, sport_code text,
  logo_path text, logo_background text, logo_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.short_name, s.code, w.logo_path, w.logo_background, w.logo_updated_at
  from public.workspaces w
  join public.sports s on s.id = w.primary_sport_id
  where w.is_active and w.join_code = upper(btrim(coalesce(p_code, '')));
$$;

create or replace function public.join_workspace(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_profile_id();
  v_ws uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select w.id into v_ws from public.workspaces w
   where w.is_active and w.join_code = upper(btrim(coalesce(p_code, '')));
  if v_ws is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_JOIN_CODE');
  end if;
  insert into public.workspace_join_grants (workspace_id, profile_id)
  values (v_ws, v_me) on conflict do nothing;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('workspace_id', v_ws));
end;
$$;

-- ---------------------------------------------------------------------------
-- Which clubs this person may register a child into. Restated from migration
-- 12, where it was every active club: now a club whose link they opened, one
-- they already have an approved child in, or one they are staff of.
-- ---------------------------------------------------------------------------

create or replace function public.can_join_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_join_grants g
     where g.workspace_id = p_workspace_id and g.profile_id = public.current_profile_id())
    or public.guardian_can_see_workspace(p_workspace_id)
    or public.is_workspace_member(p_workspace_id);
$$;

revoke all on function public.can_join_workspace(uuid) from public;
grant execute on function public.can_join_workspace(uuid) to authenticated;

create or replace function public.joinable_workspaces()
returns table (
  id               uuid,
  name             text,
  short_name       text,
  primary_sport_id uuid,
  sport_code       text,
  timezone         text,
  logo_path        text,
  logo_background  text,
  logo_updated_at  timestamptz,
  location_name    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.short_name, w.primary_sport_id, s.code, w.timezone,
         w.logo_path, w.logo_background, w.logo_updated_at,
         (select max(l.name)
            from public.locations l
           where l.workspace_id = w.id and l.is_active
          having count(*) = 1)
  from public.workspaces w
  join public.sports s on s.id = w.primary_sport_id
  where w.is_active
    and public.current_profile_id() is not null
    -- Migration 50: the club's link, an approved child, or staff.
    and public.can_join_workspace(w.id)
  order by w.name;
$$;

-- ---------------------------------------------------------------------------
-- Registering a child, restated from migration 11: only into a joinable club,
-- and waiting for approval unless the caller is the club's administrator.
-- ---------------------------------------------------------------------------

create or replace function public.create_athlete_with_guardian(
  p_first_name       text,
  p_last_name        text,
  p_date_of_birth    date,
  p_workspace_id     uuid,
  p_sport_code       text,
  p_attributes       jsonb default '{}'::jsonb,
  p_club_name        text default null,
  p_team_or_category text default null,
  p_jersey_number    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id    uuid := public.current_profile_id();
  v_sport_id      uuid;
  v_workspace     record;
  v_athlete_id    uuid;
  v_profile_row   uuid;
  v_membership_id uuid;
  v_approved      boolean;
begin
  if v_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if p_first_name is null or length(btrim(p_first_name)) = 0
     or p_last_name is null or length(btrim(p_last_name)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
  end if;

  if p_date_of_birth is null
     or p_date_of_birth <= date '1900-01-01'
     or p_date_of_birth > current_date then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DATE_OF_BIRTH');
  end if;

  select s.id into v_sport_id from public.sports s where s.code = p_sport_code;
  if v_sport_id is null then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_FOUND');
  end if;

  select w.id, w.primary_sport_id, w.is_active into v_workspace
  from public.workspaces w where w.id = p_workspace_id;

  if v_workspace.id is null or not v_workspace.is_active then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  -- Migration 50: the club's link first.
  if not public.can_join_workspace(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_JOINABLE');
  end if;

  if v_workspace.primary_sport_id <> v_sport_id then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end if;

  -- An administrator registering their own child decides it themselves.
  v_approved := public.is_workspace_admin(p_workspace_id);

  begin
    insert into public.athletes (first_name, last_name, date_of_birth)
    values (btrim(p_first_name), btrim(p_last_name), p_date_of_birth)
    returning id into v_athlete_id;

    insert into public.guardian_athlete_access
      (profile_id, athlete_id, permission_level, status)
    values (v_profile_id, v_athlete_id, 'MANAGE', 'ACTIVE');

    insert into public.athlete_sport_profiles
      (athlete_id, sport_id, club_name, team_or_category, jersey_number, attributes)
    values (
      v_athlete_id,
      v_sport_id,
      nullif(btrim(coalesce(p_club_name, '')), ''),
      nullif(btrim(coalesce(p_team_or_category, '')), ''),
      nullif(btrim(coalesce(p_jersey_number, '')), ''),
      coalesce(p_attributes, '{}'::jsonb)
    )
    returning id into v_profile_row;

    insert into public.workspace_athlete_memberships
      (workspace_id, athlete_id, athlete_sport_profile_id, sport_id,
       is_active, approval, requested_by, requested_at, decided_by, decided_at)
    values (p_workspace_id, v_athlete_id, v_profile_row, v_sport_id,
            v_approved,
            case when v_approved then 'APPROVED' else 'PENDING' end::public.membership_approval,
            v_profile_id, now(),
            case when v_approved then v_profile_id end,
            case when v_approved then now() end)
    returning id into v_membership_id;
  exception
    when invalid_parameter_value then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SPORT_ATTRIBUTES');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ATHLETE_DATA');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_PROFILE_EXISTS');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end;

  if not v_approved then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (p_workspace_id, v_profile_id, 'ATHLETE_JOIN_REQUESTED', 'ATHLETE', v_athlete_id,
            '{}'::jsonb, jsonb_build_object('membership_id', v_membership_id));
    insert into public.notification_events (workspace_id, event_type, payload)
    values (p_workspace_id, 'ATHLETE_APPROVAL_REQUESTED',
            jsonb_build_object('athlete_id', v_athlete_id, 'actor_profile_id', v_profile_id));
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'athlete_id', v_athlete_id,
      'athlete_sport_profile_id', v_profile_row,
      'workspace_athlete_membership_id', v_membership_id,
      'approval', case when v_approved then 'APPROVED' else 'PENDING' end
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- A sport profile, restated from migration 11: a new membership needs a
-- joinable club and waits like a new child; an existing one keeps its approval
-- — saving a profile never re-activates a child the club has not approved.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_athlete_sport_profile(
  p_athlete_id       uuid,
  p_sport_code       text,
  p_attributes       jsonb default '{}'::jsonb,
  p_club_name        text default null,
  p_team_or_category text default null,
  p_jersey_number    text default null,
  p_workspace_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sport_id      uuid;
  v_workspace     record;
  v_profile_row   uuid;
  v_membership_id uuid;
  v_approved      boolean;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.has_athlete_manage_access(p_athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  select s.id into v_sport_id from public.sports s where s.code = p_sport_code;
  if v_sport_id is null then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_FOUND');
  end if;

  if p_workspace_id is not null then
    select w.id, w.primary_sport_id, w.is_active into v_workspace
    from public.workspaces w where w.id = p_workspace_id;

    if v_workspace.id is null or not v_workspace.is_active then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
    end if;

    if v_workspace.primary_sport_id <> v_sport_id then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
    end if;

    -- Editing a child already in the club needs no link; joining one does.
    if not exists (select 1 from public.workspace_athlete_memberships m
                    where m.workspace_id = p_workspace_id and m.athlete_id = p_athlete_id)
       and not public.can_join_workspace(p_workspace_id) then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_JOINABLE');
    end if;

    v_approved := public.is_workspace_admin(p_workspace_id);
  end if;

  begin
    insert into public.athlete_sport_profiles
      (athlete_id, sport_id, club_name, team_or_category, jersey_number, attributes)
    values (
      p_athlete_id,
      v_sport_id,
      nullif(btrim(coalesce(p_club_name, '')), ''),
      nullif(btrim(coalesce(p_team_or_category, '')), ''),
      nullif(btrim(coalesce(p_jersey_number, '')), ''),
      coalesce(p_attributes, '{}'::jsonb)
    )
    on conflict (athlete_id, sport_id) do update
      set club_name        = excluded.club_name,
          team_or_category = excluded.team_or_category,
          jersey_number    = excluded.jersey_number,
          attributes       = excluded.attributes,
          is_active        = true
    returning id into v_profile_row;

    if p_workspace_id is not null then
      insert into public.workspace_athlete_memberships
        (workspace_id, athlete_id, athlete_sport_profile_id, sport_id,
         is_active, approval, requested_by, requested_at)
      values (p_workspace_id, p_athlete_id, v_profile_row, v_sport_id,
              v_approved,
              case when v_approved then 'APPROVED' else 'PENDING' end::public.membership_approval,
              public.current_profile_id(), now())
      on conflict (workspace_id, athlete_id, athlete_sport_profile_id) do update
        set updated_at = now()
      returning id into v_membership_id;
    end if;
  exception
    when invalid_parameter_value then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SPORT_ATTRIBUTES');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ATHLETE_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'athlete_sport_profile_id', v_profile_row,
      'workspace_athlete_membership_id', v_membership_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- The administrator's list (`Žádosti o přijetí`): who waits, and who was
-- turned away, with the family to ring. Staff do not otherwise see a child
-- that is not approved (coach_can_see_athlete reads active memberships).
-- ---------------------------------------------------------------------------

create or replace function public.workspace_join_requests(p_workspace_id uuid)
returns table (
  membership_id  uuid,
  athlete_id     uuid,
  first_name     text,
  last_name      text,
  date_of_birth  date,
  position_code  text,
  approval       public.membership_approval,
  requested_at   timestamptz,
  decided_at     timestamptz,
  guardians      jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, a.id, a.first_name, a.last_name, a.date_of_birth,
         asp.attributes ->> 'position', m.approval, m.requested_at, m.decided_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'name', p.display_name, 'phone', p.phone, 'email', u.email::text)
                  order by g.created_at)
             from public.guardian_athlete_access g
             join public.app_profiles p on p.id = g.profile_id
             left join auth.users u on u.id = p.auth_user_id
            where g.athlete_id = a.id and g.status = 'ACTIVE'), '[]'::jsonb)
  from public.workspace_athlete_memberships m
  join public.athletes a on a.id = m.athlete_id
  join public.athlete_sport_profiles asp on asp.id = m.athlete_sport_profile_id
  where m.workspace_id = p_workspace_id
    and m.approval in ('PENDING', 'REJECTED')
    and public.is_workspace_admin(p_workspace_id)
  order by m.approval, m.requested_at;
$$;

create or replace function public.decide_join_request(p_membership_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_profile_id();
  v_m  record;
begin
  select * into v_m from public.workspace_athlete_memberships m where m.id = p_membership_id for update;
  if v_m.id is null or not public.is_workspace_admin(v_m.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;
  if v_m.approval <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED');
  end if;

  update public.workspace_athlete_memberships m
     set approval   = case when p_approve then 'APPROVED' else 'REJECTED' end::public.membership_approval,
         is_active  = p_approve,
         decided_by = v_me,
         decided_at = now()
   where m.id = p_membership_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (v_m.workspace_id, v_me,
          case when p_approve then 'ATHLETE_JOIN_APPROVED' else 'ATHLETE_JOIN_REJECTED' end,
          'ATHLETE', v_m.athlete_id,
          jsonb_build_object('approval', 'PENDING'),
          jsonb_build_object('approval', case when p_approve then 'APPROVED' else 'REJECTED' end));

  insert into public.notification_events (workspace_id, event_type, payload)
  values (v_m.workspace_id, 'ATHLETE_JOIN_DECIDED',
          jsonb_build_object('athlete_id', v_m.athlete_id, 'approved', p_approve,
                             'actor_profile_id', v_me));

  return jsonb_build_object('ok', true);
end;
$$;

-- A rejected child, sent again by the family — after correcting a birth year,
-- say. Waits like the first time and tells the administrators again.
create or replace function public.request_join_again(p_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_profile_id();
  v_m  record;
begin
  select * into v_m from public.workspace_athlete_memberships m where m.id = p_membership_id for update;
  if v_m.id is null or not public.has_athlete_manage_access(v_m.athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;
  if v_m.approval <> 'REJECTED' then
    return jsonb_build_object('ok', false, 'code', 'NOT_REJECTED');
  end if;

  update public.workspace_athlete_memberships m
     set approval = 'PENDING', requested_by = v_me, requested_at = now(),
         decided_by = null, decided_at = null
   where m.id = p_membership_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (v_m.workspace_id, v_me, 'ATHLETE_JOIN_REQUESTED', 'ATHLETE', v_m.athlete_id,
          jsonb_build_object('approval', 'REJECTED'), jsonb_build_object('approval', 'PENDING'));
  insert into public.notification_events (workspace_id, event_type, payload)
  values (v_m.workspace_id, 'ATHLETE_APPROVAL_REQUESTED',
          jsonb_build_object('athlete_id', v_m.athlete_id, 'actor_profile_id', v_me));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inviting a second parent. The inviter must manage every child named; the
-- address may not already guard all of them. The invitation is sent by the
-- application (like a coach's, §A6), not through the outbox: there is no
-- profile to address it to yet.
-- ---------------------------------------------------------------------------

create or replace function public.invite_guardian(p_email text, p_athlete_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := public.current_profile_id();
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_id     uuid;
  v_a      uuid;
  v_open   integer;
  v_ws     uuid;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_EMAIL');
  end if;
  if p_athlete_ids is null or cardinality(p_athlete_ids) = 0 or cardinality(p_athlete_ids) > 20 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;
  foreach v_a in array p_athlete_ids loop
    if not public.has_athlete_manage_access(v_a) then
      return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
    end if;
  end loop;

  if exists (select 1 from auth.users u join public.app_profiles p on p.auth_user_id = u.id
              where lower(u.email) = v_email and p.id = v_me) then
    return jsonb_build_object('ok', false, 'code', 'INVITING_SELF');
  end if;

  if not exists (
    select 1 from unnest(p_athlete_ids) a(id)
     where not exists (
       select 1 from public.guardian_athlete_access g
         join public.app_profiles p on p.id = g.profile_id
         join auth.users u on u.id = p.auth_user_id
        where g.athlete_id = a.id and g.status = 'ACTIVE' and lower(u.email) = v_email)) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_GUARDIAN');
  end if;

  select count(*) into v_open from public.guardian_invitations i
   where i.invited_by = v_me and i.accepted_at is null and i.revoked_at is null;
  if v_open >= 10 then
    return jsonb_build_object('ok', false, 'code', 'TOO_MANY_INVITATIONS');
  end if;

  insert into public.guardian_invitations (email, athlete_ids, invited_by)
  values (v_email, p_athlete_ids, v_me)
  returning id into v_id;

  select m.workspace_id into v_ws from public.workspace_athlete_memberships m
   where m.athlete_id = p_athlete_ids[1] order by m.created_at limit 1;
  if v_ws is not null then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (v_ws, v_me, 'GUARDIAN_INVITED', 'ATHLETE', p_athlete_ids[1], '{}'::jsonb,
            jsonb_build_object('invitation_id', v_id, 'athletes', to_jsonb(p_athlete_ids)));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'invitation_id', v_id,
    'email', v_email,
    'inviter_name', (select p.display_name from public.app_profiles p where p.id = v_me),
    'athlete_names', (select jsonb_agg(a.first_name || ' ' || a.last_name order by a.first_name)
                        from public.athletes a where a.id = any(p_athlete_ids)),
    'workspace_id', v_ws,
    'organization_name', (select w.name from public.workspaces w where w.id = v_ws),
    'organization_logo_path', (select w.logo_path from public.workspaces w where w.id = v_ws)));
end;
$$;

-- Open invitations to one child, for its guardians (G8).
create or replace function public.athlete_guardian_invitations(p_athlete_id uuid)
returns table (id uuid, email text, created_at timestamptz, invited_by_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.email, i.created_at, p.display_name
  from public.guardian_invitations i
  join public.app_profiles p on p.id = i.invited_by
  where p_athlete_id = any(i.athlete_ids)
    and i.accepted_at is null and i.revoked_at is null
    and public.has_athlete_manage_access(p_athlete_id)
  order by i.created_at desc;
$$;

create or replace function public.revoke_guardian_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_i record;
begin
  select * into v_i from public.guardian_invitations i where i.id = p_invitation_id for update;
  if v_i.id is null or not exists (
       select 1 from unnest(v_i.athlete_ids) a(id) where public.has_athlete_manage_access(a.id)) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;
  if v_i.accepted_at is not null or v_i.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED');
  end if;
  update public.guardian_invitations set revoked_at = now() where id = p_invitation_id;
  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  select m.workspace_id, public.current_profile_id(), 'GUARDIAN_INVITATION_REVOKED', 'ATHLETE',
         v_i.athlete_ids[1], '{}'::jsonb, jsonb_build_object('invitation_id', p_invitation_id)
    from public.workspace_athlete_memberships m where m.athlete_id = v_i.athlete_ids[1] limit 1;
  return jsonb_build_object('ok', true);
end;
$$;

-- Accepted by signing in with the invited address: a code to it, or Google
-- with it, both of which prove the address is the caller's. Children the
-- inviter no longer guards are left out; the rest are added as MANAGE.
create or replace function public.accept_guardian_invitations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_profile_id();
  v_email text;
  v_i     record;
  v_added integer := 0;
  v_n     integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('added', 0));
  end if;

  for v_i in
    select * from public.guardian_invitations i
     where i.email = v_email and i.accepted_at is null and i.revoked_at is null
     for update
  loop
    with added as (
      insert into public.guardian_athlete_access
        (profile_id, athlete_id, permission_level, status, invited_by)
      select v_me, a.id, 'MANAGE', 'ACTIVE', v_i.invited_by
        from unnest(v_i.athlete_ids) a(id)
       where exists (select 1 from public.guardian_athlete_access g
                      where g.athlete_id = a.id and g.profile_id = v_i.invited_by
                        and g.status = 'ACTIVE' and g.permission_level = 'MANAGE')
      on conflict (profile_id, athlete_id) do update set status = 'ACTIVE'
      returning 1
    )
    select count(*) into v_n from added;
    v_added := v_added + v_n;

    update public.guardian_invitations
       set accepted_at = now(), accepted_by = v_me
     where id = v_i.id;

    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    select m.workspace_id, v_me, 'GUARDIAN_INVITATION_ACCEPTED', 'ATHLETE', v_i.athlete_ids[1],
           '{}'::jsonb, jsonb_build_object('invitation_id', v_i.id, 'added', v_n)
      from public.workspace_athlete_memberships m where m.athlete_id = v_i.athlete_ids[1] limit 1;
  end loop;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('added', v_added));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.workspace_join_code(uuid)',
    'public.rotate_workspace_join_code(uuid)',
    'public.join_workspace(text)',
    'public.joinable_workspaces()',
    'public.create_athlete_with_guardian(text, text, date, uuid, text, jsonb, text, text, text)',
    'public.upsert_athlete_sport_profile(uuid, text, jsonb, text, text, text, uuid)',
    'public.workspace_join_requests(uuid)',
    'public.decide_join_request(uuid, boolean)',
    'public.request_join_again(uuid)',
    'public.invite_guardian(text, uuid[])',
    'public.athlete_guardian_invitations(uuid)',
    'public.revoke_guardian_invitation(uuid)',
    'public.accept_guardian_invitations()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke all on function public.workspace_join_preview(text) from public;
grant execute on function public.workspace_join_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- E11 and E12: recipients, restated from migration 49.
-- ---------------------------------------------------------------------------

create or replace function public.notification_event_recipients(p_event_id uuid)
returns table (
  recipient_profile_id uuid,
  athlete_ids          uuid[],
  athlete_names        text[],
  booking_ids          uuid[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with event as (
    select e.id, e.training_session_id, e.event_type, e.payload
    from public.notification_events e
    where e.id = p_event_id
  ),
  affected as (
    select case
      when ev.event_type in ('SESSION_ELIGIBILITY_NARROWED',
                             'BOOKING_REMOVED_BY_COACH',
                             'BOOKING_ADDED_BY_COACH',
                             'COACH_MESSAGE_TO_GUARDIAN')
      then array(select (value #>> '{}')::uuid
                 from jsonb_array_elements(coalesce(ev.payload -> 'affected_athlete_ids', '[]'::jsonb)))
      else null
    end as athlete_ids
    from event ev
  ),
  -- The athletes to tell about. For a removal they are named outright; for
  -- everything else they are whoever holds a confirmed place.
  subjects as (
    select a.id, a.first_name, a.last_name
    from event ev
    cross join affected af
    join public.athletes a on a.id = any(af.athlete_ids)
    where ev.event_type = 'BOOKING_REMOVED_BY_COACH'

    union

    select a.id, a.first_name, a.last_name
    from event ev
    cross join affected af
    join public.bookings b
      on b.training_session_id = ev.training_session_id
     and b.status = 'CONFIRMED'
    join public.athletes a on a.id = b.athlete_id
    where ev.event_type <> 'BOOKING_REMOVED_BY_COACH'
      and (af.athlete_ids is null or a.id = any(af.athlete_ids))
  ),
  with_booking as (
    select
      s.id, s.first_name, s.last_name,
      (select b.id
         from public.bookings b
         cross join event ev
        where b.training_session_id = ev.training_session_id
          and b.athlete_id = s.id
        order by b.created_at desc
        limit 1) as booking_id
    from subjects s
  )
  select
    gaa.profile_id,
    array_agg(s.id order by s.first_name, s.last_name),
    array_agg(s.first_name || ' ' || s.last_name order by s.first_name, s.last_name),
    array_remove(array_agg(s.booking_id order by s.first_name, s.last_name), null)
  from with_booking s
  join public.guardian_athlete_access gaa
    on gaa.athlete_id = s.id
   and gaa.status = 'ACTIVE'
  cross join event ev
  where ev.event_type not in ('GUARDIAN_ABSENCE_TO_COACH', 'ATHLETE_APPROVAL_REQUESTED',
                              'ATHLETE_JOIN_DECIDED')
  group by gaa.profile_id

  union all

  -- E10, the one e-mail to the staff: the training's main coach, or every
  -- active administrator of a training that has none (K2e). About the athlete
  -- the guardian withdrew, whose booking is no longer confirmed.
  select staff.profile_id,
         array[a.id],
         array[a.first_name || ' ' || a.last_name],
         array[(ev.payload ->> 'booking_id')::uuid]
  from event ev
  join public.training_sessions s on s.id = ev.training_session_id
  join public.athletes a on a.id = (ev.payload ->> 'athlete_id')::uuid
  cross join lateral (
    select s.main_coach_profile_id as profile_id
     where s.main_coach_profile_id is not null
    union
    select m.profile_id
      from public.workspace_members m
     where s.main_coach_profile_id is null
       and m.workspace_id = s.workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
  ) staff
  where ev.event_type = 'GUARDIAN_ABSENCE_TO_COACH'

  union all

  -- E11 (migration 50): a child waits for approval. Every active
  -- administrator of the club is told.
  select m.profile_id,
         array[a.id],
         array[a.first_name || ' ' || a.last_name],
         array[]::uuid[]
  from event ev
  join public.athletes a on a.id = (ev.payload ->> 'athlete_id')::uuid
  join public.workspace_members m
    on m.workspace_id = (select e.workspace_id from public.notification_events e where e.id = ev.id)
   and m.role = 'WORKSPACE_ADMIN'
   and m.is_active
  where ev.event_type = 'ATHLETE_APPROVAL_REQUESTED'

  union all

  -- E12 (migration 50): the club decided. The child's active guardians.
  select gaa.profile_id,
         array[a.id],
         array[a.first_name || ' ' || a.last_name],
         array[]::uuid[]
  from event ev
  join public.athletes a on a.id = (ev.payload ->> 'athlete_id')::uuid
  join public.guardian_athlete_access gaa
    on gaa.athlete_id = a.id and gaa.status = 'ACTIVE'
  where ev.event_type = 'ATHLETE_JOIN_DECIDED';
$$;

revoke all on function public.notification_event_recipients(uuid) from public;
