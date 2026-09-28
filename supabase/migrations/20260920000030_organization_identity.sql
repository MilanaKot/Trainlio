-- Trainlio — Sports Training Booking Platform
-- Layer: CORE DATA + RLS AUTHORIZATION (storage)
-- 30 — the organization's identity: name, short name, logo and its background
--
-- The design handoff calls this an "organization" and gives it its own table.
-- This schema already has one, under the name it has carried since migration 2:
-- a workspace *is* the club or training centre, and it is the entity every
-- session, athlete and membership already hangs from. A second table holding a
-- name and a logo beside it would be a synonym, not a boundary, and principle
-- 11 would then have to keep two of them in step for every future club. So
-- Organization is read here as the guardian-facing face of a workspace, and
-- the three fields the design adds are added to the row that already exists.
--
-- What is new:
--   short_name       the name for places the full one does not fit (A4)
--   logo_background  whether the mark is drawn on a white plate or bare
--   logo_updated_at  the cache-buster the public URL carries as ?v=
--
-- Migration 29 shipped the logo itself, and its bucket and policies stand.

alter table public.workspaces
  add column if not exists short_name      text,
  add column if not exists logo_background text not null default 'white',
  add column if not exists logo_updated_at timestamptz;

alter table public.workspaces
  add constraint workspaces_name_length
    check (char_length(btrim(name)) between 2 and 80);

alter table public.workspaces
  add constraint workspaces_short_name_length
    check (short_name is null or char_length(btrim(short_name)) between 1 and 24);

alter table public.workspaces
  add constraint workspaces_logo_background_known
    check (logo_background in ('white', 'transparent'));

comment on column public.workspaces.short_name is
  'Optional name for places the full one does not fit. Null means use `name`; the interface never abbreviates on its own.';

comment on column public.workspaces.logo_background is
  'How the mark is drawn: `white` puts it on a white plate (a logo drawn for paper disappears on the app grey), `transparent` lets a badge or shield stand on its own. Chosen by the administrator who uploads it, because only they can see which one it is.';

comment on column public.workspaces.logo_updated_at is
  'When the mark last changed. Travels in the public URL as ?v= so a CDN cannot serve the previous one, and is null for a workspace that never had a mark.';

-- ---------------------------------------------------------------------------
-- The bucket now takes one format.
--
-- The browser crops every upload to a 512 px PNG before it leaves the page,
-- including an SVG, which is rasterised there and never stored: a stored SVG
-- is a script the CDN would serve from our own origin. Narrowing the bucket to
-- PNG makes that a rule storage itself keeps, rather than one the server action
-- is trusted to apply.
-- ---------------------------------------------------------------------------

update storage.buckets
   set file_size_limit   = 2 * 1024 * 1024,
       allowed_mime_types = array['image/png']
 where id = 'workspace-logos';

-- ---------------------------------------------------------------------------
-- Changing the identity.
--
-- Through functions rather than an UPDATE grant, for the reason migration 29
-- gave: `workspaces` also carries the timezone and the cancellation deadline,
-- and an administrator who may rename the club has no business holding a
-- column grant next to those.
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
    'WORKSPACE_LOGO_CHANGED',
    'WORKSPACE_IDENTITY_CHANGED'
  )
);

-- The logo function gains the background, and stamps logo_updated_at.
drop function if exists public.set_workspace_logo(uuid, text);

create or replace function public.set_workspace_logo(
  p_workspace_id uuid,
  -- Optional, so clearing the mark is calling this without a path rather than
  -- passing an explicit null through the client's type layer.
  p_logo_path       text default null,
  p_logo_background text default 'white'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.current_profile_id();
  v_path       text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_background text := coalesce(nullif(btrim(p_logo_background), ''), 'white');
  v_before     public.workspaces%rowtype;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select * into v_before from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  if v_background not in ('white', 'transparent') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGO_BACKGROUND');
  end if;

  -- The path is checked here as well as by the column constraint, so the
  -- refusal is a code the interface can render rather than a raised violation.
  if v_path is not null
     and v_path <> 'logos/' || p_workspace_id::text || '/' || split_part(v_path, '/', 3) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGO_PATH');
  end if;

  if v_before.logo_path is not distinct from v_path
     and v_before.logo_background is not distinct from v_background then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('unchanged', true));
  end if;

  update public.workspaces w
     set logo_path       = v_path,
         logo_background = v_background,
         -- Stamped for the background too: the parent's screen changes, and the
         -- stamp is what tells a cached page that it did.
         logo_updated_at = case when v_path is null then null else now() end
   where w.id = p_workspace_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (p_workspace_id, v_actor, 'WORKSPACE_LOGO_CHANGED', 'WORKSPACE', p_workspace_id,
          jsonb_build_object('logo_path', v_before.logo_path, 'logo_background', v_before.logo_background),
          jsonb_build_object('logo_path', v_path, 'logo_background', v_background));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'logo_path', v_path,
    'logo_background', v_background));
end;
$$;

comment on function public.set_workspace_logo(uuid, text, text) is
  'Sets or clears the club mark and how it is drawn. Administrators of that workspace only (D-17), audited, and the path is validated so it can only name this workspace folder.';

revoke all on function public.set_workspace_logo(uuid, text, text) from public;
grant execute on function public.set_workspace_logo(uuid, text, text) to authenticated;

create or replace function public.set_workspace_identity(
  p_workspace_id uuid,
  p_name         text,
  p_short_name   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_name   text := btrim(coalesce(p_name, ''));
  v_short  text := nullif(btrim(coalesce(p_short_name, '')), '');
  v_before public.workspaces%rowtype;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Checked before the row is read, so an empty name is the same refusal
  -- whether or not the workspace exists.
  if char_length(v_name) < 2 then
    return jsonb_build_object('ok', false, 'code', 'NAME_REQUIRED');
  end if;

  if char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'code', 'NAME_TOO_LONG');
  end if;

  if v_short is not null and char_length(v_short) > 24 then
    return jsonb_build_object('ok', false, 'code', 'SHORT_NAME_TOO_LONG');
  end if;

  select * into v_before from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  if v_before.name = v_name and v_before.short_name is not distinct from v_short then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('unchanged', true));
  end if;

  update public.workspaces w
     set name = v_name, short_name = v_short
   where w.id = p_workspace_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (p_workspace_id, v_actor, 'WORKSPACE_IDENTITY_CHANGED', 'WORKSPACE', p_workspace_id,
          jsonb_build_object('name', v_before.name, 'short_name', v_before.short_name),
          jsonb_build_object('name', v_name, 'short_name', v_short));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'name', v_name, 'short_name', v_short));
end;
$$;

comment on function public.set_workspace_identity(uuid, text, text) is
  'Renames the club and sets its short name. Administrators of that workspace only (D-17), audited. The name a parent reads on every screen, so it is bounded here rather than trusted from the form.';

revoke all on function public.set_workspace_identity(uuid, text, text) from public;
grant execute on function public.set_workspace_identity(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The sign-in screen.
--
-- G11 shows the club above the e-mail field, and nobody is signed in yet, so
-- no row policy can answer it: `anon` reads nothing from `workspaces` and that
-- is correct. This returns the club's public face — the name and the mark a
-- parent already sees on the rink door — and nothing operational.
--
-- Only when there is exactly one active workspace. With a second one there is
-- no way to know from an anonymous request which club the visitor came for,
-- and guessing would put the wrong crest on the wrong parent's sign-in. That
-- resolution (a subdomain, or a link carrying the club) is the decision this
-- returns no rows until somebody makes.
-- ---------------------------------------------------------------------------

create or replace function public.organization_identity()
returns table (
  id              uuid,
  name            text,
  short_name      text,
  sport_code      text,
  logo_path       text,
  logo_background text,
  logo_updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.short_name, s.code, w.logo_path, w.logo_background, w.logo_updated_at
  from public.workspaces w
  join public.sports s on s.id = w.primary_sport_id
  where w.is_active
    and (select count(*) from public.workspaces a where a.is_active) = 1;
$$;

comment on function public.organization_identity() is
  'The club shown on the public sign-in screen: name, short name, sport and mark. Readable without a session by design, and deliberately empty when more than one workspace is active.';

revoke all on function public.organization_identity() from public;
grant execute on function public.organization_identity() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The parent's side, once they are in.
--
-- Reproduced in full because the return table changes: the header on G1 draws
-- the same component as the sign-in screen and needs the same three fields.
-- ---------------------------------------------------------------------------

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
  logo_updated_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.short_name, w.primary_sport_id, s.code, w.timezone,
         w.logo_path, w.logo_background, w.logo_updated_at
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

-- ---------------------------------------------------------------------------
-- The seeded workspace takes the name the design handoff gives it.
--
-- Migration 9 named it after what it does; the handoff names it after who runs
-- it, which is what a parent sees above the sign-in field. Conditional on the
-- old name, so a club that has already renamed itself keeps its own.
-- ---------------------------------------------------------------------------

update public.workspaces
   set name = 'Hokejová škola Příbram'
 where name = 'Příbram — hokejový trénink';
