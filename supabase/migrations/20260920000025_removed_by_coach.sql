-- Trainlio — Sports Training Booking Platform
-- Layer: OUTBOX + DOMAIN OPERATIONS
-- 25 — telling the parent their child was taken off a training
--
-- guardian/SPEC.md §G4b and §G6d, coach/SPEC.md §K2. A coach removing one
-- athlete from a training that still takes place is the most consequential
-- thing this application can do without saying anything: the parent drives to
-- the rink. Until now it said nothing — `cancel_booking_as_coach` wrote the
-- booking and the audit entry and raised no notification at all.
--
-- D-06 is unchanged. The design's new screens offer the parent a `Přihlásit`
-- button to book the child straight back in; CLAUDE.md, D-06 and AC-042a all
-- say they cannot, and for a reason the design does not contradict so much as
-- not know about — a parent who can undo a removal makes the removal
-- advisory. The screens keep everything else; their footer says to contact the
-- coach, which is the sentence the application already uses.

-- ---------------------------------------------------------------------------
-- The message is for the parent, so its length is the parent's business.
--
-- The column is not new and neither is its visibility: `bookings` is readable
-- by the guardians of its athlete, so whatever a coach typed here has always
-- reached them. What changes is that it is now meant to — the specification
-- calls it "Zpráva pro rodiče" and puts it in the e-mail — so it gets the
-- limit the form shows and a comment that says who reads it.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add constraint bookings_cancellation_reason_length
    check (cancellation_reason is null or length(cancellation_reason) <= 200);

comment on column public.bookings.cancellation_reason is
  'Optional message from the coach to the guardian when a booking is removed (coach/SPEC.md §K2). Guardian-visible by the row policy, and included in the notification e-mail.';

-- ---------------------------------------------------------------------------
-- A new event, and the first one whose recipients are not "everyone booked".
-- ---------------------------------------------------------------------------

alter table public.notification_events drop constraint notification_events_type_known;
alter table public.notification_events add constraint notification_events_type_known check (
  event_type in (
    'SESSION_CANCELLED',
    'SESSION_SCHEDULE_CHANGED',
    'SESSION_LOCATION_CHANGED',
    'SESSION_FACILITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED',
    'SESSION_ELIGIBILITY_NARROWED',
    -- Like the narrowing, scoped by payload.affected_athlete_ids. Unlike it,
    -- and unlike every other event here, the booking it is about is already
    -- cancelled by the time this is expanded.
    'BOOKING_REMOVED_BY_COACH'
  )
);

comment on column public.notification_events.payload is
  'Event-level content. SESSION_ELIGIBILITY_NARROWED and BOOKING_REMOVED_BY_COACH must carry affected_athlete_ids, which scopes recipient expansion (D-08, §G4b).';

-- ---------------------------------------------------------------------------
-- Recipients.
--
-- Every other event finds its audience through the confirmed bookings on the
-- session, which is right: they are about a training, and the people to tell
-- are the ones who have a child in it. This one is about a booking that has
-- just stopped being confirmed, so that join would find nobody and the parent
-- would hear nothing — the one case where silence is worst.
--
-- So it takes the guardians of the named athletes directly. The result is the
-- same shape, and expansion, deduplication and the address snapshot above are
-- untouched.
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
      when ev.event_type in ('SESSION_ELIGIBILITY_NARROWED', 'BOOKING_REMOVED_BY_COACH')
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
  )
  select
    gaa.profile_id,
    array_agg(s.id order by s.first_name, s.last_name),
    array_agg(s.first_name || ' ' || s.last_name order by s.first_name, s.last_name)
  from subjects s
  join public.guardian_athlete_access gaa
    on gaa.athlete_id = s.id
   and gaa.status = 'ACTIVE'
  group by gaa.profile_id;
$$;

revoke all on function public.notification_event_recipients(uuid) from public;

-- ---------------------------------------------------------------------------
-- The removal now raises the event.
--
-- Replaces the function from migration 16 unchanged except for the event and
-- the message. The lock, the authorization, the status guard and the audit
-- entry are all as they were.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_booking_as_coach(
  p_booking_id uuid,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_booking record;
  v_session record;
  v_message text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_booking from public.bookings b where b.id = p_booking_id;
  if v_booking.id is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  perform 1 from public.training_session_occupancy o
   where o.training_session_id = v_booking.training_session_id
   for update;

  select * into v_session
  from public.training_sessions s where s.id = v_booking.training_session_id;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if v_booking.status <> 'CONFIRMED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_CONFIRMED');
  end if;

  -- The form limits this too; a caller that is not the form does not.
  if length(coalesce(v_message, '')) > 200 then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_TOO_LONG');
  end if;

  update public.bookings b
     set status = 'CANCELLED_BY_COACH',
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancellation_reason = v_message
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CANCELLED_BY_COACH', 'BOOKING', p_booking_id,
     jsonb_build_object('status', 'CONFIRMED'),
     jsonb_build_object('status', 'CANCELLED_BY_COACH'),
     jsonb_build_object('athlete_id', v_booking.athlete_id, 'reason', v_message));

  -- The parent drives to the rink otherwise.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, v_booking.training_session_id, 'BOOKING_REMOVED_BY_COACH',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(v_booking.athlete_id),
            'reason', v_message));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;
