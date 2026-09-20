-- Trainlio — Sports Training Booking Platform
-- Layers: DATABASE INVARIANTS and DOMAIN OPERATIONS
-- 19 — account anonymisation and email retention (D-18)
--
-- The architectural constraint was applied in migration 02 and has been
-- verified since: no domain history depends on an auth.users row physically
-- existing. This migration is the workflow the plan deferred until now.
--
-- The shape of it:
--
--   Erasure request  -> anonymize_profile(). Immediate, on request, and it is
--                       the coach's decision to run, not a schedule's.
--   Address decay    -> scrub_notification_emails(). Scheduled. The delivery
--                       audit keeps "a message was sent to this person" for
--                       ever and the address itself only as long as an audit
--                       of delivery plausibly needs it.
--
-- Nothing here deletes operational history. A cancelled training that a parent
-- was emailed about is a fact about the club, not personal data about them, and
-- erasing the parent must not erase the training.

-- ---------------------------------------------------------------------------
-- How long the delivery audit keeps the address it sent to.
--
-- A workspace setting, not a constant, for the same reason the cancellation
-- deadline is one (D-03): the coach is the controller and this is their policy
-- to set. Ninety days is the default because it comfortably covers "did the
-- cancellation reach the parents?", which is the only question the address
-- itself answers.
-- ---------------------------------------------------------------------------

alter table public.workspaces
  add column delivery_email_retention_days integer not null default 90;

alter table public.workspaces
  add constraint workspaces_delivery_email_retention_range
    check (delivery_email_retention_days between 1 and 3650);

comment on column public.workspaces.delivery_email_retention_days is
  'D-18. After this many days, scrub_notification_emails() clears recipient_email on settled deliveries. The delivery row and its profile attribution are kept.';

-- ---------------------------------------------------------------------------
-- Audit vocabulary for the erasure itself.
--
-- An anonymisation is exactly the kind of act the audit log exists for: who
-- did it, to whom, when. It is appended like any other, and it is the one
-- audit entry that must remain readable after the person it concerns is gone —
-- which it does, because the entry names a profile id and not a person.
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
    'BOOKING_CREATED_BY_GUARDIAN',
    'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN',
    'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    -- D-18
    'PROFILE_ANONYMIZED',
    'ATHLETE_ANONYMIZED'
  )
);

alter table public.audit_log drop constraint audit_log_entity_type_known;
alter table public.audit_log add constraint audit_log_entity_type_known check (
  entity_type in ('TRAINING_SESSION', 'SESSION_SERIES', 'BOOKING', 'PROFILE', 'ATHLETE')
);

-- The workspace column is not null, and an erasure is not a workspace event.
-- Rather than weaken the column, an erasure is recorded against the workspace
-- whose history it touches; a profile with no workspace history has nothing to
-- attribute and is handled in the function.
comment on column public.audit_log.workspace_id is
  'The workspace whose history the action concerns. For a D-18 anonymisation this is the workspace the person was active in; a profile active in several produces one entry per workspace.';

-- ---------------------------------------------------------------------------
-- What an erasure would touch, before doing it.
--
-- Read-only, and the first thing to run. An erasure is irreversible by
-- construction — that is the point of it — so the operator sees the blast
-- radius first: how many bookings stay attributed, which athletes would be left
-- with no active guardian, how many delivery rows carry the address.
-- ---------------------------------------------------------------------------

create or replace function public.anonymization_preview(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile_id', p_profile_id,
    'exists', exists (select 1 from public.app_profiles p where p.id = p_profile_id),
    'already_anonymized', coalesce(
      (select p.anonymized_at is not null from public.app_profiles p where p.id = p_profile_id), false),
    'display_name', (select p.display_name from public.app_profiles p where p.id = p_profile_id),
    'has_login', coalesce(
      (select p.auth_user_id is not null from public.app_profiles p where p.id = p_profile_id), false),
    'is_workspace_staff', exists (
      select 1 from public.workspace_members m where m.profile_id = p_profile_id and m.is_active),
    'bookings_created', (select count(*) from public.bookings b where b.created_by = p_profile_id),
    'audit_entries', (select count(*) from public.audit_log a where a.actor_profile_id = p_profile_id),
    'deliveries_with_address', (
      select count(*) from public.notification_deliveries d
      where d.recipient_profile_id = p_profile_id and d.recipient_email is not null),
    'guardian_links', (
      select count(*) from public.guardian_athlete_access g
      where g.profile_id = p_profile_id and g.status = 'ACTIVE'),
    -- The consequence an operator is most likely to miss: a child whose only
    -- guardian is leaving. Their bookings stand; nobody can make new ones.
    'athletes_left_without_guardian', (
      select coalesce(jsonb_agg(jsonb_build_object('athlete_id', a.id,
                                                   'first_name', a.first_name,
                                                   'last_name', a.last_name)), '[]'::jsonb)
      from public.athletes a
      where exists (
        select 1 from public.guardian_athlete_access g
        where g.athlete_id = a.id and g.profile_id = p_profile_id and g.status = 'ACTIVE')
      and not exists (
        select 1 from public.guardian_athlete_access g2
        where g2.athlete_id = a.id and g2.status = 'ACTIVE' and g2.profile_id <> p_profile_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- The erasure.
--
-- Six things happen, and the list of what does *not* happen is as important:
--
--   1. display_name is cleared and anonymized_at stamped;
--   2. the login link is severed, and the auth.users row deleted, which is what
--      stops the person signing in again;
--   3. addresses in the delivery audit are scrubbed for this recipient;
--   4. active guardian access is revoked, so nothing new can be booked in their
--      name — the rows stay, because they are how past bookings are explained;
--   5. workspace staff membership is deactivated;
--   6. an audit entry is appended per workspace the person was active in.
--
-- NOT done: no booking, session, audit entry or delivery row is deleted, and no
-- actor reference is rewritten. A parent's erasure must not remove a training
-- from the club's history, and the coach must still be able to answer "who was
-- on the ice that evening".
--
-- p_anonymize_athletes also blanks the names of athletes this profile was the
-- last active guardian of. Off by default: an athlete is a different data
-- subject with a different guardian's request behind them, and erasing a child
-- because a parent asked is a decision, not a side effect.
-- ---------------------------------------------------------------------------

create or replace function public.anonymize_profile(
  p_profile_id         uuid,
  p_reason             text default null,
  p_anonymize_athletes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile   record;
  v_preview   jsonb;
  v_scrubbed  integer := 0;
  v_revoked   integer := 0;
  v_athletes  integer := 0;
  v_workspace uuid;
begin
  select * into v_profile from public.app_profiles p where p.id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  if v_profile.anonymized_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_ANONYMIZED',
      'details', jsonb_build_object('anonymized_at', v_profile.anonymized_at));
  end if;

  -- Taken before anything changes: afterwards there is nothing left to count.
  v_preview := public.anonymization_preview(p_profile_id);

  -- The audit entries come first, while the display name still says who this
  -- was. After the update the log holds an opaque id, which is correct for the
  -- retained record and useless for the entry that explains it.
  for v_workspace in
    select distinct s.workspace_id
    from public.bookings b
    join public.training_sessions s on s.id = b.training_session_id
    where b.created_by = p_profile_id or b.cancelled_by = p_profile_id
    union
    select distinct m.workspace_id from public.workspace_members m where m.profile_id = p_profile_id
    union
    select distinct a.workspace_id from public.audit_log a where a.actor_profile_id = p_profile_id
  loop
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
    values
      (v_workspace, null, 'PROFILE_ANONYMIZED', 'PROFILE', p_profile_id,
       jsonb_build_object('display_name', v_profile.display_name,
                          'had_login', v_profile.auth_user_id is not null),
       jsonb_build_object('display_name', null, 'had_login', false),
       jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''),
                          'preview', v_preview));
  end loop;

  -- actor_profile_id is null above on purpose: the erasure is performed by an
  -- administrator outside any user session, and naming the subject as their own
  -- actor would be wrong.

  update public.notification_deliveries d
     set recipient_email = null
   where d.recipient_profile_id = p_profile_id
     and d.recipient_email is not null;
  get diagnostics v_scrubbed = row_count;

  update public.guardian_athlete_access g
     set status = 'REVOKED'
   where g.profile_id = p_profile_id and g.status = 'ACTIVE';
  get diagnostics v_revoked = row_count;

  update public.workspace_members m
     set is_active = false
   where m.profile_id = p_profile_id and m.is_active;

  if p_anonymize_athletes then
    update public.athletes a
       set first_name = 'Anonymizováno',
           last_name  = '—',
           is_active  = false,
           photo_path = null
     where a.id in (
       select (value ->> 'athlete_id')::uuid
       from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));
    get diagnostics v_athletes = row_count;
  end if;

  update public.app_profiles p
     set display_name  = null,
         anonymized_at = now(),
         auth_user_id  = null
   where p.id = p_profile_id;

  -- Last, and only after the profile is detached: the ON DELETE SET NULL would
  -- have done this anyway, but doing it explicitly first means the erasure does
  -- not depend on a cascade to have severed the link.
  if v_profile.auth_user_id is not null then
    delete from auth.users u where u.id = v_profile.auth_user_id;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'profile_id', p_profile_id,
    'emails_scrubbed', v_scrubbed,
    'guardian_links_revoked', v_revoked,
    'athletes_anonymized', v_athletes,
    'preview', v_preview
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduled address decay.
--
-- Only settled deliveries: a PENDING or SENDING row still needs its address to
-- be sent. A FAILED one past the attempt budget is settled — it will never be
-- retried, and keeping the address of a message that never arrived serves
-- nothing.
--
-- The clock is sent_at, falling back to claimed_at and then created_at, and
-- deliberately NOT updated_at. updated_at is maintained by the set_updated_at
-- trigger, so it answers "when was this row last touched at all" — it is
-- rewritten by any write, including this scrub's own, which would leave a
-- failed delivery permanently one moment old and its address never cleared.
-- The same trap that made claimed_at a column of its own in migration 17.
-- ---------------------------------------------------------------------------

create or replace function public.scrub_notification_emails()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scrubbed integer := 0;
begin
  update public.notification_deliveries d
     set recipient_email = null
    from public.notification_events e
    join public.workspaces w on w.id = e.workspace_id
   where e.id = d.event_id
     and d.recipient_email is not null
     and d.status in ('SENT', 'FAILED')
     and coalesce(d.sent_at, d.claimed_at, d.created_at)
         < now() - make_interval(days => w.delivery_email_retention_days);
  get diagnostics v_scrubbed = row_count;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('scrubbed', v_scrubbed));
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles with no login and no recent activity: candidates for review, never
-- an automatic erasure.
--
-- Erasure is irreversible and a list is not a decision. This exists so the
-- coach can find the accounts a retention policy would cover, and then run
-- anonymize_profile on the ones they mean.
-- ---------------------------------------------------------------------------

create or replace function public.dormant_profiles(p_inactive_days integer default 1095)
returns table (
  profile_id      uuid,
  display_name    text,
  has_login       boolean,
  last_activity   timestamptz,
  bookings_created bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.display_name,
    p.auth_user_id is not null,
    greatest(
      p.created_at,
      coalesce((select max(b.created_at) from public.bookings b where b.created_by = p.id), p.created_at),
      coalesce((select max(a.created_at) from public.audit_log a where a.actor_profile_id = p.id), p.created_at)
    ),
    (select count(*) from public.bookings b where b.created_by = p.id)
  from public.app_profiles p
  where p.anonymized_at is null
    and greatest(
      p.created_at,
      coalesce((select max(b.created_at) from public.bookings b where b.created_by = p.id), p.created_at),
      coalesce((select max(a.created_at) from public.audit_log a where a.actor_profile_id = p.id), p.created_at)
    ) < now() - make_interval(days => greatest(p_inactive_days, 1))
  order by 4;
$$;

-- ---------------------------------------------------------------------------
-- Grants. service_role only, every one of them.
--
-- anonymize_profile deletes an authentication record and clears a name. There
-- is no interface for it and there is not meant to be: it is an administrative
-- act performed on a written request, the same way the coach role is granted.
-- ---------------------------------------------------------------------------

do $$
declare f text;
begin
  foreach f in array array[
    'public.anonymization_preview(uuid)',
    'public.anonymize_profile(uuid, text, boolean)',
    'public.scrub_notification_emails()',
    'public.dormant_profiles(integer)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
