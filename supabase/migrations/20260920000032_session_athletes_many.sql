-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 32 — the parent's picker, for a whole list at once
--
-- `/treninky` renders one card per upcoming training, and each card knows which
-- of this family's children may be booked into it. That answer came from
-- `guardian_session_athletes`, one call per card — fine for a club with four
-- trainings on the board and not fine for one with forty, where a single page
-- load opened forty round trips and, on a local stack, ran the server out of
-- sockets before the page rendered.
--
-- This is the same question asked once. It calls the same function per session
-- rather than reimplementing the predicates, so the list and the card cannot
-- disagree about who may book: eligibility, the latest booking and D-06's
-- "removed by the coach" all still come from one place.

create or replace function public.guardian_session_athletes_many(
  p_training_session_ids uuid[]
)
returns table (
  training_session_id uuid,
  athlete_id       uuid,
  first_name       text,
  last_name        text,
  date_of_birth    date,
  eligibility      text,
  booking_status   public.booking_status,
  removed_by_coach boolean,
  can_book         boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, x.*
  from unnest(coalesce(p_training_session_ids, '{}'::uuid[])) as s(id)
  cross join lateral public.guardian_session_athletes(s.id) x;
$$;

comment on function public.guardian_session_athletes_many(uuid[]) is
  'The guardian picker for several trainings in one call (migration 32). Delegates per session to guardian_session_athletes, which is where the eligibility and re-booking rules live.';

revoke all on function public.guardian_session_athletes_many(uuid[]) from public;
grant execute on function public.guardian_session_athletes_many(uuid[]) to authenticated;
