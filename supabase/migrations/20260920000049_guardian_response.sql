-- ---------------------------------------------------------------------------
-- Guardians confirm attendance: Půjde / Nepůjde (handoff v3.7, decisions
-- 52–55; guardian/SPEC.md G6f–G6i, coach/SPEC.md K2n, EMAILS.md E10).
--
-- Every confirmed booking now carries the family's answer to "will they come":
-- nothing yet (`Nepotvrzeno`), or `Půjde`. `Nepůjde` is not a third answer but
-- the guardian's cancellation, which from now on always has a reason and is
-- possible until the training starts, not only until the deadline — after it
-- the booking is flagged late, which the coach sees as `Pozdě`. The place is
-- freed either way, and the main coach (or, with none, every administrator)
-- is e-mailed the reason (E10).
--
-- Stored on `bookings`, which a guardian already reads for their own children
-- and every coach of the club for the roster: the reason has exactly that
-- audience (coach test 33). The existing `cancellation_reason` column carries
-- it — it already holds the coach's reason for a removal, one booking having
-- only ever one of the two.
--
-- A withdrawal counts as Nebyl in every attendance figure (decision 54);
-- workspace_statistics is restated for that at the end.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column guardian_response text,
  add column responded_at      timestamptz,
  add column responded_by      uuid references public.app_profiles(id) on delete restrict,
  add column cancel_late       boolean,
  add constraint bookings_guardian_response_known
    check (guardian_response is null or guardian_response = 'GOING'),
  add constraint bookings_guardian_response_consistent
    check ((guardian_response is null) = (responded_at is null)
       and (guardian_response is null) = (responded_by is null));

comment on column public.bookings.guardian_response is
  'Decision 52: GOING once a guardian answered Půjde; null is Nepotvrzeno. Nepůjde is the booking''s CANCELLED_BY_USER status, with its reason in cancellation_reason.';
comment on column public.bookings.cancel_late is
  'Decision 53: a guardian withdrew after the workspace''s cancellation deadline (coach sees Pozdě). Null for every other booking and for withdrawals before migration 49.';

-- Guardians read their own children's bookings column by column.
grant select (guardian_response, responded_at, responded_by, cancel_late)
  on public.bookings to authenticated;

-- ---------------------------------------------------------------------------
-- Audit and outbox vocabularies.
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
    'BOOKING_CANCELLED_BY_COACH', 'BOOKING_PAYMENT_MARKED', 'BOOKING_NOTE_CHANGED',
    'BOOKING_MESSAGE_SENT', 'BOOKING_ATTENDANCE_MARKED',
    -- Decision 52: a guardian answered Půjde.
    'BOOKING_GUARDIAN_CONFIRMED',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    'MEMBER_ROLE_CHANGED', 'MEMBER_PERMISSION_CHANGED',
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
    'COACH_MESSAGE_TO_GUARDIAN',    -- E09
    -- Decision 55. A guardian withdrew with a reason; the staff are told.
    'GUARDIAN_ABSENCE_TO_COACH'     -- E10
  )
);

-- ---------------------------------------------------------------------------
-- Půjde (G6f → G6h). Any guardian of the athlete, until the training starts;
-- the last answer wins and names its author. Answering again changes nothing
-- and writes nothing. No e-mail (EMAILS.md §4).
-- ---------------------------------------------------------------------------

create or replace function public.confirm_attendance_as_guardian(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_booking record;
  v_session record;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  if not public.has_athlete_manage_access(v_booking.athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  select * into v_session from public.training_sessions s where s.id = v_booking.training_session_id;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  if now() >= v_session.start_at then
    return jsonb_build_object('ok', false, 'code', 'SESSION_STARTED');
  end if;

  if v_booking.guardian_response = 'GOING' then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
  end if;

  update public.bookings b
     set guardian_response = 'GOING',
         responded_at = now(),
         responded_by = v_actor
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_GUARDIAN_CONFIRMED', 'BOOKING', p_booking_id,
     jsonb_build_object('guardian_response', null),
     jsonb_build_object('guardian_response', 'GOING'));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;

revoke all on function public.confirm_attendance_as_guardian(uuid) from public;
grant execute on function public.confirm_attendance_as_guardian(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Nepůjde (G6g → G6i). Replaces the reasonless cancellation of migration 15:
-- the one-argument function is dropped, so no client can withdraw without
-- saying why.
--
-- Until the start rather than until the deadline (decision 53, replacing
-- D-02's refusal): past the deadline it is still allowed and stored as late.
-- D-02's boundary is kept for what "late" means — exactly at the deadline is
-- still on time.
--
-- D-09 still holds: a deactivated athlete's family can withdraw.
-- ---------------------------------------------------------------------------

drop function public.cancel_booking_as_guardian(uuid);

create function public.cancel_booking_as_guardian(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_booking  record;
  v_session  record;
  v_deadline integer;
  v_late     boolean;
  v_now      timestamptz := now();
  v_booked   integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if char_length(v_reason) = 0 or char_length(v_reason) > 200 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;

  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  -- Cancelling changes the confirmed count, so it takes the same lock as
  -- booking does.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = v_booking.training_session_id
   for update;

  select * into v_session
  from public.training_sessions s
  where s.id = v_booking.training_session_id;

  if not public.has_athlete_manage_access(v_booking.athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  -- Re-read under the lock: two guardians pressing Nepůjde at once withdraw
  -- once.
  select b.status into v_booking.status from public.bookings b where b.id = p_booking_id;
  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  if v_now >= v_session.start_at then
    return jsonb_build_object('ok', false, 'code', 'SESSION_STARTED');
  end if;

  select w.cancellation_deadline_hours into v_deadline
  from public.workspaces w where w.id = v_session.workspace_id;

  v_late := v_now > v_session.start_at - make_interval(hours => v_deadline);

  update public.bookings b
     set status = 'CANCELLED_BY_USER',
         cancelled_at = v_now,
         cancelled_by = v_actor,
         cancellation_reason = v_reason,
         cancel_late = v_late
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CANCELLED_BY_GUARDIAN', 'BOOKING', p_booking_id,
     jsonb_build_object('status', 'CONFIRMED'),
     jsonb_build_object('status', 'CANCELLED_BY_USER', 'late', v_late));

  select o.confirmed_count into v_booked
  from public.training_session_occupancy o
  where o.training_session_id = v_session.id;

  -- E10. The occupancy is the one the coach would have seen at this moment,
  -- so it is snapshotted; the guardian's address and number are not (claim).
  insert into public.notification_events
    (workspace_id, training_session_id, event_type, payload)
  values
    (v_session.workspace_id, v_session.id, 'GUARDIAN_ABSENCE_TO_COACH',
     jsonb_build_object(
       'athlete_id', v_booking.athlete_id,
       'booking_id', p_booking_id,
       'session_id', v_session.id,
       'actor_profile_id', v_actor,
       'reason', v_reason,
       'late', v_late,
       'cancelled_at', v_now,
       'booked', v_booked,
       'capacity', v_session.capacity));

  return jsonb_build_object('ok', true, 'data',
    jsonb_build_object('booking_id', p_booking_id, 'late', v_late));
end;
$$;

revoke all on function public.cancel_booking_as_guardian(uuid, text) from public;
grant execute on function public.cancel_booking_as_guardian(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who answered and who withdrew, by name, for the family's own screens (G6h,
-- G6i, G5). A guardian cannot read another guardian's profile row, and "the
-- last response wins and is shown with its author" is about exactly that
-- other guardian. One question, for the caller's own children only.
-- ---------------------------------------------------------------------------

create or replace function public.guardian_booking_actors(p_booking_ids uuid[])
returns table (
  booking_id        uuid,
  responded_by_name text,
  cancelled_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, responder.display_name, canceller.display_name
  from public.bookings b
  left join public.app_profiles responder on responder.id = b.responded_by
  left join public.app_profiles canceller on canceller.id = b.cancelled_by
  where b.id = any(p_booking_ids)
    and public.has_athlete_access(b.athlete_id);
$$;

revoke all on function public.guardian_booking_actors(uuid[]) from public;
grant execute on function public.guardian_booking_actors(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- E10's recipients, restated from migration 43: the staff branch at the end.
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
  cross join event ev
  where ev.event_type <> 'GUARDIAN_ABSENCE_TO_COACH'
  group by gaa.profile_id

  union all

  -- E10, the one e-mail to the staff: the training's main coach, or every
  -- active administrator of a training that has none (K2e). About the athlete
  -- the guardian withdrew, whose booking is no longer confirmed.
  select staff.profile_id,
         array[a.id],
         array[a.first_name || ' ' || a.last_name],
         array[(ev.payload ->> 'booking_id')::uuid]
  from event ev
  join public.training_sessions s on s.id = ev.training_session_id
  join public.athletes a on a.id = (ev.payload ->> 'athlete_id')::uuid
  cross join lateral (
    select s.main_coach_profile_id as profile_id
     where s.main_coach_profile_id is not null
    union
    select m.profile_id
      from public.workspace_members m
     where s.main_coach_profile_id is null
       and m.workspace_id = s.workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
  ) staff
  where ev.event_type = 'GUARDIAN_ABSENCE_TO_COACH';
$$;

revoke all on function public.notification_event_recipients(uuid) from public;

-- ---------------------------------------------------------------------------
-- Expansion, restated from migration 34: a recipient without a login falls
-- back to the address the club recorded for them.
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
      -- A coach invited but not yet signed in has no login, only the address
      -- the club recorded (migration 36): E10 still reaches them.
      coalesce(u.email, sc.email),
      jsonb_build_object(
        'athlete_ids', to_jsonb(r.athlete_ids),
        'athlete_names', to_jsonb(r.athlete_names),
        'booking_ids', to_jsonb(r.booking_ids))
    from public.notification_event_recipients(p_event_id) r
    join public.app_profiles p on p.id = r.recipient_profile_id
    left join auth.users u on u.id = p.auth_user_id
    left join public.staff_contacts sc on sc.profile_id = p.id
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
revoke all on function public.expand_notification_event(uuid) from public;
revoke all on function public.expand_notification_event(uuid) from authenticated;
grant execute on function public.expand_notification_event(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The claim, restated from migration 34 with the guardian's number and
-- address for E10.
-- ---------------------------------------------------------------------------

drop function if exists public.claim_notification_deliveries(integer, integer, interval);

create function public.claim_notification_deliveries(
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
      'facility_name', f.name,
      'location_name', l.name,
      'changing_room', s.changing_room,
      'birth_year_from', coalesce((e.payload ->> 'birth_year_from')::int, s.birth_year_from),
      'birth_year_to',   coalesce((e.payload ->> 'birth_year_to')::int, s.birth_year_to),
      'coach_name',    actor.display_name,
      'coach_phone',   contact.phone,
      'main_coach_name', main_coach.display_name,
      'deadline_hours', w.cancellation_deadline_hours,
      -- E10 is from a guardian, to the staff: their number for the helper
      -- line and their address for Reply-To. Read here, not snapshotted, so
      -- the outbox holds no guardian address (D-18).
      'actor_phone', case when e.event_type = 'GUARDIAN_ABSENCE_TO_COACH' then actor.phone end,
      'actor_email', case when e.event_type = 'GUARDIAN_ABSENCE_TO_COACH' then actor_user.email::text end)),
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
  left join public.app_profiles actor
    on actor.id = (e.payload ->> 'actor_profile_id')::uuid
  left join public.staff_contacts contact on contact.profile_id = actor.id
  left join auth.users actor_user on actor_user.id = actor.auth_user_id
  left join public.app_profiles main_coach on main_coach.id = s.main_coach_profile_id
  order by m.created_at;
end;
$$;
revoke all on function public.claim_notification_deliveries(integer, integer, interval) from public;
revoke all on function public.claim_notification_deliveries(integer, integer, interval) from authenticated;
grant execute on function public.claim_notification_deliveries(integer, integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- K2n and the NEPŮJDOU section: the roster, restated from migration 44 with
-- the answer, who gave it, whether a withdrawal was late and who withdrew.
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
  parent_message_sent_by_name text,
  attendance        public.attendance_status,
  attendance_at     timestamptz,
  attendance_by_name text,
  guardian_response text,
  responded_at      timestamptz,
  responded_by_name text,
  cancel_late       boolean,
  cancelled_by_name text
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
    sender.display_name,
    b.attendance,
    b.attendance_at,
    marker.display_name,
    b.guardian_response,
    b.responded_at,
    responder.display_name,
    b.cancel_late,
    canceller.display_name
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.athletes a on a.id = b.athlete_id
  left join public.app_profiles booker on booker.id = b.created_by
  left join public.app_profiles payer on payer.id = b.paid_by
  left join public.app_profiles sender on sender.id = b.parent_message_sent_by
  left join public.app_profiles marker on marker.id = b.attendance_by
  left join public.app_profiles responder on responder.id = b.responded_by
  left join public.app_profiles canceller on canceller.id = b.cancelled_by
  left join public.booking_coach_notes note on note.booking_id = b.id
  left join public.athlete_sport_profiles asp
    on asp.athlete_id = a.id and asp.sport_id = s.sport_id
  where b.training_session_id = p_training_session_id
    and public.is_workspace_coach(s.workspace_id)
  order by b.status, a.first_name, a.last_name;
$$;

revoke all on function public.session_roster(uuid) from public;
grant execute on function public.session_roster(uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- K13: the player card's trainings, restated from migration 45 with the same.
-- ---------------------------------------------------------------------------

drop function public.coach_athlete_sessions(uuid, uuid);

create function public.coach_athlete_sessions(
  p_workspace_id uuid,
  p_athlete_id   uuid
)
returns table (
  training_session_id    uuid,
  start_at               timestamptz,
  end_at                 timestamptz,
  status                 public.session_status,
  facility_code          text,
  changing_room          text,
  main_coach_profile_id  uuid,
  booking_id             uuid,
  booking_status         public.booking_status,
  attendance             public.attendance_status,
  paid_at                timestamptz,
  coach_note             text,
  parent_message         text,
  parent_message_sent_at timestamptz,
  guardian_response      text,
  cancellation_reason    text,
  cancel_late            boolean,
  cancelled_at           timestamptz,
  cancelled_by_name      text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.start_at, s.end_at, s.status, f.code, s.changing_room,
         s.main_coach_profile_id, b.id, b.status, b.attendance, b.paid_at,
         n.note, b.parent_message, b.parent_message_sent_at,
         b.guardian_response, b.cancellation_reason, b.cancel_late, b.cancelled_at,
         canceller.display_name
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  left join public.facilities f on f.id = s.facility_id
  left join public.booking_coach_notes n on n.booking_id = b.id
  left join public.app_profiles canceller on canceller.id = b.cancelled_by
  where b.athlete_id = p_athlete_id
    and s.workspace_id = p_workspace_id
    and public.is_workspace_coach(p_workspace_id)
  order by s.start_at desc;
$$;

revoke all on function public.coach_athlete_sessions(uuid, uuid) from public;
grant execute on function public.coach_athlete_sessions(uuid, uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- Erasure, restated from migration 43: a withdrawal's reason goes with the
-- child's other free text.
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

    -- Migration 49: why a child missed a training — `Nemoc`, `Zranění` — is
    -- text about them too, a guardian's (Nepůjde) or a coach's (E07).
    update public.bookings b
       set cancellation_reason = null
     where b.cancellation_reason is not null
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

-- ---------------------------------------------------------------------------
-- Statistics, restated from migration 48: Byl / (Byl + Nebyl + Nepůjde).
-- Occupancy and payment are still over confirmed bookings only; a withdrawal
-- does count towards `Nejnižší docházka`'s three trainings.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_statistics(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_birth_year   integer default null,
  p_coach_id     uuid default null,
  p_main_only    boolean default false,
  -- K20b's chart: 'week' buckets the month by 1.–7., 8.–14., 15.–21. and
  -- 22.–end; 'month' buckets the season by calendar month.
  p_bucket       text default null,
  -- K20b: one coach's own statistics, rather than K20 filtered by a coach.
  p_personal     boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me       uuid := public.current_profile_id();
  v_admin    boolean;
  v_timezone text;
  v_result   jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  v_admin := public.is_workspace_admin(p_workspace_id);

  -- K20b of somebody else is the administrators' (coach test 28). K20's
  -- coach filter is everybody's: it narrows the club's numbers, it does not
  -- open a colleague's page.
  if p_personal and (p_coach_id is null or (p_coach_id <> v_me and not v_admin)) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_bucket is not null and p_bucket not in ('week', 'month') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  with held as (
    select s.id, s.capacity, s.start_at, s.end_at, s.main_coach_profile_id,
           s.facility_id, s.changing_room,
           (s.start_at at time zone v_timezone) as local_start
      from public.training_sessions s
     where s.workspace_id = p_workspace_id
       -- A draft was never offered to anybody: it did not take place.
       and s.status not in ('CANCELLED', 'DRAFT')
       and s.start_at >= p_from
       and s.start_at < p_to
       -- Migration 48: a training counts once it is over, not once it starts.
       and s.end_at <= now()
       and (p_coach_id is null
            or s.main_coach_profile_id = p_coach_id
            or (not p_main_only and exists (
                  select 1 from public.training_session_coaches c
                   where c.training_session_id = s.id and c.profile_id = p_coach_id)))
  ),
  -- Every confirmed booking of a held training, with what it says, and —
  -- migration 49, decision 54 — every athlete a guardian withdrew from it
  -- (`Nepůjde`), as a Nebyl. One withdrawal per athlete and training however
  -- often they rebooked and withdrew again, and none at all when the athlete
  -- ended up booked after all.
  booking as (
    select b.id, b.training_session_id, b.athlete_id,
           true as confirmed,
           b.paid_at is not null as paid,
           -- Every training here has ended, so an unmarked booking is Nebyl.
           case when b.attendance = 'PRESENT' then 1 else 0 end as came,
           extract(year from a.date_of_birth)::int as birth_year
      from public.bookings b
      join held h on h.id = b.training_session_id
      join public.athletes a on a.id = b.athlete_id
     where b.status = 'CONFIRMED'
    union all
    (select distinct on (b.training_session_id, b.athlete_id)
            b.id, b.training_session_id, b.athlete_id,
            false, false, 0,
            extract(year from a.date_of_birth)::int
       from public.bookings b
       join held h on h.id = b.training_session_id
       join public.athletes a on a.id = b.athlete_id
      where b.status = 'CANCELLED_BY_USER'
        and not exists (select 1 from public.bookings c
                         where c.training_session_id = b.training_session_id
                           and c.athlete_id = b.athlete_id
                           and c.status = 'CONFIRMED')
      order by b.training_session_id, b.athlete_id, b.cancelled_at desc)
  ),
  -- The bookings the year filter keeps.
  counted as (
    select * from booking
     where p_birth_year is null or birth_year = p_birth_year
  ),
  -- The trainings the year filter keeps.
  sessions as (
    select h.* from held h
     where p_birth_year is null
        or exists (select 1 from counted c where c.training_session_id = h.id)
  ),
  per_athlete as (
    select c.athlete_id,
           count(*)::int                                  as bookings,
           count(*) filter (where c.confirmed and not c.paid)::int as unpaid,
           count(*) filter (where c.came = 1)::int        as present,
           count(*) filter (where c.came is not null)::int as marked
      from counted c
     group by c.athlete_id
  ),
  -- Main coach and assistants of each kept training, for `Trenéři`.
  staffing as (
    select s.id as session_id, s.main_coach_profile_id as profile_id from sessions s
     where s.main_coach_profile_id is not null
    union
    select c.training_session_id, c.profile_id
      from public.training_session_coaches c
      join sessions s on s.id = c.training_session_id
  )
  select jsonb_build_object(
    'sessions', (select count(*) from sessions),
    'sessions_as_main', (select count(*) from sessions s
                          where p_coach_id is not null and s.main_coach_profile_id = p_coach_id),
    'booked', (select count(*) from booking b join sessions s on s.id = b.training_session_id
                where b.confirmed),
    'capacity', (select coalesce(sum(s.capacity), 0) from sessions s),
    'present', (select count(*) from counted where came = 1),
    'marked', (select count(*) from counted where came is not null),
    'paid', (select count(*) from counted where paid),
    'bookings', (select count(*) from counted where confirmed),
    'unpaid', coalesce((
      select jsonb_agg(jsonb_build_object(
               'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
               'birth_year', extract(year from a.date_of_birth)::int, 'count', p.unpaid)
             order by p.unpaid desc, a.last_name, a.first_name)
        from per_athlete p join public.athletes a on a.id = p.athlete_id
       where p.unpaid > 0), '[]'::jsonb),
    -- Everyone with at least three trainings, lowest first; the screen takes
    -- the top three and shows the rest behind `Všichni hráči`.
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
               'birth_year', extract(year from a.date_of_birth)::int,
               'present', p.present, 'marked', p.marked, 'bookings', p.bookings)
             order by (p.present::numeric / nullif(p.marked, 0)) asc nulls last,
                      a.last_name, a.first_name)
        from per_athlete p join public.athletes a on a.id = p.athlete_id
       where p.bookings >= 3 and p.marked > 0), '[]'::jsonb),
    'coaches', case when v_admin and not p_personal then coalesce((
      select jsonb_agg(row order by (row ->> 'sessions')::int desc, row ->> 'name')
        from (
          select jsonb_build_object(
                   'profile_id', st.profile_id,
                   'name', pr.display_name,
                   'sessions', count(distinct st.session_id),
                   'present', (select count(*) from counted c
                                join staffing x on x.session_id = c.training_session_id
                               where x.profile_id = st.profile_id and c.came = 1),
                   'marked', (select count(*) from counted c
                               join staffing x on x.session_id = c.training_session_id
                              where x.profile_id = st.profile_id and c.came is not null)) as row
            from staffing st
            join public.app_profiles pr on pr.id = st.profile_id
           group by st.profile_id, pr.display_name
        ) per_coach), '[]'::jsonb) end,
    'buckets', case when p_bucket is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', bucket, 'present', present, 'marked', marked) order by bucket)
        from (
          select case when p_bucket = 'month'
                      then to_char(s.local_start, 'YYYY-MM')
                      else least(4, ((extract(day from s.local_start)::int - 1) / 7) + 1)::text
                 end as bucket,
                 count(*) filter (where c.came = 1)::int         as present,
                 count(*) filter (where c.came is not null)::int as marked
            from counted c join sessions s on s.id = c.training_session_id
           group by 1
        ) per_bucket), '[]'::jsonb) end,
    -- K20b's list: the trainings this coach led, newest first.
    'led', case when not p_personal then null else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'start_at', s.start_at, 'end_at', s.end_at,
               'facility_code', f.code, 'capacity', s.capacity,
               'booked', (select count(*) from booking b where b.training_session_id = s.id and b.confirmed),
               'present', (select count(*) from booking b
                            where b.training_session_id = s.id and b.came = 1))
             order by s.start_at desc)
        from sessions s
        left join public.facilities f on f.id = s.facility_id
       where s.main_coach_profile_id = p_coach_id), '[]'::jsonb) end,
    'is_admin', v_admin
  ) into v_result;

  return jsonb_build_object('ok', true, 'data', v_result);
end;
$$;

revoke all on function public.workspace_statistics(uuid, timestamptz, timestamptz, integer, uuid, boolean, text, boolean) from public;
grant execute on function public.workspace_statistics(uuid, timestamptz, timestamptz, integer, uuid, boolean, text, boolean) to authenticated;
