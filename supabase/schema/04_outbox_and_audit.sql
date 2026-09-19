-- Trainlio — Sports Training Booking Platform
-- Layers: NOTIFICATION OUTBOX and AUDIT TRAIL
-- 04 — notification_events, notification_deliveries, audit_log
--
-- These are two different things and neither substitutes for the other:
--
--   Outbox  — intent to deliver a message to a person. Mutable (retry, status),
--             drained by a job, provider-neutral, eventually complete.
--   Audit   — record that a domain action happened. Append-only, never drained,
--             never mutated, retained for the life of the workspace.
--
-- A session cancellation produces exactly one audit row and N delivery rows.

-- ---------------------------------------------------------------------------
-- Notification outbox
-- ---------------------------------------------------------------------------

create table public.notification_events (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete restrict,
  training_session_id uuid references public.training_sessions(id) on delete restrict,
  event_type          text not null,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  -- Set once recipients have been expanded into notification_deliveries.
  -- Makes expansion idempotent and re-runnable after a failed drain.
  dispatched_at       timestamptz,
  constraint notification_events_type_known check (
    event_type in (
      'SESSION_CANCELLED',            -- BR-072, AC-071..073
      'SESSION_SCHEDULE_CHANGED',     -- date / start / end (BR-061)
      'SESSION_FACILITY_CHANGED'      -- MH <-> VH (BR-061)
    )
  )
);

create table public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.notification_events(id) on delete restrict,
  recipient_user_id   uuid not null references auth.users(id) on delete restrict,
  recipient_email     text not null,
  -- S-12. Per-recipient content: the list of that guardian's affected athletes,
  -- so one guardian with two booked children receives one email naming both
  -- (AC-072, AC-073). The event payload alone cannot express this.
  payload             jsonb not null default '{}'::jsonb,
  status              public.notification_delivery_status not null default 'PENDING',
  attempt_count       integer not null default 0,
  last_error          text,
  -- Provider-neutral. Holds a Resend id today; the column never names a vendor.
  provider_message_id text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  sent_at             timestamptz,
  -- BR-073: one row per guardian per event is the deduplication mechanism.
  unique (event_id, recipient_user_id),
  constraint notification_deliveries_sent_consistent check (
    (status = 'SENT' and sent_at is not null) or (status <> 'SENT')
  ),
  constraint notification_deliveries_attempts_non_negative check (attempt_count >= 0)
);

comment on column public.notification_deliveries.recipient_email is
  'Deliberate exception to the email-privacy rule (PERMISSIONS): an audit of where a message was sent requires the address used. This table has no policy for any authenticated role — it is service-role only.';

-- ---------------------------------------------------------------------------
-- Audit trail (approved). Append-only.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,  -- null for system actions
  action        text not null,
  entity_type   text not null,
  entity_id     uuid not null,
  before        jsonb,
  after         jsonb,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint audit_log_action_known check (
    action in (
      'SESSION_CREATED',
      'SESSION_UPDATED',
      'SESSION_CAPACITY_CHANGED',
      'SESSION_BOOKING_CLOSED',
      'SESSION_BOOKING_REOPENED',
      'SESSION_CANCELLED',
      'SESSION_SERIES_CREATED',
      'SESSION_DUPLICATED',
      'BOOKING_CREATED_BY_GUARDIAN',
      'BOOKING_CREATED_BY_COACH',
      'BOOKING_CAPACITY_OVERRIDDEN',
      'BOOKING_CANCELLED_BY_GUARDIAN',
      'BOOKING_CANCELLED_BY_COACH'
    )
  ),
  constraint audit_log_entity_type_known check (
    entity_type in ('TRAINING_SESSION', 'SESSION_SERIES', 'BOOKING')
  )
);

comment on table public.audit_log is
  'Append-only (CLAUDE.md principle 8, BR-034). UPDATE and DELETE are blocked by trigger for every role including service_role; correction is done by appending, never by editing.';

create or replace function public.audit_log_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger trg_audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function public.audit_log_is_append_only();
