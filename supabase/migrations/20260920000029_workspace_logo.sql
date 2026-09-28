-- Trainlio — Sports Training Booking Platform
-- Layer: CORE DATA + RLS AUTHORIZATION (storage)
-- 29 — the club's own mark
--
-- Not in the design handoff: every header there is the product's, and the only
-- brand mark is the Trainlio wordmark on the sign-in screen. Added on request,
-- and recorded in docs/DESIGN_DEVIATIONS.md.
--
-- Per workspace rather than a file in the repository, because principle 11
-- says today's features must survive a second club — and a logo a developer
-- has to deploy is not a logo a club owns.
--
-- The bucket is PUBLIC, unlike athlete-photos. That is a deliberate
-- difference, not an oversight: the logo goes into the e-mails a parent
-- receives, and a mail client cannot follow a signed URL that expires in an
-- hour, nor authenticate against private storage. A club's emblem is its
-- public face; a child's photograph is not (BR-093, AC-092), and that bucket
-- stays private with its 60-minute signed URLs (D-19).

alter table public.workspaces
  add column if not exists logo_path text;

comment on column public.workspaces.logo_path is
  'Object path in the public workspace-logos bucket, pinned by constraint to logos/{workspace_id}/{filename}. Null means the club has no mark, and the interface shows none rather than inventing a monogram.';

alter table public.workspaces
  add constraint workspaces_logo_path_scoped check (
    logo_path is null
    or logo_path = 'logos/' || id::text || '/' || split_part(logo_path, '/', 3)
  );

-- ---------------------------------------------------------------------------
-- The bucket.
--
-- 1 MB and the three formats the athlete bucket takes. A club emblem that does
-- not fit in a megabyte is a scan, not a logo, and will look worse than one
-- that does.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-logos',
  'workspace-logos',
  true,
  1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Readable by anyone, including a mail client with no session at all. That is
-- the point of the bucket.
create policy workspace_logos_select on storage.objects
  for select to public
  using (bucket_id = 'workspace-logos');

-- Written only by an administrator of the workspace the path names (D-17).
-- A coach cannot change the club's mark, and no workspace can write into
-- another's folder, because the folder is the workspace id.
create policy workspace_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'workspace-logos'
    and (storage.foldername(name))[1] = 'logos'
    and public.is_workspace_admin(((storage.foldername(name))[2])::uuid)
  );

create policy workspace_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'workspace-logos'
    and public.is_workspace_admin(((storage.foldername(name))[2])::uuid)
  );

create policy workspace_logos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'workspace-logos'
    and public.is_workspace_admin(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Recording it.
--
-- Through a function rather than an UPDATE grant: `workspaces` carries the
-- timezone and the cancellation deadline, and an administrator who may change
-- the logo has no business holding a column grant next to those.
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
    'WORKSPACE_LOGO_CHANGED'
  )
);

alter table public.audit_log drop constraint audit_log_entity_type_known;
alter table public.audit_log add constraint audit_log_entity_type_known check (
  entity_type in ('TRAINING_SESSION', 'SESSION_SERIES', 'BOOKING', 'PROFILE', 'ATHLETE', 'WORKSPACE')
);

create or replace function public.set_workspace_logo(
  p_workspace_id uuid,
  -- Optional, so clearing the mark is calling this without a path rather than
  -- passing an explicit null through the client's type layer.
  p_logo_path    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_path  text := nullif(btrim(coalesce(p_logo_path, '')), '');
  v_before text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select w.logo_path into v_before from public.workspaces w where w.id = p_workspace_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  -- The path is checked here as well as by the column constraint, so the
  -- refusal is a code the interface can render rather than a raised violation.
  if v_path is not null
     and v_path <> 'logos/' || p_workspace_id::text || '/' || split_part(v_path, '/', 3) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_LOGO_PATH');
  end if;

  if v_before is not distinct from v_path then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('unchanged', true));
  end if;

  update public.workspaces w set logo_path = v_path where w.id = p_workspace_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (p_workspace_id, v_actor, 'WORKSPACE_LOGO_CHANGED', 'WORKSPACE', p_workspace_id,
          jsonb_build_object('logo_path', v_before),
          jsonb_build_object('logo_path', v_path));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('logo_path', v_path));
end;
$$;

comment on function public.set_workspace_logo(uuid, text) is
  'Sets or clears the club mark. Administrators of that workspace only (D-17), audited, and the path is validated so it can only name this workspace folder.';

revoke all on function public.set_workspace_logo(uuid, text) from public;
grant execute on function public.set_workspace_logo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The mark travels with the message.
--
-- Reproduced in full rather than patched, because the return table changes and
-- a function's signature cannot be replaced in place. One column is added:
-- the path, which the drain turns into a public URL.
--
-- A mail client will often refuse to load it, so the message is written to
-- read without it — the logo is an `img` with the club's name as its `alt`,
-- never a picture carrying words.
-- ---------------------------------------------------------------------------

drop function if exists public.claim_notification_deliveries(integer, integer, interval);

create or replace function public.claim_notification_deliveries(
  p_limit        integer  default 20,
  p_max_attempts integer  default 5,
  p_stale_after  interval default interval '15 minutes'
)
returns table (
  delivery_id     uuid,
  event_id        uuid,
  event_type      text,
  recipient_email text,
  attempt_count   integer,
  session_payload jsonb,
  delivery_payload jsonb,
  workspace_name  text,
  workspace_timezone text,
  workspace_logo_path text
)
-- session_payload is composed here rather than joined live at send time. The
-- event's payload is the snapshot taken when the change happened; if a coach
-- moves a session twice before the drain runs, the first email must describe
-- the first move, not the second. Only the facility and location *names* are
-- resolved live, because those are reference data that does not change under a
-- pending message.
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select d.id
    from public.notification_deliveries d
    where (
        d.status in ('PENDING', 'FAILED')
        or (d.status = 'SENDING'
            and coalesce(d.claimed_at, d.created_at) < now() - p_stale_after)
      )
      and d.attempt_count < p_max_attempts
      -- No address, no send. Left PENDING rather than failed: a future
      -- anonymisation clears the address deliberately, and a profile that has
      -- not yet been reattached to a login may gain one.
      and d.recipient_email is not null
    order by d.created_at
    limit greatest(p_limit, 0)
    for update skip locked
  ),
  marked as (
    update public.notification_deliveries d
       set status = 'SENDING',
           attempt_count = d.attempt_count + 1,
           claimed_at = now()
      from claimed c
     where d.id = c.id
    returning d.*
  )
  select
    m.id,
    m.event_id,
    e.event_type,
    m.recipient_email,
    m.attempt_count,
    e.payload || jsonb_strip_nulls(jsonb_build_object(
      'start_at',      coalesce(e.payload ->> 'start_at', s.start_at::text),
      'end_at',        coalesce(e.payload ->> 'end_at', s.end_at::text),
      'facility_code', f.code,
      'location_name', l.name,
      'changing_room', s.changing_room)),
    m.payload,
    w.name,
    w.timezone,
    w.logo_path
  from marked m
  join public.notification_events e on e.id = m.event_id
  join public.workspaces w on w.id = e.workspace_id
  left join public.training_sessions s on s.id = e.training_session_id
  left join public.facilities f
    on f.id = coalesce((e.payload ->> 'facility_id')::uuid, s.facility_id)
  left join public.locations l on l.id = f.location_id
  order by m.created_at;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, integer, interval) from public;
revoke all on function public.claim_notification_deliveries(integer, integer, interval) from authenticated;
grant execute on function public.claim_notification_deliveries(integer, integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- The parent's side.
--
-- A guardian reads `workspaces` only once they have an athlete there, and the
-- registration form reads `joinable_workspaces()` before that. Both need the
-- mark, so both get it: the column is on a table the row policy already
-- governs, and the function gains one more field of the same public kind it
-- already returns.
-- ---------------------------------------------------------------------------

drop function if exists public.joinable_workspaces();

create or replace function public.joinable_workspaces()
returns table (
  id               uuid,
  name             text,
  primary_sport_id uuid,
  sport_code       text,
  timezone         text,
  logo_path        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select w.id, w.name, w.primary_sport_id, s.code, w.timezone, w.logo_path
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
  'Workspaces accepting a registration, for the first athlete form (migration 12). Deliberately returns no counts and no identities — only what the form renders. When invitation-based joining arrives this is the one gate that changes.';

revoke all on function public.joinable_workspaces() from public;
grant execute on function public.joinable_workspaces() to authenticated;
