-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 38 — the welcome screen belongs to the invitation (§K0)
--
-- Migration 36 stamped `first_sign_in_at` from two places: the trigger that
-- attaches an invited coach to their new login, which is what it is for, and
-- `touch_staff_seen()`, which only means "somebody opened the app".
--
-- The second one is wrong, and the browser suite found it: a coach who was
-- already a user and was then granted the role — which is how every coach in
-- the tests, and every coach of this club so far, became one — had the column
-- stamped on their next page load. §K1 then sent them to the welcome screen,
-- which is for somebody arriving from an invitation and reads very oddly to
-- somebody who has been using the app for a month.
--
-- `first_sign_in_at` means what §A2 says it means: the first sign-in *of an
-- invited coach*. That is what makes the access state `Přihlášen` rather than
-- `Pozván`, and it is the only thing §K0 should ever hang on.

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

  insert into public.staff_contacts (profile_id, last_seen_at)
  values (v_actor, now())
  on conflict (profile_id) do update
    set last_seen_at = now()
  where public.staff_contacts.last_seen_at is null
     or public.staff_contacts.last_seen_at < now() - interval '1 hour';
end;
$$;

revoke all on function public.touch_staff_seen() from public;
grant execute on function public.touch_staff_seen() to authenticated;

-- The same correction to anything already stamped by the old version: a coach
-- with no invitation address was never invited, so they never had a first
-- sign-in in the sense this column records.
update public.staff_contacts c
   set first_sign_in_at = null
 where c.email is null
   and c.first_sign_in_at is not null;
