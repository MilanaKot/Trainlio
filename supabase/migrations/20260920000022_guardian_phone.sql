-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS + DOMAIN OPERATIONS
-- 22 — the parent's telephone number
--
-- DESIGN_BRIEF decision 18 and coach/SPEC.md §K2: a coach who moves a training
-- at short notice can ring the families. The number is optional, the parent
-- gives it themselves, and it exists for exactly that one purpose.
--
-- It is the first personal contact detail this schema stores. The email never
-- was one: it lives in auth.users and is read server-side only, which is why
-- app_profiles has no email column and says so in its own comment. A telephone
-- number cannot be borrowed from the authentication record, so it is stored
-- here — and everything below is about making sure it is no easier to reach
-- than it has to be.
--
-- Three decisions follow from that:
--
--   1. No policy exposes it. A coach cannot read a guardian's profile row at
--      all, deliberately (see migration 16's note on session_roster), and this
--      does not widen that by a column. The number is reachable only through a
--      function, and only for one booking at a time — so opening one athlete
--      in the roster reveals one family's number, and rendering the roster
--      reveals none.
--   2. It is erased with the name. The D-18 stamp clears it in the same
--      trigger, so any path that anonymises a profile takes the number too.
--   3. It is never copied anywhere. It does not enter the notification outbox,
--      which holds delivery addresses under a retention window, and it does
--      not enter the audit log. There is nothing to scrub later because there
--      is only ever one copy.

alter table public.app_profiles add column phone text;

-- Two shapes, and the reason is who types them.
--
-- A parent writing down their own number writes `777 123 456`. Demanding
-- `+420` first is a form telling someone their own telephone number is wrong,
-- and both ends of this call are in the same country — a `tel:` link on a
-- local number dials perfectly well from the coach's phone.
--
-- So: a leading `+` means the international form and is held to E.164 strictly,
-- and anything else is a plain national number of a sane length. The form
-- strips the spaces, brackets and dashes people write; this refuses what the
-- form did not.
alter table public.app_profiles
  add constraint app_profiles_phone_shape
    check (phone is null or phone ~ '^(\+[1-9][0-9]{7,14}|[0-9]{6,15})$');

comment on column public.app_profiles.phone is
  'Optional contact number the guardian provides, in E.164 when it starts with + and national digits otherwise. No policy exposes it: coaches read it through booking_guardians() for one booking at a time, and the D-18 stamp clears it.';

-- ---------------------------------------------------------------------------
-- The stamp clears the number as well as the name.
--
-- Replaces the trigger from migration 21, which only knew about the name. The
-- function is renamed because it no longer only derives a display name, and a
-- function whose name understates what it erases is the kind of thing that
-- gets missed in a review of the next migration.
-- ---------------------------------------------------------------------------

create or replace function public.app_profiles_normalise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- D-18. Everything personal this table holds goes at the same moment,
  -- whatever path stamped the profile.
  if tg_op = 'UPDATE' and new.anonymized_at is not null and old.anonymized_at is null then
    new.first_name := null;
    new.last_name  := null;
    new.phone      := null;
  end if;

  new.first_name   := nullif(btrim(coalesce(new.first_name, '')), '');
  new.last_name    := nullif(btrim(coalesce(new.last_name, '')), '');
  new.phone        := nullif(btrim(coalesce(new.phone, '')), '');
  new.display_name := nullif(btrim(concat_ws(' ', new.first_name, new.last_name)), '');

  return new;
end;
$$;

revoke all on function public.app_profiles_normalise() from public;

drop trigger trg_app_profiles_derive_display_name on public.app_profiles;
drop function public.app_profiles_derive_display_name();

create trigger trg_app_profiles_normalise
  before insert or update on public.app_profiles
  for each row execute function public.app_profiles_normalise();

-- The owner writes their own number, the same way they write their own name.
grant update (phone) on public.app_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- The families behind one booking.
--
-- Per booking rather than per roster, on purpose. The roster is a list a coach
-- reads at the rink, often with twenty rows on it; the phone number belongs to
-- the one athlete they tapped. Returning every family's number with the list
-- would put twenty of them on the wire to answer a question about one.
--
-- An athlete may have several active guardians (BR-002), so this returns all of
-- them rather than picking one and calling it "the parent". The design shows a
-- single row because a single guardian is the common case, not because a second
-- one should be hidden from the person trying to reach the family.
-- ---------------------------------------------------------------------------

create or replace function public.booking_guardians(p_booking_id uuid)
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
  select p.id, p.display_name, p.phone
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.guardian_athlete_access g on g.athlete_id = b.athlete_id
  join public.app_profiles p on p.id = g.profile_id
  where b.id = p_booking_id
    and g.status = 'ACTIVE'
    and p.anonymized_at is null
    -- The only key: an active coach of the workspace that runs this session.
    -- A guardian calling it for their own booking gets nothing, because this
    -- is not how a family reads its own data.
    and public.is_workspace_coach(s.workspace_id)
  order by p.display_name nulls last, p.id;
$$;

revoke all on function public.booking_guardians(uuid) from public;
grant execute on function public.booking_guardians(uuid) to authenticated;
