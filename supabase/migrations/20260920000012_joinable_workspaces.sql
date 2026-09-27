-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 12 — workspaces an athlete may be registered into
--
-- Found while building the athlete form. There is a chicken-and-egg problem in
-- the very first thing a new parent does:
--
--   create_athlete_with_guardian() takes a workspace id, but
--   workspaces_select_related only shows a workspace to someone who already has
--   an athlete there (D-01). A parent with no athlete yet can read no workspace
--   at all, so the form has nothing to submit.
--
-- The fix is an explicit, narrow function rather than widening the row policy.
-- Widening it would make every workspace readable to every authenticated user
-- for all purposes; this exposes one specific fact — which workspaces accept a
-- registration — and nothing else.
--
-- What it deliberately does NOT return: member counts, coach identities,
-- session counts, athlete counts. Only what the registration form must render.
--
-- When invitation-based joining arrives (PRD §6, post-MVP), this function is
-- the gate that changes: it becomes "workspaces this user has been invited to",
-- and no policy or call site has to move.

create or replace function public.joinable_workspaces()
returns table (
  id               uuid,
  name             text,
  primary_sport_id uuid,
  sport_code       text,
  timezone         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.primary_sport_id, s.code, w.timezone
  from public.workspaces w
  join public.sports s on s.id = w.primary_sport_id
  where w.is_active
    -- Signed in, but nothing else required: registering a child is how a parent
    -- joins, and D-01 already ensures that seeing a workspace exists grants no
    -- access to its sessions, athletes or rosters.
    and public.current_profile_id() is not null
  order by w.name;
$$;

revoke all on function public.joinable_workspaces() from public;
grant execute on function public.joinable_workspaces() to authenticated;
