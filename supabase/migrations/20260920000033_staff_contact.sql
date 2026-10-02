-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS + DOMAIN OPERATIONS
-- 33 — the coach's telephone number
--
-- Design handoff v3, decision 28 and guardian/SPEC.md §G6d: when a coach takes
-- a child off a training, the parent can no longer put them back (D-06), so the
-- one useful thing left on that screen is a way to reach the coach. The footer
-- shows the coach's name and number with `Zavolat` and `Napsat SMS`, and the
-- e-mail E07 carries the same number.
--
-- Decision 28 also says where it may NOT appear: the number is shown to parents
-- "only in the removed-by-coach footer (G6d) and e-mail E07". That sentence is
-- the whole reason this is a table rather than a column on app_profiles.
--
--   * `app_profiles.phone` is the *parent's* number. No policy exposes it; a
--     coach reads it one booking at a time through booking_guardians()
--     (migration 22).
--   * The reverse direction has no such door. `app_profiles` grants SELECT on
--     every column to `authenticated`, and policy app_profiles_select_visible_staff
--     lets a guardian read the row of any staff member they can see — which is
--     how they read the coach's name (D-11). A `staff_phone` column there would
--     therefore be readable by every parent in the club through PostgREST, for
--     every coach, which is exactly what decision 28 rules out. Narrowing that
--     by column grants would mean revoking the table grant and re-granting
--     eleven columns, and leaving the next migration's column to be forgotten.
--
-- A table with row level security and no grant to `authenticated` cannot be
-- read by a signed-in client at all, in any query, by any path — the same
-- construction `training_session_internal_notes` uses for the coach-only note
-- (D-13). Everything below is a function that answers one question for one
-- caller, and the answer a parent can get is "the coach who removed my child,
-- on this one booking".

create table public.staff_contacts (
  profile_id uuid primary key references public.app_profiles(id) on delete cascade,
  -- Same two shapes as a guardian's number and for the same reason (migration
  -- 22): a coach writes down `777 123 456`, and a `tel:` link on a national
  -- number dials perfectly well from a parent's phone in the same country.
  phone      text not null,
  updated_at timestamptz not null default now(),
  constraint staff_contacts_phone_shape
    check (phone ~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$')
);

alter table public.staff_contacts enable row level security;

-- No policy and no grant, deliberately. Not even SELECT: see the header.
revoke all on table public.staff_contacts from anon, authenticated;

comment on table public.staff_contacts is
  'A coach''s contact number (handoff v3, decision 28). Unreachable from a client session: RLS is on, no policy exists and no grant is made. Guardians read one number through removed_booking_coach(), staff through workspace_staff(), and the notification drain reads it as the service role for E07.';

-- D-18. The number goes when the person is forgotten, like every other
-- personal datum, and by any path that stamps the profile rather than only
-- through anonymize_profile(). A separate AFTER trigger rather than a line in
-- app_profiles_normalise(), because that one is BEFORE and shapes the row it is
-- given; deleting from another table is a different act and reads better with
-- its own name.
create or replace function public.staff_contacts_forget()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.staff_contacts c where c.profile_id = new.id;
  return null;
end;
$$;

revoke all on function public.staff_contacts_forget() from public;

create trigger trg_app_profiles_forget_staff_contact
  after update of anonymized_at on public.app_profiles
  for each row
  when (new.anonymized_at is not null and old.anonymized_at is null)
  execute function public.staff_contacts_forget();

-- ---------------------------------------------------------------------------
-- A coach writes down their own number (coach/SPEC.md §K0).
-- ---------------------------------------------------------------------------

create or replace function public.set_own_staff_phone(p_phone text)
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

  -- Staff only. A parent's number is `app_profiles.phone`, which they write
  -- themselves; this table is what the club shows to families, and a guardian
  -- has no business putting a row in it.
  if not exists (
    select 1 from public.workspace_members m
     where m.profile_id = v_actor and m.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_STAFF');
  end if;

  if v_phone is null then
    delete from public.staff_contacts c where c.profile_id = v_actor;
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('phone', null));
  end if;

  if v_phone !~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$' then
    return jsonb_build_object('ok', false, 'code', 'PHONE_MALFORMED');
  end if;

  insert into public.staff_contacts (profile_id, phone)
  values (v_actor, v_phone)
  on conflict (profile_id) do update
    set phone = excluded.phone, updated_at = now();

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('phone', v_phone));
end;
$$;

revoke all on function public.set_own_staff_phone(text) from public;
grant execute on function public.set_own_staff_phone(text) to authenticated;

-- ---------------------------------------------------------------------------
-- An administrator writes down a coach's number (admin/SPEC.md §A2, §A3).
--
-- Same shape as set_member_name: scoped to one workspace the caller
-- administers, and audited — because this is one person changing what parents
-- will be told about another.
--
-- What the audit entry does NOT hold is the number. Migration 22 said the
-- parent's number exists in exactly one copy and never enters the audit log or
-- the outbox; the same restraint applies here, so the entry records that a
-- number was set, cleared or replaced, and nothing a later reader could dial.
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
    'SESSION_ASSISTANTS_CHANGED',
    'BOOKING_CREATED_BY_GUARDIAN',
    'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN',
    'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED',
    'ATHLETE_ANONYMIZED',
    'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED',
    'MEMBER_ADDED',
    'MEMBER_ACTIVATED',
    'MEMBER_DEACTIVATED',
    'WORKSPACE_IDENTITY_CHANGED',
    'WORKSPACE_LOGO_CHANGED',
    -- An administrator set, replaced or cleared a coach's contact number. The
    -- number itself is never in the entry.
    'MEMBER_CONTACT_CHANGED'
  )
);

create or replace function public.set_member_phone(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_phone        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()\-/]', '', 'g'), '');
  v_before boolean;
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

  if v_phone is not null and v_phone !~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$' then
    return jsonb_build_object('ok', false, 'code', 'PHONE_MALFORMED');
  end if;

  select exists (select 1 from public.staff_contacts c where c.profile_id = p_profile_id)
    into v_before;

  if v_phone is null then
    delete from public.staff_contacts c where c.profile_id = p_profile_id;
  else
    insert into public.staff_contacts (profile_id, phone)
    values (p_profile_id, v_phone)
    on conflict (profile_id) do update
      set phone = excluded.phone, updated_at = now();
  end if;

  -- Nothing to record when a blank field is saved over an absent number.
  if v_before or v_phone is not null then
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values
      (p_workspace_id, v_actor, 'MEMBER_CONTACT_CHANGED', 'PROFILE', p_profile_id,
       jsonb_build_object('phone_present', v_before),
       jsonb_build_object('phone_present', v_phone is not null));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('phone', v_phone));
end;
$$;

revoke all on function public.set_member_phone(uuid, uuid, text) from public;
grant execute on function public.set_member_phone(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The staff roster carries the number now (admin/SPEC.md §A1–A3).
--
-- Who may see which number: an administrator sees the staff's, and everyone
-- sees their own. A coach does not get a directory of their colleagues' private
-- numbers out of a screen they cannot write to — and K0, where a coach fills in
-- their own, needs exactly their own row.
-- ---------------------------------------------------------------------------

-- A new column in the result means the old function has to go first; a
-- `create or replace` cannot change an OUT parameter list.
drop function public.workspace_staff(uuid);

create function public.workspace_staff(p_workspace_id uuid)
returns table (
  profile_id      uuid,
  first_name      text,
  last_name       text,
  display_name    text,
  roles           public.workspace_role[],
  is_active       boolean,
  has_login       boolean,
  is_editable     boolean,
  future_sessions integer,
  phone           text
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
    case
      when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
        then (select c.phone from public.staff_contacts c where c.profile_id = p.id)
    end
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
-- The coach a parent may ring about one removed booking (§G6d).
--
-- The narrowest door that makes the screen work: one booking, and only while it
-- is the removal that screen is about. A parent who asks about a booking that
-- was not removed by a coach, or about somebody else's child, gets no row —
-- not a row with a null number, which would answer the question anyway.
--
-- Whose number: the coach who removed the athlete, because that is who the
-- parent wants and whose name the screen already shows. The main coach is the
-- fallback for the one case where the canceller is unknown — a removal from
-- before migration 25 recorded `cancelled_by`, or an administrator's profile
-- that has since been forgotten.
-- ---------------------------------------------------------------------------

create or replace function public.removed_booking_coach(p_booking_id uuid)
returns table (
  profile_id   uuid,
  display_name text,
  phone        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.display_name, sc.phone
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.app_profiles c
    on c.id = coalesce(b.cancelled_by, s.main_coach_profile_id)
  left join public.staff_contacts sc on sc.profile_id = c.id
  where b.id = p_booking_id
    and b.status = 'CANCELLED_BY_COACH'
    and c.anonymized_at is null
    and (public.has_athlete_access(b.athlete_id) or public.is_workspace_coach(s.workspace_id));
$$;

revoke all on function public.removed_booking_coach(uuid) from public;
grant execute on function public.removed_booking_coach(uuid) to authenticated;
