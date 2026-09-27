-- Trainlio — Sports Training Booking Platform
-- Layer: NOTIFICATION OUTBOX
-- 17 — recipient expansion and the drain contract
--
-- Contract: docs/DOMAIN_OPERATIONS.md.
--
-- Every function here is service_role only. The drain job is the one caller,
-- and it runs outside any user's request: expansion reads auth.users for the
-- recipient's address, which no client role may reach at any layer.

-- ---------------------------------------------------------------------------
-- When a delivery was picked up to send.
--
-- A column of its own rather than a reading of updated_at. updated_at is
-- maintained by the set_updated_at trigger, so it answers "when was this row
-- last touched at all" — any unrelated write resets it, and nothing outside the
-- trigger can set it. Staleness is a question about the claim specifically:
-- this row was taken by a drain that never came back.
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries
  add column claimed_at timestamptz;

comment on column public.notification_deliveries.claimed_at is
  'Set by claim_notification_deliveries. A SENDING row whose claim is older than the stale window is reclaimed: the drain that took it died before recording an outcome.';

-- ---------------------------------------------------------------------------
-- Who must be told about an event.
--
-- The guardians with ACTIVE access to an athlete holding a CONFIRMED booking on
-- the event's session (BR-072). One row per guardian, carrying that guardian's
-- own athletes — which is what makes AC-072 and AC-073 a property of the data
-- rather than of the email template.
--
-- D-08 narrows it: SESSION_ELIGIBILITY_NARROWED goes only to the guardians of
-- the athletes named in payload.affected_athlete_ids, because the other booked
-- families are unaffected and telling them would be noise.
-- ---------------------------------------------------------------------------

create or replace function public.notification_event_recipients(p_event_id uuid)
returns table (
  recipient_profile_id uuid,
  athlete_ids          uuid[],
  athlete_names        text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with event as (
    select e.id, e.training_session_id, e.event_type, e.payload
    from public.notification_events e
    where e.id = p_event_id
  ),
  affected as (
    select case
      when ev.event_type = 'SESSION_ELIGIBILITY_NARROWED'
      then array(select (value #>> '{}')::uuid
                 from jsonb_array_elements(coalesce(ev.payload -> 'affected_athlete_ids', '[]'::jsonb)))
      else null
    end as athlete_ids
    from event ev
  )
  select
    gaa.profile_id,
    array_agg(a.id order by a.first_name, a.last_name),
    array_agg(a.first_name || ' ' || a.last_name order by a.first_name, a.last_name)
  from event ev
  cross join affected af
  join public.bookings b
    on b.training_session_id = ev.training_session_id
   and b.status = 'CONFIRMED'
  join public.athletes a on a.id = b.athlete_id
  join public.guardian_athlete_access gaa
    on gaa.athlete_id = a.id
   and gaa.status = 'ACTIVE'
  where af.athlete_ids is null or a.id = any(af.athlete_ids)
  group by gaa.profile_id;
$$;

-- ---------------------------------------------------------------------------
-- Expansion. Idempotent, which is the whole point of dispatched_at (AC-151).
--
-- Two things make re-running safe, and both are needed:
--
--   * the unique (event_id, recipient_profile_id) constraint, which is also the
--     deduplication mechanism for BR-073 — a guardian with two booked children
--     cannot produce two rows, so they cannot receive two emails;
--   * the row lock on the event, so two drains running at once do not both pass
--     the dispatched_at check and race into the same insert.
--
-- The recipient's address is snapshotted here rather than joined at send time.
-- auth_user_id is severable (D-18): a profile whose login was removed keeps its
-- delivery history, and a delivery already made keeps the address it was made
-- to, which is what an audit of "where was this sent" needs.
-- ---------------------------------------------------------------------------

create or replace function public.expand_notification_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   record;
  v_created integer := 0;
begin
  select e.* into v_event
  from public.notification_events e
  where e.id = p_event_id
  for update;

  if v_event.id is null then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_FOUND');
  end if;

  if v_event.dispatched_at is not null then
    return jsonb_build_object('ok', true, 'data',
      jsonb_build_object('already_dispatched', true, 'created', 0));
  end if;

  with inserted as (
    insert into public.notification_deliveries
      (event_id, recipient_profile_id, recipient_email, payload)
    select
      p_event_id,
      r.recipient_profile_id,
      u.email,
      jsonb_build_object(
        'athlete_ids', to_jsonb(r.athlete_ids),
        'athlete_names', to_jsonb(r.athlete_names))
    from public.notification_event_recipients(p_event_id) r
    join public.app_profiles p on p.id = r.recipient_profile_id
    left join auth.users u on u.id = p.auth_user_id
    on conflict (event_id, recipient_profile_id) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  update public.notification_events e
     set dispatched_at = now()
   where e.id = p_event_id;

  return jsonb_build_object('ok', true, 'data',
    jsonb_build_object('already_dispatched', false, 'created', v_created));
end;
$$;

-- ---------------------------------------------------------------------------
-- Events awaiting expansion. Oldest first, so a backlog drains in order.
-- ---------------------------------------------------------------------------

create or replace function public.pending_notification_events(p_limit integer default 50)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.notification_events e
  where e.dispatched_at is null
  order by e.created_at
  limit greatest(p_limit, 0);
$$;

-- ---------------------------------------------------------------------------
-- Claiming work to send.
--
-- FOR UPDATE SKIP LOCKED, and the claim marks the row SENDING inside the same
-- transaction. Two drain runs overlapping — which a cron schedule plus a slow
-- provider makes ordinary — must not both pick up the same delivery, because
-- the second send is a duplicate email to a parent and cannot be recalled.
--
-- A row left SENDING is reclaimed after p_stale_after. That state means the
-- process died between claiming and recording, which is the one case where
-- Trainlio cannot know whether the message went out. Retrying is the right
-- choice: a parent who receives the cancellation twice is inconvenienced, a
-- parent who never receives it takes their child to a training that is off.
-- ---------------------------------------------------------------------------

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
  workspace_timezone text
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
    w.timezone
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

-- ---------------------------------------------------------------------------
-- Recording the outcome. Provider-neutral (AC-152): the id is stored in a
-- column that names no vendor, and the function takes it as plain text.
-- ---------------------------------------------------------------------------

create or replace function public.record_notification_delivery(
  p_delivery_id         uuid,
  p_ok                  boolean,
  p_provider_message_id text default null,
  p_error               text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found uuid;
begin
  update public.notification_deliveries d
     set status = case when p_ok then 'SENT' else 'FAILED' end::public.notification_delivery_status,
         sent_at = case when p_ok then now() else d.sent_at end,
         provider_message_id = coalesce(p_provider_message_id, d.provider_message_id),
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown error'), 2000) end
   where d.id = p_delivery_id
  returning d.id into v_found;

  if v_found is null then
    return jsonb_build_object('ok', false, 'code', 'DELIVERY_NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operational read for the drain response. Counts only; no addresses.
-- ---------------------------------------------------------------------------

create or replace function public.notification_queue_depth()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'undispatched_events',
      (select count(*) from public.notification_events where dispatched_at is null),
    'pending', (select count(*) from public.notification_deliveries where status = 'PENDING'),
    'sending', (select count(*) from public.notification_deliveries where status = 'SENDING'),
    'failed',  (select count(*) from public.notification_deliveries where status = 'FAILED'),
    'sent',    (select count(*) from public.notification_deliveries where status = 'SENT')
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants. service_role only — not authenticated, not anon.
--
-- These functions are SECURITY DEFINER and read auth.users and the outbox, both
-- of which are unreachable by any client role at both the grant and the policy
-- layer. Granting EXECUTE to authenticated would hand a guardian every booked
-- family's email address through a function call, which is precisely the leak
-- the two layers exist to prevent.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.notification_event_recipients(uuid)',
    'public.expand_notification_event(uuid)',
    'public.pending_notification_events(integer)',
    'public.claim_notification_deliveries(integer, integer, interval)',
    'public.record_notification_delivery(uuid, boolean, text, text)',
    'public.notification_queue_depth()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- Claiming scans by status and age.
create index idx_notification_deliveries_claimable
  on public.notification_deliveries (created_at)
  where status in ('PENDING', 'FAILED', 'SENDING');
