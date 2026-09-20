-- Trainlio — Sports Training Booking Platform
-- Layers: DATABASE INVARIANTS and RLS AUTHORIZATION
-- 10 — Supabase Auth integration
--
-- Without this migration the entire authorization model is inert: every policy
-- resolves the caller through public.current_profile_id(), which looks up
-- app_profiles by auth_user_id. Signing in through OTP creates a row in
-- auth.users and nothing else, so a new user would have no profile, every
-- predicate would return null, and every query would come back empty.

-- ---------------------------------------------------------------------------
-- A profile is created for each new authentication identity.
--
-- Note what is NOT copied: the email stays in auth.users and is read
-- server-side only (PERMISSIONS, email privacy). display_name starts null and
-- the guardian sets it in Účet, so no personal data is written into a domain
-- table by the act of signing up.
--
-- If an authentication identity is later deleted and the person signs up again,
-- they receive a NEW profile. The old one keeps auth_user_id null and continues
-- to own its history (D-18). The two are deliberately not reconciled here:
-- merging identities is an administrative decision, not a signup side effect.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_profiles (auth_user_id)
  values (new.id)
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Backfill, so the trigger is not the only path. Makes this migration safe to
-- apply to a project that already has users, and idempotent on re-run.
-- ---------------------------------------------------------------------------

insert into public.app_profiles (auth_user_id)
select u.id
from auth.users u
where not exists (
  select 1 from public.app_profiles p where p.auth_user_id = u.id
);

-- ---------------------------------------------------------------------------
-- Self-service profile creation, for the case the trigger did not fire — a
-- user imported by an administrator, or a project where the trigger was added
-- after the fact. Idempotent, and it can only ever create a profile for the
-- caller's own authentication identity.
-- ---------------------------------------------------------------------------

create or replace function public.ensure_current_profile()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_uid    uuid := auth.uid();
  v_profile_id  uuid;
begin
  if v_auth_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select p.id into v_profile_id
  from public.app_profiles p
  where p.auth_user_id = v_auth_uid;

  if v_profile_id is not null then
    return v_profile_id;
  end if;

  insert into public.app_profiles (auth_user_id)
  values (v_auth_uid)
  on conflict (auth_user_id) do nothing
  returning id into v_profile_id;

  if v_profile_id is null then
    select p.id into v_profile_id
    from public.app_profiles p
    where p.auth_user_id = v_auth_uid;
  end if;

  return v_profile_id;
end;
$$;

revoke all on function public.ensure_current_profile() from public;
grant execute on function public.ensure_current_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- A profile row must never be created by a client directly: app_profiles.id is
-- the actor identity that every booking, session and audit row points at, and a
-- client-chosen id, or a second profile claiming someone else's auth_user_id,
-- would corrupt attribution. Creation is the trigger's job, or
-- ensure_current_profile()'s. The policies in migration 07 grant no INSERT.
--
-- A guardian may set their own display_name and nothing else. That is expressed
-- as a column-level grant in migration 07:
--
--     grant update (display_name) on public.app_profiles to authenticated;
--
-- rather than as a trigger. A trigger would have to ask which role is acting in
-- order to let the service role sever a link or stamp anonymized_at when the
-- deferred D-18 workflow is built; a column grant simply does not extend to
-- those columns for the authenticated role, and leaves the service role
-- unaffected. Privileges and policies are checked independently, so both must
-- allow the write.
-- ---------------------------------------------------------------------------
