-- ---------------------------------------------------------------------------
-- Payment, the coach's note and the message to the parent, per booking
-- (handoff v3.3, decisions 34–36; coach/SPEC.md K2, K17, K2c; guardian G6e;
-- EMAILS.md E09).
--
-- Three things a coach records against one athlete at one training, with three
-- different audiences:
--
--   * **Paid** (decision 34) — a flag with who and when, no amount and no
--     method. The parent sees `Zaplaceno` in the booking detail, and nothing
--     when it is not paid. No e-mail.
--   * **The coach's note** (decision 35) — staff only, never fetched for a
--     parent.
--   * **The message to the parent** (decision 36) — one per booking, shown in
--     the parent's booking detail and e-mailed (E09); editing and sending again
--     replaces it and e-mails again.
--
-- Where each lives follows who may read it. Paid and the message are columns on
-- `bookings`, which a guardian already reads for their own children. The note
-- is a table of its own with a staff-only policy, the way the session's and the
-- athlete's notes are (D-13, migration 35): a column on `bookings` would be one
-- `select *` away from a parent's screen, and Postgres has no row policy per
-- column.
--
-- Who may write: `canEdit(session)` (decision 33), through the functions below
-- only. A view-only coach — an assistant without the permission — sees all of
-- it and changes none of it. Unlike the rest of a finished training (migration
-- 41) all three stay open after it is over: a parent pays after the training,
-- and the message is usually about how it went.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column paid_at                 timestamptz,
  add column paid_by                 uuid references public.app_profiles(id) on delete restrict,
  add column parent_message          text,
  add column parent_message_sent_at  timestamptz,
  add column parent_message_sent_by  uuid references public.app_profiles(id) on delete restrict,
  add constraint bookings_paid_consistent
    check ((paid_at is null) = (paid_by is null)),
  add constraint bookings_parent_message_length
    check (parent_message is null or char_length(parent_message) <= 500),
  add constraint bookings_parent_message_not_blank
    check (parent_message is null or char_length(btrim(parent_message)) > 0),
  add constraint bookings_parent_message_consistent
    check ((parent_message is null) = (parent_message_sent_at is null)
       and (parent_message is null) = (parent_message_sent_by is null));

comment on column public.bookings.paid_at is
  'Decision 34: when a coach marked this booking paid; null is not paid. A flag only — Trainlio takes no payments. Guardian-visible as `Zaplaceno`.';
comment on column public.bookings.parent_message is
  'Decision 36: the coach''s message to the athlete''s guardians about this training (≤500), shown in G6e and e-mailed as E09. Sending again replaces it.';

-- ---------------------------------------------------------------------------
-- The coach's note for one athlete at one training (decision 35).
-- ---------------------------------------------------------------------------

create table public.booking_coach_notes (
  booking_id   uuid primary key references public.bookings(id) on delete restrict,
  -- Copied from the booking's training, so the row policy checks the workspace
  -- without a join.
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  note         text not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.app_profiles(id) on delete restrict,
  constraint booking_coach_notes_length check (char_length(note) <= 200),
  constraint booking_coach_notes_not_blank check (char_length(btrim(note)) > 0)
);

alter table public.booking_coach_notes enable row level security;

comment on table public.booking_coach_notes is
  'Decision 35, K17: the staff''s note about one athlete at one training. Never guardian-readable — a separate table rather than a column on bookings, so no guardian-facing select can return it.';

-- Readable by the club's staff, like the session's internal note: a view-only
-- coach reads it too (coach test 18). A guardian's select returns no rows.
create policy booking_coach_notes_select_staff on public.booking_coach_notes
  for select to authenticated
  using (public.is_workspace_coach(workspace_id));

grant select on public.booking_coach_notes to authenticated;
-- No write grant: the function below checks canEdit(session).

-- ---------------------------------------------------------------------------
-- Audit and outbox vocabulary.
-- ---------------------------------------------------------------------------

alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    'SESSION_CREATED', 'SESSION_UPDATED', 'SESSION_CAPACITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED', 'SESSION_ELIGIBILITY_NARROWED',
    'SESSION_BOOKING_CLOSED', 'SESSION_BOOKING_REOPENED', 'SESSION_CANCELLED',
    'SESSION_SERIES_CREATED', 'SESSION_DUPLICATED', 'SESSION_ASSISTANTS_CHANGED',
    'BOOKING_CREATED_BY_GUARDIAN', 'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN', 'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    -- Migration 43 (v3.3): what a coach records against a booking.
    'BOOKING_PAYMENT_MARKED', 'BOOKING_NOTE_CHANGED', 'BOOKING_MESSAGE_SENT',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    'MEMBER_ROLE_CHANGED',
    'MEMBER_PERMISSION_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED'
  )
);

alter table public.notification_events drop constraint notification_events_type_known;
alter table public.notification_events add constraint notification_events_type_known check (
  event_type in (
    'SESSION_CANCELLED',            -- BR-072, AC-071..073 · E01
    'SESSION_SCHEDULE_CHANGED',     -- date / start / end (D-11) · E02
    'SESSION_LOCATION_CHANGED',     -- D-11 · E03
    'SESSION_FACILITY_CHANGED',     -- MH <-> VH (D-11) · E04
    'SESSION_MAIN_COACH_CHANGED',   -- D-11: the coach IS the product · E05
    'SESSION_ELIGIBILITY_NARROWED', -- D-08, a subset of the families · E06
    'BOOKING_REMOVED_BY_COACH',     -- D-06 · E07
    'SESSION_CHANGED',
    'BOOKING_ADDED_BY_COACH',       -- DR-12 · E08
    -- Decision 36. The coach wrote to one athlete's family about one training.
    'COACH_MESSAGE_TO_GUARDIAN'     -- E09
  )
);

-- ---------------------------------------------------------------------------
-- Recipients, restated from migration 34 with E09 among the events that name
-- their athletes. The athlete still holds a confirmed booking (a message is
-- only sent for one), so they are found the usual way and every active
-- guardian is told — "all guardians of that athlete", as EMAILS.md asks.
-- ---------------------------------------------------------------------------

create or replace function public.notification_event_recipients(p_event_id uuid)
returns table (
  recipient_profile_id uuid,
  athlete_ids          uuid[],
  athlete_names        text[],
  booking_ids          uuid[]
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
      when ev.event_type in ('SESSION_ELIGIBILITY_NARROWED',
                             'BOOKING_REMOVED_BY_COACH',
                             'BOOKING_ADDED_BY_COACH',
                             'COACH_MESSAGE_TO_GUARDIAN')
      then array(select (value #>> '{}')::uuid
                 from jsonb_array_elements(coalesce(ev.payload -> 'affected_athlete_ids', '[]'::jsonb)))
      else null
    end as athlete_ids
    from event ev
  ),
  -- The athletes to tell about. For a removal they are named outright; for
  -- everything else they are whoever holds a confirmed place.
  subjects as (
    select a.id, a.first_name, a.last_name
    from event ev
    cross join affected af
    join public.athletes a on a.id = any(af.athlete_ids)
    where ev.event_type = 'BOOKING_REMOVED_BY_COACH'

    union

    select a.id, a.first_name, a.last_name
    from event ev
    cross join affected af
    join public.bookings b
      on b.training_session_id = ev.training_session_id
     and b.status = 'CONFIRMED'
    join public.athletes a on a.id = b.athlete_id
    where ev.event_type <> 'BOOKING_REMOVED_BY_COACH'
      and (af.athlete_ids is null or a.id = any(af.athlete_ids))
  ),
  with_booking as (
    select
      s.id, s.first_name, s.last_name,
      (select b.id
         from public.bookings b
         cross join event ev
        where b.training_session_id = ev.training_session_id
          and b.athlete_id = s.id
        order by b.created_at desc
        limit 1) as booking_id
    from subjects s
  )
  select
    gaa.profile_id,
    array_agg(s.id order by s.first_name, s.last_name),
    array_agg(s.first_name || ' ' || s.last_name order by s.first_name, s.last_name),
    array_remove(array_agg(s.booking_id order by s.first_name, s.last_name), null)
  from with_booking s
  join public.guardian_athlete_access gaa
    on gaa.athlete_id = s.id
   and gaa.status = 'ACTIVE'
  group by gaa.profile_id;
$$;

revoke all on function public.notification_event_recipients(uuid) from public;

-- ---------------------------------------------------------------------------
-- The booking a coach is about to record something against, checked the same
-- way by all four writers: signed in, the club's coach, allowed to edit that
-- training (decision 33), the training not cancelled, the booking confirmed.
-- Returns the refusal code, or null with the rest filled in.
-- ---------------------------------------------------------------------------
create or replace function public.booking_edit_target(
  p_booking_id uuid,
  out o_code       text,
  out o_session_id uuid,
  out o_workspace  uuid,
  out o_athlete_id uuid
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_status         public.booking_status;
  v_session_status public.session_status;
  v_main_coach     uuid;
begin
  if public.current_profile_id() is null then
    o_code := 'NOT_AUTHENTICATED';
    return;
  end if;

  select b.status, b.athlete_id, s.id, s.workspace_id, s.status, s.main_coach_profile_id
    into v_status, o_athlete_id, o_session_id, o_workspace, v_session_status, v_main_coach
    from public.bookings b
    join public.training_sessions s on s.id = b.training_session_id
   where b.id = p_booking_id;

  -- A booking that is not this coach's club's looks the same as one that does
  -- not exist: a guardian probing ids learns nothing.
  if o_session_id is null or not public.is_workspace_coach(o_workspace) then
    o_code := 'NOT_AUTHORIZED';
    return;
  end if;

  if not public.can_edit_session(o_workspace, v_main_coach) then
    o_code := 'FORBIDDEN_EDIT';
    return;
  end if;

  if v_session_status = 'CANCELLED' then
    o_code := 'SESSION_CANCELLED';
    return;
  end if;

  if v_status <> 'CONFIRMED' then
    o_code := 'BOOKING_NOT_CONFIRMED';
    return;
  end if;
end;
$$;

revoke all on function public.booking_edit_target(uuid) from public;

-- ---------------------------------------------------------------------------
-- K17 · `Zaplaceno`, saved on tap. Unchecking clears who and when.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_paid(
  p_booking_id uuid,
  p_paid       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_target record;
  v_was    timestamptz;
  v_by     uuid;
begin
  select * into v_target from public.booking_edit_target(p_booking_id);
  if v_target.o_code is not null then
    return jsonb_build_object('ok', false, 'code', v_target.o_code);
  end if;

  if p_paid is null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;

  select b.paid_at, b.paid_by into v_was, v_by
    from public.bookings b where b.id = p_booking_id
     for update;

  -- Ticking a paid booking again keeps who marked it first.
  if (v_was is not null) = p_paid then
    return jsonb_build_object('ok', true, 'data',
      jsonb_build_object('paid_at', v_was, 'paid_by', v_by));
  end if;

  update public.bookings b
     set paid_at = case when p_paid then now() end,
         paid_by = case when p_paid then v_actor end
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_target.o_workspace, v_actor, 'BOOKING_PAYMENT_MARKED', 'BOOKING', p_booking_id,
     jsonb_build_object('paid', not p_paid), jsonb_build_object('paid', p_paid));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'paid_at', case when p_paid then now() end,
    'paid_by', case when p_paid then v_actor end));
end;
$$;

revoke all on function public.set_booking_paid(uuid, boolean) from public;
grant execute on function public.set_booking_paid(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- K2c · `Zaplatili všichni`. One request, the unpaid confirmed bookings only,
-- one timestamp; a booking already paid keeps its own who and when.
-- ---------------------------------------------------------------------------
create or replace function public.mark_session_paid(p_training_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_now     timestamptz := now();
  v_ids     uuid[];
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select s.id, s.workspace_id, s.status, s.main_coach_profile_id
    into v_session
    from public.training_sessions s
   where s.id = p_training_session_id
     for update;

  if v_session.id is null or not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if not public.can_edit_session(v_session.workspace_id, v_session.main_coach_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  with marked as (
    update public.bookings b
       set paid_at = v_now, paid_by = v_actor
     where b.training_session_id = p_training_session_id
       and b.status = 'CONFIRMED'
       and b.paid_at is null
    returning b.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from marked;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  select v_session.workspace_id, v_actor, 'BOOKING_PAYMENT_MARKED', 'BOOKING', id,
         jsonb_build_object('paid', false), jsonb_build_object('paid', true, 'all', true)
    from unnest(v_ids) as id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'marked', cardinality(v_ids)));
end;
$$;

revoke all on function public.mark_session_paid(uuid) from public;
grant execute on function public.mark_session_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- K17 · `Poznámka k tréninku · jen trenéři`, saved on blur. Blank clears it.
-- The audit records that it changed, never what it says: the log is
-- append-only, and a note about a child has to go when the child's data does.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_coach_note(
  p_booking_id uuid,
  p_note       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_target record;
  v_was    text;
begin
  select * into v_target from public.booking_edit_target(p_booking_id);
  if v_target.o_code is not null then
    return jsonb_build_object('ok', false, 'code', v_target.o_code);
  end if;

  -- The form limits this too; a caller that is not the form does not.
  if char_length(coalesce(v_note, '')) > 200 then
    return jsonb_build_object('ok', false, 'code', 'NOTE_TOO_LONG');
  end if;

  select n.note into v_was
    from public.booking_coach_notes n where n.booking_id = p_booking_id
     for update;

  if v_was is not distinct from v_note then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('note', v_note));
  end if;

  if v_note is null then
    delete from public.booking_coach_notes n where n.booking_id = p_booking_id;
  else
    insert into public.booking_coach_notes (booking_id, workspace_id, note, updated_by)
    values (p_booking_id, v_target.o_workspace, v_note, v_actor)
    on conflict (booking_id) do update
      set note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_target.o_workspace, v_actor, 'BOOKING_NOTE_CHANGED', 'BOOKING', p_booking_id,
     jsonb_build_object('has_note', v_was is not null),
     jsonb_build_object('has_note', v_note is not null));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('note', v_note));
end;
$$;

revoke all on function public.set_booking_coach_note(uuid, text) from public;
grant execute on function public.set_booking_coach_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- K17 · `Odeslat rodiči`. Saved on the booking and e-mailed (E09) in the same
-- transaction, so a message the parent can read in the app is always one they
-- were sent. Sending again replaces the text and sends again.
--
-- The event carries the text as it was sent: a coach who edits and re-sends
-- before the drain runs owes the first e-mail the first text.
-- ---------------------------------------------------------------------------
create or replace function public.send_parent_message(
  p_booking_id uuid,
  p_message    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_target  record;
  v_resent  boolean;
  v_now     timestamptz := now();
begin
  select * into v_target from public.booking_edit_target(p_booking_id);
  if v_target.o_code is not null then
    return jsonb_build_object('ok', false, 'code', v_target.o_code);
  end if;

  if v_message is null then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_EMPTY');
  end if;

  if char_length(v_message) > 500 then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_TOO_LONG');
  end if;

  select b.parent_message is not null into v_resent
    from public.bookings b where b.id = p_booking_id
     for update;

  update public.bookings b
     set parent_message = v_message,
         parent_message_sent_at = v_now,
         parent_message_sent_by = v_actor
   where b.id = p_booking_id;

  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_target.o_workspace, v_target.o_session_id, 'COACH_MESSAGE_TO_GUARDIAN',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(v_target.o_athlete_id),
            'actor_profile_id', v_actor,
            'message', v_message));

  -- The text is in the booking and the outbox; the audit says it was sent.
  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (v_target.o_workspace, v_actor, 'BOOKING_MESSAGE_SENT', 'BOOKING', p_booking_id,
     jsonb_build_object('resent', v_resent));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('sent_at', v_now));
end;
$$;

revoke all on function public.send_parent_message(uuid, text) from public;
grant execute on function public.send_parent_message(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The roster, restated from migration 16 with what v3.3 shows on each row and
-- in K17. A function rather than the table because the names behind `paid_by`
-- and `parent_message_sent_by` are staff profiles, and the coach note is read
-- in the same pass instead of in a second round trip.
--
-- The return type changes, so it is dropped and created rather than replaced.
-- ---------------------------------------------------------------------------

drop function public.session_roster(uuid);

create function public.session_roster(p_training_session_id uuid)
returns table (
  booking_id        uuid,
  athlete_id        uuid,
  first_name        text,
  last_name         text,
  birth_year        integer,
  position_code     text,
  stick_side_code   text,
  jersey_number     text,
  club_name         text,
  status            public.booking_status,
  created_by_role   public.booking_creator_role,
  booked_by_name    text,
  booked_at         timestamptz,
  capacity_override boolean,
  cancelled_at      timestamptz,
  cancellation_reason text,
  paid_at           timestamptz,
  paid_by_name      text,
  coach_note        text,
  parent_message    text,
  parent_message_sent_at timestamptz,
  parent_message_sent_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id,
    a.id,
    a.first_name,
    a.last_name,
    extract(year from a.date_of_birth)::int,
    asp.attributes ->> 'position',
    asp.attributes ->> 'stick_side',
    asp.jersey_number,
    asp.club_name,
    b.status,
    b.created_by_role,
    booker.display_name,
    b.created_at,
    b.coach_capacity_override,
    b.cancelled_at,
    b.cancellation_reason,
    b.paid_at,
    payer.display_name,
    note.note,
    b.parent_message,
    b.parent_message_sent_at,
    sender.display_name
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.athletes a on a.id = b.athlete_id
  left join public.app_profiles booker on booker.id = b.created_by
  left join public.app_profiles payer on payer.id = b.paid_by
  left join public.app_profiles sender on sender.id = b.parent_message_sent_by
  left join public.booking_coach_notes note on note.booking_id = b.id
  left join public.athlete_sport_profiles asp
    on asp.athlete_id = a.id and asp.sport_id = s.sport_id
  where b.training_session_id = p_training_session_id
    -- The only authorization in this function, and it is the same predicate the
    -- row policies use. The coach note is staff-only and so is this.
    and public.is_workspace_coach(s.workspace_id)
  order by b.status, a.first_name, a.last_name;
$$;

revoke all on function public.session_roster(uuid) from public;
grant execute on function public.session_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A note or a message about a child is text about a person, so it goes when
-- the child is anonymised, like the athlete note (migration 35). The paid flag
-- stays: it says nothing about who the child was.
--
-- `anonymize_profile` is restated whole from migration 35 with those two
-- statements added.
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

    -- Migration 35. A coach's note about a child is text about a person, and
    -- the person has asked to be forgotten. Here rather than in a trigger on
    -- `athletes`, because an athlete is anonymised by being renamed rather than
    -- stamped — there is no column for a trigger to watch, and a trigger
    -- matching the sentinel name would be the kind of thing that breaks the
    -- day the sentinel changes.
    delete from public.athlete_internal_notes n
     where n.athlete_id in (
       select (value ->> 'athlete_id')::uuid
       from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));

    -- Migration 43: and what each training's coaches wrote about them, to the
    -- staff or to the family.
    delete from public.booking_coach_notes n
     using public.bookings b
     where b.id = n.booking_id
       and b.athlete_id in (
         select (value ->> 'athlete_id')::uuid
         from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));

    update public.bookings b
       set parent_message = null,
           parent_message_sent_at = null,
           parent_message_sent_by = null
     where b.parent_message is not null
       and b.athlete_id in (
         select (value ->> 'athlete_id')::uuid
         from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));
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

revoke all on function public.anonymize_profile(uuid, text, boolean) from public;
revoke all on function public.anonymize_profile(uuid, text, boolean) from authenticated;
grant execute on function public.anonymize_profile(uuid, text, boolean) to service_role;
