-- Trainlio — Sports Training Booking Platform
-- Layer: NOTIFICATION OUTBOX + DOMAIN OPERATIONS
-- 34 — the e-mails a parent actually receives (handoff v3, DR-05 and DR-12)
--
-- `docs/design/shared/EMAILS.md` is the first design the e-mails have ever had,
-- and it asks for four things the outbox could not yet express:
--
--   1. **One e-mail per save.** A coach who moves a training and changes the
--      hall in one edit sent two e-mails a minute apart. The design sends one,
--      labelled `Změna tréninku`, with both rows highlighted.
--   2. **The value that was.** Every change row prints the new value and the
--      old one struck through under it. The event payload carried only the new.
--   3. **A new event.** `BOOKING_ADDED_BY_COACH` (E08): a parent is told when
--      the coach books their child, which DR-12 decided — the booking simply
--      appeared in the app before.
--   4. **Who and until when.** E07 names the coach and prints their number; E02
--      and E08 print the cancellation deadline. Neither was reachable from a
--      delivery.
--
-- Nothing here changes who is told. BR-072, BR-073 and D-08 are untouched: the
-- recipients function still finds the guardians of confirmed bookings, or of the
-- named athletes where the event says so, and one guardian still receives one
-- message about their own children.

-- ---------------------------------------------------------------------------
-- Two new event types.
-- ---------------------------------------------------------------------------

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
    -- Several significant fields in one save. One e-mail, every changed row
    -- highlighted (EMAILS.md §2).
    'SESSION_CHANGED',
    -- DR-12. The coach booked a child; the parent is told, with the deadline by
    -- which they can undo it. Never raised for a guardian's own booking.
    'BOOKING_ADDED_BY_COACH'
  )
);

comment on column public.notification_events.payload is
  'Event-level content, snapshotted when the change happened. SESSION_ELIGIBILITY_NARROWED must carry affected_athlete_ids, which scopes recipient expansion (D-08). A session change carries `change` — the guardian-visible record of what moved, from migration 28 — and `actor_profile_id`, which is how E05/E07/E08 name the coach.';

-- ---------------------------------------------------------------------------
-- Recipients, now with the booking each athlete has on that session.
--
-- The button in every e-mail about one booking goes to that booking's own screen
-- (§G6, §G6d). The delivery knows the athletes; this is where the bookings come
-- from, because it is the one place that already walks from an event to the
-- family through them.
--
-- Status is not filtered in the booking lookup on purpose: E01 and E07 are about
-- bookings that have just stopped being confirmed, and their screens are exactly
-- where the parent should land.
-- ---------------------------------------------------------------------------

drop function if exists public.notification_event_recipients(uuid);

create function public.notification_event_recipients(p_event_id uuid)
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
                             'BOOKING_ADDED_BY_COACH')
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
-- Expansion passes the bookings through. Otherwise unchanged: the unique
-- (event_id, recipient_profile_id) constraint is still what makes BR-073 true,
-- and the address is still snapshotted here (D-18).
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
        'athlete_names', to_jsonb(r.athlete_names),
        'booking_ids', to_jsonb(r.booking_ids))
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

revoke all on function public.expand_notification_event(uuid) from public;
revoke all on function public.expand_notification_event(uuid) from authenticated;
grant execute on function public.expand_notification_event(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The claim resolves the three things a template cannot look up.
--
--   * the coach behind the event, by name and — for E07 — by number. The number
--     comes from `staff_contacts`, which no client session can read (migration
--     33); the drain is the service role and reads it directly, which is the
--     second of the two ways a parent is ever given it.
--   * the workspace's cancellation deadline, for `Odhlásit lze do …`.
--   * the facility and location names, as before.
--
-- Everything else still comes from the event's own payload, because that is the
-- snapshot: a coach who moves a training twice before the drain runs owes the
-- first e-mail a description of the first move.
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
      'deadline_hours', w.cancellation_deadline_hours)),
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
  left join public.app_profiles main_coach on main_coach.id = s.main_coach_profile_id
  order by m.created_at;
end;
$$;

revoke all on function public.claim_notification_deliveries(integer, integer, interval) from public;
revoke all on function public.claim_notification_deliveries(integer, integer, interval) from authenticated;
grant execute on function public.claim_notification_deliveries(integer, integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- One event per save, carrying what moved.
--
-- The whole function is restated because PostgreSQL has no way to replace part
-- of one. Everything above the event block is migration 13's, unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.update_training_session(
  p_training_session_id         uuid,
  p_local_date                  date,
  p_local_start_time            time,
  p_local_end_time              time,
  p_facility_id                 uuid,
  p_capacity                    integer,
  p_eligibility_mode            public.eligibility_mode,
  p_birth_year_from             integer default null,
  p_birth_year_to               integer default null,
  p_changing_room               text default null,
  p_public_notes                text default null,
  p_internal_notes              text default null,
  p_main_coach_profile_id       uuid default null,
  p_confirm_over_capacity       boolean default false,
  p_confirm_ineligible_bookings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := public.current_profile_id();
  v_session      record;
  v_timezone     text;
  v_location_id  uuid;
  v_coach        uuid;
  v_start        timestamptz;
  v_end          timestamptz;
  v_confirmed    integer;
  v_affected     uuid[];
  v_significant  boolean := false;
  -- text[]: each append casts explicitly, because an untyped literal on the
  -- right of || is parsed as an array literal rather than as one element.
  v_events       text[] := '{}';
  v_event_id     uuid;
  v_change       jsonb;
  v_changing     text := nullif(btrim(coalesce(p_changing_room, '')), '');
  v_public       text := nullif(btrim(coalesce(p_public_notes, '')), '');
  v_internal     text := nullif(btrim(coalesce(p_internal_notes, '')), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_session from public.training_sessions s where s.id = p_training_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- D-07: a cancelled session is terminal. Nothing about it may be edited,
  -- because its cancellation emails may already have gone out.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- The single serialization point. Taken before reading the confirmed count,
  -- so a booking cannot land between the capacity check and the write.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = p_training_session_id for update;

  select o.confirmed_count into v_confirmed
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  select w.timezone into v_timezone from public.workspaces w where w.id = v_session.workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, v_session.workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  v_start := (p_local_date + p_local_start_time) at time zone v_timezone;
  v_end   := (p_local_date + p_local_end_time)   at time zone v_timezone;
  v_coach := coalesce(p_main_coach_profile_id, v_session.main_coach_profile_id);

  -- BR-051 / AC-051. The warning is a server-side gate, not a dialog: without
  -- the flag the change is refused, and the count is returned so the UI can say
  -- how many are already booked. Existing bookings are preserved either way.
  if p_capacity < v_confirmed and not p_confirm_over_capacity then
    return jsonb_build_object('ok', false, 'code', 'CAPACITY_BELOW_OCCUPANCY',
      'details', jsonb_build_object('confirmed_count', v_confirmed, 'requested_capacity', p_capacity));
  end if;

  -- D-08. Narrowing never auto-cancels. The coach is told how many confirmed
  -- bookings would fall outside the new range and must confirm.
  if p_eligibility_mode = 'BIRTH_YEAR_RANGE' then
    select array_agg(x) into v_affected
    from public.bookings_outside_birth_year_range(p_training_session_id, p_birth_year_from, p_birth_year_to) x;
  end if;

  if v_affected is not null and array_length(v_affected, 1) > 0 and not p_confirm_ineligible_bookings then
    return jsonb_build_object('ok', false, 'code', 'BOOKINGS_WOULD_BECOME_INELIGIBLE',
      'details', jsonb_build_object('affected_count', array_length(v_affected, 1)));
  end if;

  -- D-11: significance is date, start, end, location, facility and main coach.
  -- Not capacity, changing room, notes or assistant coaches.
  if v_session.start_at is distinct from v_start or v_session.end_at is distinct from v_end then
    v_significant := true;
    v_events := v_events || 'SESSION_SCHEDULE_CHANGED'::text;
  end if;
  if v_session.location_id is distinct from v_location_id then
    v_significant := true;
    v_events := v_events || 'SESSION_LOCATION_CHANGED'::text;
  end if;
  if v_session.facility_id is distinct from p_facility_id then
    v_significant := true;
    v_events := v_events || 'SESSION_FACILITY_CHANGED'::text;
  end if;
  if v_session.main_coach_profile_id is distinct from v_coach then
    v_significant := true;
    v_events := v_events || 'SESSION_MAIN_COACH_CHANGED'::text;
  end if;

  begin
    update public.training_sessions s
       set start_at         = v_start,
           end_at           = v_end,
           location_id      = v_location_id,
           facility_id      = p_facility_id,
           capacity         = p_capacity,
           eligibility_mode = p_eligibility_mode,
           birth_year_from  = case when p_eligibility_mode = 'BIRTH_YEAR_RANGE' then p_birth_year_from end,
           birth_year_to    = case when p_eligibility_mode = 'BIRTH_YEAR_RANGE' then p_birth_year_to end,
           changing_room    = v_changing,
           public_notes     = v_public,
           significant_changed_at =
             case when v_significant then now() else s.significant_changed_at end
     where s.id = p_training_session_id;

    if v_session.main_coach_profile_id is distinct from v_coach then
      -- The association table is canonical; the mirror column follows by
      -- trigger, so only this row is written.
      update public.training_session_coaches c
         set profile_id = v_coach
       where c.training_session_id = p_training_session_id and c.role = 'MAIN';
    end if;

    if v_internal is null then
      delete from public.training_session_internal_notes n
       where n.training_session_id = p_training_session_id;
    else
      insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
      values (p_training_session_id, v_internal, v_actor)
      on conflict (training_session_id) do update
        set notes = excluded.notes, updated_by = excluded.updated_by;
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  -- One event per save, not one per field (EMAILS.md §2): a coach who moves a
  -- training and changes the hall in one go sends one e-mail with both rows
  -- highlighted, not two e-mails a minute apart.
  --
  -- The event type is still the specific one when a single thing changed, so
  -- the subject can say `Změna haly` rather than `Změna tréninku`; several
  -- changes take SESSION_CHANGED, which is the label the design gives that case.
  --
  -- What moved comes from `significant_change`, read back after both update
  -- statements above. It is computed by the trigger of migration 28 and holds
  -- the guardian-visible previous values — the same record the card and the
  -- booking screen draw, so the e-mail cannot disagree with the app about what
  -- the training used to be. Read back rather than recomputed here: the main
  -- coach moves in a second statement, and a comparison in this function would
  -- miss it (migration 28 says why).
  if array_length(v_events, 1) is not null then
    select s.significant_change into v_change
    from public.training_sessions s where s.id = p_training_session_id;

    insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
    values (
      v_session.workspace_id,
      p_training_session_id,
      case when array_length(v_events, 1) = 1 then v_events[1] else 'SESSION_CHANGED' end,
      jsonb_strip_nulls(jsonb_build_object(
        'start_at', v_start,
        'end_at', v_end,
        'facility_id', p_facility_id,
        'actor_profile_id', v_actor,
        'change', v_change)));
  end if;

  -- D-08: the affected bookings are stamped individually, and their guardians
  -- alone are notified. A session-level marker would flag every booked family.
  if v_affected is not null and array_length(v_affected, 1) > 0 then
    update public.bookings b
       set eligibility_narrowed_at = now()
     where b.training_session_id = p_training_session_id
       and b.status = 'CONFIRMED'
       and b.athlete_id = any(v_affected);

    insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
    values (v_session.workspace_id, p_training_session_id, 'SESSION_ELIGIBILITY_NARROWED',
            jsonb_strip_nulls(jsonb_build_object(
              'affected_athlete_ids', to_jsonb(v_affected),
              'birth_year_from', p_birth_year_from,
              'birth_year_to', p_birth_year_to,
              -- E06 prints the range that was, struck through, under the one
              -- that is.
              'previous_birth_year_from', v_session.birth_year_from,
              'previous_birth_year_to', v_session.birth_year_to,
              'previous_eligibility_mode', v_session.eligibility_mode,
              'actor_profile_id', v_actor)))
    returning id into v_event_id;

    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
    values (v_session.workspace_id, v_actor, 'SESSION_ELIGIBILITY_NARROWED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('birth_year_from', v_session.birth_year_from, 'birth_year_to', v_session.birth_year_to),
            jsonb_build_object('birth_year_from', p_birth_year_from, 'birth_year_to', p_birth_year_to),
            jsonb_build_object('affected_athlete_ids', to_jsonb(v_affected)));
  end if;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values (v_session.workspace_id, v_actor, 'SESSION_UPDATED', 'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('start_at', v_session.start_at, 'end_at', v_session.end_at,
                             'facility_id', v_session.facility_id, 'capacity', v_session.capacity,
                             'main_coach_profile_id', v_session.main_coach_profile_id),
          jsonb_build_object('start_at', v_start, 'end_at', v_end,
                             'facility_id', p_facility_id, 'capacity', p_capacity,
                             'main_coach_profile_id', v_coach),
          jsonb_build_object('significant', v_significant, 'events', to_jsonb(v_events)));

  if v_session.capacity is distinct from p_capacity then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (v_session.workspace_id, v_actor, 'SESSION_CAPACITY_CHANGED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('capacity', v_session.capacity, 'confirmed_count', v_confirmed),
            jsonb_build_object('capacity', p_capacity));
  end if;

  if v_session.main_coach_profile_id is distinct from v_coach then
    insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values (v_session.workspace_id, v_actor, 'SESSION_MAIN_COACH_CHANGED', 'TRAINING_SESSION', p_training_session_id,
            jsonb_build_object('main_coach_profile_id', v_session.main_coach_profile_id),
            jsonb_build_object('main_coach_profile_id', v_coach));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'training_session_id', p_training_session_id,
    'significant', v_significant,
    'events', to_jsonb(v_events),
    'affected_athlete_count', coalesce(array_length(v_affected, 1), 0)
  ));
end;
$$;

revoke all on function public.update_training_session(
  uuid, date, time, time, uuid, integer, public.eligibility_mode,
  integer, integer, text, text, text, uuid, boolean, boolean) from public;
grant execute on function public.update_training_session(
  uuid, date, time, time, uuid, integer, public.eligibility_mode,
  integer, integer, text, text, text, uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The removal names the coach it was (E07).
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
  --
  -- `actor_profile_id` is new in migration 34: E07 names the coach who removed
  -- the athlete and prints their number, because D-06 leaves ringing them as the
  -- only thing the parent can do.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, v_booking.training_session_id, 'BOOKING_REMOVED_BY_COACH',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(v_booking.athlete_id),
            'actor_profile_id', v_actor,
            'reason', v_message));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('booking_id', p_booking_id));
end;
$$;

revoke all on function public.cancel_booking_as_coach(uuid, text) from public;
grant execute on function public.cancel_booking_as_coach(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- And a coach's booking tells the family (DR-12, E08).
-- ---------------------------------------------------------------------------

create or replace function public.book_athlete_as_coach(
  p_training_session_id   uuid,
  p_athlete_id            uuid,
  p_confirm_over_capacity boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := public.current_profile_id();
  v_session    record;
  v_confirmed  integer;
  v_reason     text;
  v_override   boolean;
  v_booking_id uuid;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  -- Same serialization point as every other path that reads the count.
  perform 1 from public.training_session_occupancy o
   where o.training_session_id = p_training_session_id
   for update;

  select * into v_session from public.training_sessions s where s.id = p_training_session_id;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  v_reason := public.athlete_eligibility_for_session(p_training_session_id, p_athlete_id);
  if v_reason <> 'ELIGIBLE' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ELIGIBLE',
      'details', jsonb_build_object('athlete_id', p_athlete_id, 'reason', v_reason));
  end if;

  if exists (
    select 1 from public.bookings b
    where b.training_session_id = p_training_session_id
      and b.athlete_id = p_athlete_id
      and b.status = 'CONFIRMED'
  ) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_BOOKED');
  end if;

  select o.confirmed_count into v_confirmed
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  v_override := coalesce(v_confirmed, 0) >= v_session.capacity;

  -- AC-050. The warning is a server-side gate: without the confirmation the
  -- addition is refused, and the counts come back so the UI can show
  -- "Trénink je již plný (10 / 10)".
  if v_override and not p_confirm_over_capacity then
    return jsonb_build_object('ok', false, 'code', 'WOULD_EXCEED_CAPACITY',
      'details', jsonb_build_object(
        'capacity', v_session.capacity,
        'confirmed_count', coalesce(v_confirmed, 0)));
  end if;

  insert into public.bookings
    (training_session_id, athlete_id, status, created_by, created_by_role, coach_capacity_override)
  values
    (p_training_session_id, p_athlete_id, 'CONFIRMED', v_actor, 'COACH', v_override)
  returning id into v_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values
    (v_session.workspace_id, v_actor, 'BOOKING_CREATED_BY_COACH', 'BOOKING', v_booking_id,
     jsonb_build_object('training_session_id', p_training_session_id, 'athlete_id', p_athlete_id));

  -- BR-034: an override is explicit and auditable, as its own entry rather than
  -- a flag buried in the booking's.
  if v_override then
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
    values
      (v_session.workspace_id, v_actor, 'BOOKING_CAPACITY_OVERRIDDEN', 'BOOKING', v_booking_id,
       jsonb_build_object('capacity', v_session.capacity,
                          'confirmed_before', coalesce(v_confirmed, 0),
                          'confirmed_after', coalesce(v_confirmed, 0) + 1));
  end if;

  -- DR-12, E08: the parent is told. Not for their own bookings — this function
  -- is the coach's path, and a parent who just booked does not need an e-mail
  -- about it (EMAILS.md §4).
  --
  -- Raised for an over-capacity addition too: that the coach had to override
  -- the limit is their business, and the parent's business is that their child
  -- is on the training and until when they may undo it.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, p_training_session_id, 'BOOKING_ADDED_BY_COACH',
          jsonb_build_object(
            'affected_athlete_ids', jsonb_build_array(p_athlete_id),
            'actor_profile_id', v_actor));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'booking_id', v_booking_id,
    'capacity_override', v_override
  ));
end;
$$;

revoke all on function public.book_athlete_as_coach(uuid, uuid, boolean) from public;
grant execute on function public.book_athlete_as_coach(uuid, uuid, boolean) to authenticated;
