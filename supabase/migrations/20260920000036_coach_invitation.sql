-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS + DOMAIN OPERATIONS
-- 36 — a coach who can sign in (handoff v3, DR-07: admin/SPEC.md §A1–A3c, §A6)
--
-- The largest hole in the admin area. A coach added on A2 existed immediately
-- and could lead trainings, which was deliberate (migration 21: the club's
-- first coach exists on the ice before they exist in a database) — but nobody
-- could give them a login, and migration 21 said so outright: linking such a
-- profile to an authentication record "needs its own operation, its own audit
-- entry and its own conversation". This is that operation.
--
-- Where the address lives is the first decision. `app_profiles` deliberately
-- holds no email: a guardian's is in `auth.users` and is read server-side only.
-- An invited coach has no `auth.users` row yet, so the address has to be stored
-- somewhere before it exists — and the natural place is the table migration 33
-- made for exactly this kind of thing: staff contact details, with no grant to
-- any client role and no policy, reachable only through functions that answer
-- one question each.
--
-- So `staff_contacts` becomes what a club knows about its staff: how to reach
-- them, and how they sign in.
--
-- The access state is derived, never stored (§A2 data):
--
--   no_email   -> no address: the coach can lead trainings, not sign in
--   invited    -> an address and no first sign-in yet
--   signed_in  -> they have been in
--
-- Invitations never expire. Signing in is always a code to an e-mail address,
-- so an invitation is a convenience link and not a credential; an unaccepted
-- one simply stays `Pozván`.

alter table public.staff_contacts
  alter column phone drop not null,
  add column email            text,
  add column invited_at       timestamptz,
  add column first_sign_in_at timestamptz,
  add column last_seen_at     timestamptz,
  -- §K0 is shown once, after the first sign-in. Stamped when the coach
  -- continues past it, so a sign-in that never finished shows it again.
  add column welcomed_at      timestamptz;

alter table public.staff_contacts
  add constraint staff_contacts_email_shape
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Case-insensitively unique across the staff: two coaches sharing a sign-in
  -- address would make "who is signing in" unanswerable.
  add constraint staff_contacts_something_to_hold
    check (phone is not null or email is not null or invited_at is not null
           or first_sign_in_at is not null or welcomed_at is not null);

create unique index staff_contacts_email_unique on public.staff_contacts (lower(email))
  where email is not null;

comment on column public.staff_contacts.email is
  'The address this coach signs in with (§A2). Not in app_profiles, which holds no email by design: an invited coach has no auth.users row yet, and this table is already unreadable by every client role.';
comment on column public.staff_contacts.last_seen_at is
  'Stamped at most hourly by touch_staff_seen(), for the `Naposledy v aplikaci` line on §A3.';

-- ---------------------------------------------------------------------------
-- The first sign-in attaches the invited profile instead of making a new one.
--
-- Without this the invitation would be pointless: signing up creates a profile
-- (migration 10), the coach would get a second one, and the trainings they
-- already lead would hang off the first. The match is on the address an
-- administrator recorded, which is the only thing the two have in common
-- before the first sign-in.
--
-- Narrow on purpose. It attaches only a profile that
--   * has an address recorded by an administrator,
--   * has never been attached to a login,
--   * and is not anonymised.
-- Everything else still gets a fresh profile, exactly as before — including a
-- guardian whose address happens to match nothing, and a coach signing in again
-- after their login was deleted (D-18 keeps those apart deliberately).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  if new.email is not null then
    select c.profile_id into v_profile
    from public.staff_contacts c
    join public.app_profiles p on p.id = c.profile_id
    where lower(c.email) = lower(new.email)
      and p.auth_user_id is null
      and p.anonymized_at is null
    limit 1;
  end if;

  if v_profile is not null then
    update public.app_profiles p
       set auth_user_id = new.id
     where p.id = v_profile;

    update public.staff_contacts c
       set first_sign_in_at = coalesce(c.first_sign_in_at, now()),
           last_seen_at = now()
     where c.profile_id = v_profile;

    return new;
  end if;

  insert into public.app_profiles (auth_user_id)
  values (new.id)
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

-- ---------------------------------------------------------------------------
-- `Naposledy v aplikaci` (§A3).
--
-- Written at most hourly: this is a line on one administrative screen, not an
-- analytics event, and a write on every page load would turn every coach's
-- navigation into a database write.
-- ---------------------------------------------------------------------------

create or replace function public.touch_staff_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    return;
  end if;

  if not exists (
    select 1 from public.workspace_members m where m.profile_id = v_actor and m.is_active
  ) then
    return;
  end if;

  insert into public.staff_contacts (profile_id, last_seen_at, first_sign_in_at)
  values (v_actor, now(), now())
  on conflict (profile_id) do update
    set last_seen_at = now(),
        first_sign_in_at = coalesce(public.staff_contacts.first_sign_in_at, now())
  where public.staff_contacts.last_seen_at is null
     or public.staff_contacts.last_seen_at < now() - interval '1 hour';
end;
$$;

revoke all on function public.touch_staff_seen() from public;
grant execute on function public.touch_staff_seen() to authenticated;

-- ---------------------------------------------------------------------------
-- §K0, shown once.
-- ---------------------------------------------------------------------------

create or replace function public.complete_staff_welcome(p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()\-/]', '', 'g'), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if v_phone is not null and v_phone !~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$' then
    return jsonb_build_object('ok', false, 'code', 'PHONE_MALFORMED');
  end if;

  insert into public.staff_contacts (profile_id, phone, welcomed_at, first_sign_in_at, last_seen_at)
  values (v_actor, v_phone, now(), now(), now())
  on conflict (profile_id) do update
    set welcomed_at = now(),
        phone = coalesce(excluded.phone, public.staff_contacts.phone),
        first_sign_in_at = coalesce(public.staff_contacts.first_sign_in_at, now()),
        last_seen_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.complete_staff_welcome(text) from public;
grant execute on function public.complete_staff_welcome(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who am I, and have I been welcomed? (§K0, §A3 "To jste vy")
-- ---------------------------------------------------------------------------

create or replace function public.own_staff_state()
returns table (
  profile_id       uuid,
  is_staff         boolean,
  is_admin         boolean,
  phone            text,
  email            text,
  first_sign_in_at timestamptz,
  welcomed_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    exists (select 1 from public.workspace_members m
             where m.profile_id = p.id and m.is_active),
    exists (select 1 from public.workspace_members m
             where m.profile_id = p.id and m.is_active and m.role = 'WORKSPACE_ADMIN'),
    c.phone,
    c.email,
    c.first_sign_in_at,
    c.welcomed_at
  from public.app_profiles p
  left join public.staff_contacts c on c.profile_id = p.id
  where p.id = public.current_profile_id();
$$;

revoke all on function public.own_staff_state() from public;
grant execute on function public.own_staff_state() to authenticated;

-- ---------------------------------------------------------------------------
-- An administrator records the address (§A2, §A3, §A3c).
--
-- The uniqueness rule is "nobody else in this application", which is wider than
-- the staff: a guardian signing in with that address would be attached to this
-- coach's profile by the trigger above, and would find themselves looking at
-- the club's trainings. The index covers the staff; this covers the rest, by
-- reading auth.users — which only a definer function can do.
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
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED',
    -- An administrator gave a coach a way in, or took it away.
    'MEMBER_ACCESS_CHANGED',
    'MEMBER_INVITED'
  )
);

create or replace function public.set_member_email(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_email        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_email  text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_before text;
  v_linked uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

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

  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_MALFORMED');
  end if;

  select c.email into v_before from public.staff_contacts c where c.profile_id = p_profile_id;

  if v_email is not null then
    -- Another coach, or anybody who already signs in with it.
    if exists (
      select 1 from public.staff_contacts c
       where lower(c.email) = v_email and c.profile_id <> p_profile_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN');
    end if;

    select p.id into v_linked
      from auth.users u
      join public.app_profiles p on p.auth_user_id = u.id
     where lower(u.email) = v_email;

    if v_linked is not null and v_linked <> p_profile_id then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN');
    end if;
  end if;

  if v_email is null then
    update public.staff_contacts c set email = null, invited_at = null
     where c.profile_id = p_profile_id;
  else
    insert into public.staff_contacts (profile_id, email)
    values (p_profile_id, v_email)
    on conflict (profile_id) do update set email = excluded.email, updated_at = now();
  end if;

  if v_before is distinct from v_email then
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values
      (p_workspace_id, v_actor, 'MEMBER_ACCESS_CHANGED', 'PROFILE', p_profile_id,
       jsonb_build_object('email_present', v_before is not null),
       jsonb_build_object('email_present', v_email is not null));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'email', v_email,
    'changed', v_before is distinct from v_email));
end;
$$;

revoke all on function public.set_member_email(uuid, uuid, text) from public;
grant execute on function public.set_member_email(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The invitation, in two halves (§A6).
--
-- `prepare` checks and returns what the message needs; `record` stamps it after
-- the provider has accepted it. Two calls rather than one because the stamp is
-- the rate limit: stamping before sending would lock an administrator out for
-- an hour over a message that never went.
-- ---------------------------------------------------------------------------

create or replace function public.prepare_coach_invitation(
  p_workspace_id uuid,
  p_profile_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_contact record;
  v_name    text;
  v_admin   text;
  v_org     record;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select c.* into v_contact from public.staff_contacts c where c.profile_id = p_profile_id;

  if v_contact.email is null then
    return jsonb_build_object('ok', false, 'code', 'NO_EMAIL');
  end if;

  if v_contact.first_sign_in_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SIGNED_IN');
  end if;

  -- §A3b: once an hour, per coach.
  if v_contact.invited_at is not null and v_contact.invited_at > now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
      'details', jsonb_build_object('invited_at', v_contact.invited_at));
  end if;

  select p.display_name into v_name from public.app_profiles p where p.id = p_profile_id;
  select p.display_name into v_admin from public.app_profiles p where p.id = v_actor;
  select w.name, w.short_name, w.logo_path into v_org
    from public.workspaces w where w.id = p_workspace_id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'email', v_contact.email,
    'coach_name', v_name,
    'admin_name', v_admin,
    'organization_name', v_org.name,
    'organization_logo_path', v_org.logo_path));
end;
$$;

revoke all on function public.prepare_coach_invitation(uuid, uuid) from public;
grant execute on function public.prepare_coach_invitation(uuid, uuid) to authenticated;

create or replace function public.record_coach_invitation(
  p_workspace_id uuid,
  p_profile_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  update public.staff_contacts c
     set invited_at = now()
   where c.profile_id = p_profile_id
     and c.email is not null;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_EMAIL');
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_INVITED', 'PROFILE', p_profile_id,
     jsonb_build_object('invited_at', now()));

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_coach_invitation(uuid, uuid) from public;
grant execute on function public.record_coach_invitation(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The roster carries the access state (§A1, §A3).
-- ---------------------------------------------------------------------------

drop function public.workspace_staff(uuid);

create function public.workspace_staff(p_workspace_id uuid)
returns table (
  profile_id       uuid,
  first_name       text,
  last_name        text,
  display_name     text,
  roles            public.workspace_role[],
  is_active        boolean,
  has_login        boolean,
  is_editable      boolean,
  future_sessions  integer,
  phone            text,
  email            text,
  invited_at       timestamptz,
  first_sign_in_at timestamptz,
  last_seen_at     timestamptz
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
        and s.start_at > now()),
    -- Contact details go to an administrator, and to the coach themselves.
    -- A coach does not get a directory of their colleagues out of a screen
    -- they cannot write to.
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.phone end,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.email end,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.invited_at end,
    c.first_sign_in_at,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.last_seen_at end
  from public.workspace_members m
  join public.app_profiles p on p.id = m.profile_id
  left join public.staff_contacts c on c.profile_id = p.id
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  group by p.id, p.first_name, p.last_name, p.display_name, p.auth_user_id, p.anonymized_at,
           c.phone, c.email, c.invited_at, c.first_sign_in_at, c.last_seen_at
  order by bool_or(m.is_active) desc, p.last_name nulls last, p.first_name nulls last;
$$;

revoke all on function public.workspace_staff(uuid) from public;
grant execute on function public.workspace_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Adding a coach, with the two things §A2 now asks for.
-- ---------------------------------------------------------------------------

-- Dropped first: adding parameters with defaults creates a second function
-- rather than replacing the first, and a three-argument call would then match
-- both and fail as ambiguous.
drop function public.create_workspace_coach(uuid, text, text, public.workspace_role);

create function public.create_workspace_coach(
  p_workspace_id uuid,
  p_first_name   text,
  p_last_name    text,
  p_role         public.workspace_role default 'COACH',
  p_email        text default null,
  p_phone        text default null
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
  v_email   text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()\-/]', '', 'g'), '');
  v_profile uuid;
  v_linked  uuid;
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

  if v_email is not null then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_MALFORMED');
    end if;

    if exists (select 1 from public.staff_contacts c where lower(c.email) = v_email) then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN');
    end if;

    select p.id into v_linked
      from auth.users u join public.app_profiles p on p.auth_user_id = u.id
     where lower(u.email) = v_email;

    if v_linked is not null then
      return jsonb_build_object('ok', false, 'code', 'EMAIL_TAKEN');
    end if;
  end if;

  if v_phone is not null and v_phone !~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$' then
    return jsonb_build_object('ok', false, 'code', 'PHONE_MALFORMED');
  end if;

  insert into public.app_profiles (first_name, last_name)
  values (v_first, v_last)
  returning id into v_profile;

  insert into public.workspace_members (workspace_id, profile_id, role)
  values (p_workspace_id, v_profile, p_role);

  if v_email is not null or v_phone is not null then
    insert into public.staff_contacts (profile_id, email, phone)
    values (v_profile, v_email, v_phone);
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_ADDED', 'PROFILE', v_profile,
     jsonb_build_object('first_name', v_first, 'last_name', v_last, 'role', p_role,
                        'email_present', v_email is not null));

  return jsonb_build_object(
    'ok', true,
    'profile_id', v_profile,
    'display_name', v_first || ' ' || v_last);
end;
$$;

revoke all on function public.create_workspace_coach(
  uuid, text, text, public.workspace_role, text, text) from public;
grant execute on function public.create_workspace_coach(
  uuid, text, text, public.workspace_role, text, text) to authenticated;
