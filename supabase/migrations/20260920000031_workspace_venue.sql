-- Trainlio — Sports Training Booking Platform
-- Layer: CORE DATA
-- 31 — the venue under the club's name
--
-- G1's header reads `Lední hokej · Příbram`. The sport came from the workspace
-- and the venue from whichever training happened to be first in the list,
-- which is fine until the list is empty: a parent who has just signed up and
-- has no trainings to see was told the sport and not where it happens.
--
-- The venue belongs to the workspace, so it comes from there. One more field
-- on the function the parent already reads, and nothing new is exposed: the
-- name of the rink is on the poster at the rink.

drop function if exists public.joinable_workspaces();

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
         -- The workspace's venue. Null rather than a guess when it trains in
         -- several places: the header has room for one, and naming one of
         -- three would be wrong two-thirds of the time.
         -- max() over a set the HAVING has already restricted to exactly one
         -- row: an aggregate is how a scalar subquery can say "only if there
         -- is precisely one", and it returns no row — hence null — otherwise.
         (select max(l.name)
            from public.locations l
           where l.workspace_id = w.id and l.is_active
          having count(*) = 1)
  from public.workspaces w
  join public.sports s on s.id = w.primary_sport_id
  where w.is_active
    -- Signed in, but nothing else required: registering a child is how a parent
    -- joins, and D-01 already ensures that seeing a workspace exists grants no
    -- access to its sessions, athletes or rosters.
    and public.current_profile_id() is not null
  order by w.name;
$$;

comment on function public.joinable_workspaces() is
  'Workspaces accepting a registration, for the first athlete form (migration 12) and the club header on the training list. Deliberately returns no counts and no identities — only what the interface renders. When invitation-based joining arrives this is the one gate that changes.';

revoke all on function public.joinable_workspaces() from public;
grant execute on function public.joinable_workspaces() to authenticated;
