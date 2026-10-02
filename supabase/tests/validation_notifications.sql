-- Trainlio — notification outbox validation
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- Covers AC-061, AC-071 to AC-073 and AC-150 to AC-152: who is told, that a
-- guardian is told once, that re-running expansion is safe, and that no client
-- role can reach any of it.
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP 0

create or replace function pg_temp.as_user(p_sub text, p_sql text)
returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', p_sub, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into r;
  perform set_config('role', 'none', true);
  return r;
exception when others then
  perform set_config('role', 'none', true);
  return 'DENIED';
end $$;

create or replace function pg_temp.check(p_actual text, p_expected text, p_label text)
returns text language plpgsql as $$
begin
  if p_actual is not distinct from p_expected then return 'PASS  ' || p_label;
  else return 'FAIL  ' || p_label || ' (expected ' || coalesce(p_expected,'null') ||
              ', got ' || coalesce(p_actual,'null') || ')'; end if;
end $$;

\set COACH '''00000000-0000-0000-0000-00000000c0ac'''
\set A '''00000000-0000-0000-0000-0000000fa000'''
\set B '''00000000-0000-0000-0000-0000000fb000'''

create or replace function pg_temp.ath(p_name text) returns uuid language sql stable as
  $$ select id from public.athletes where first_name = p_name $$;
create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like '%Příbram%' $$;
create or replace function pg_temp.fac(p_code text) returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code=p_code and w.name like '%Příbram%' $$;

create temp table t_ids (k text primary key, v uuid);

-- Family A guards Ivan (2017) and Tomáš (2016). Both booked into one session is
-- the AC-072 / AC-073 case: one guardian, two children, one email naming both.
insert into t_ids (k, v)
select 's', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 30)::date, time '09:00', time '10:00', %L::uuid, 10, 'ALL',
  null, null, 'Šatna 4')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;
create or replace function pg_temp.s() returns uuid language sql stable as
  $$ select v from t_ids where k = 's' $$;

select pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid,
  array[%L::uuid, %L::uuid]) ->> 'ok')$$, pg_temp.s(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš')));
select pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid,
  array[%L::uuid]) ->> 'ok')$$, pg_temp.s(), pg_temp.ath('Anna')));

\echo '── The outbox is unreachable by every client role (AC-150) ─────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.notification_events$$),
  'DENIED', 'a guardian cannot read notification_events');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.notification_deliveries$$),
  'DENIED', 'nor the deliveries, which carry email addresses (M-09)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.notification_deliveries$$),
  'DENIED', 'and neither can a coach');
select pg_temp.check(
  (select count(*)::text from information_schema.role_table_grants
    where table_schema='public' and table_name in ('notification_events','notification_deliveries')
      and grantee in ('anon','authenticated')),
  '0', 'the tables carry no grant for a client role at all');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.expand_notification_event(
    (select id from public.notification_events limit 1)) ->> 'ok')$$)),
  'DENIED', 'the expansion function is not executable by a guardian');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select (public.claim_notification_deliveries() is not null)::text$$),
  'DENIED', 'nor the claim function by a coach');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.notification_queue_depth()::text$$),
  'DENIED', 'nor the queue depth');

\echo ''
\echo '── A significant change produces an event (AC-061, BR-061) ─────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, (current_date + 30)::date, time '10:00', time '11:00', %L::uuid, 10, 'ALL')
    -> 'data' ->> 'significant')$$, pg_temp.s(), pg_temp.fac('MH'))),
  'true', 'a time change is significant');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = pg_temp.s() and event_type = 'SESSION_SCHEDULE_CHANGED'),
  '1', 'and queues exactly one event');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, (current_date + 30)::date, time '10:00', time '11:00', %L::uuid, 10, 'ALL',
    null, null, 'Šatna 7') -> 'data' ->> 'significant')$$, pg_temp.s(), pg_temp.fac('MH'))),
  'false', 'a changing-room change is not (BR-063, D-12)');
select pg_temp.check(
  (select count(*)::text from public.notification_events where training_session_id = pg_temp.s()),
  '1', 'and queues nothing');

\echo ''
\echo '── Recipients: every active guardian of a booked athlete (AC-071) ──'
create or replace function pg_temp.ev(p_type text) returns uuid language sql stable as
  $$ select id from public.notification_events
     where training_session_id = pg_temp.s() and event_type = p_type
     order by created_at desc limit 1 $$;

select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))),
  '2', 'two families are booked, so two recipients');
-- AC-072: family A has two children in this session and appears once.
select pg_temp.check(
  (select array_length(athlete_ids, 1)::text from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000'),
  '2', 'the family with two booked children is one recipient carrying both (AC-072)');
select pg_temp.check(
  (select array_to_string(athlete_names, ', ') from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000'),
  'Ivan Kotov, Tomáš Svoboda', 'and names them, which is what the email lists (AC-073)');

-- A second guardian on the same athlete: BR-002 is M:N from day one.
insert into public.guardian_athlete_access(profile_id, athlete_id)
values ('00000000-0000-0000-0000-0000005f4a46', pg_temp.ath('Ivan'));
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))),
  '3', 'a second guardian of a booked athlete is also a recipient (BR-072)');
update public.guardian_athlete_access set status = 'REVOKED'
 where profile_id = '00000000-0000-0000-0000-0000005f4a46';
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))),
  '2', 'but only while their access is ACTIVE');

-- A cancelled booking is not a recipient.
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'ok')$$,
    (select id from public.bookings where training_session_id = pg_temp.s()
       and athlete_id = pg_temp.ath('Anna') and status='CONFIRMED'))),
  'true', 'a family withdraws');
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_SCHEDULE_CHANGED'))),
  '1', 'and stops being told about the session');

\echo ''
\echo '── Expansion, and re-running it (AC-151, BR-073) ───────────────────'
select pg_temp.check(
  (public.expand_notification_event(pg_temp.ev('SESSION_SCHEDULE_CHANGED')) -> 'data' ->> 'created'),
  '1', 'expansion creates one delivery per recipient');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries d
    where d.event_id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  '1', 'one row per guardian per event, which is the deduplication (BR-073)');
select pg_temp.check(
  (select recipient_email from public.notification_deliveries d
    where d.event_id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  'familyA@example.test', 'carrying the address it will be sent to');
select pg_temp.check(
  (select payload -> 'athlete_names' ->> 0 from public.notification_deliveries d
    where d.event_id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  'Ivan Kotov', 'and that guardian''s own athletes');
select pg_temp.check(
  (select (dispatched_at is not null)::text from public.notification_events
    where id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  'true', 'the event is marked dispatched');
select pg_temp.check(
  (public.expand_notification_event(pg_temp.ev('SESSION_SCHEDULE_CHANGED')) -> 'data' ->> 'already_dispatched'),
  'true', 're-running reports it was already done');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries d
    where d.event_id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  '1', 'and creates no duplicate row (AC-151)');
select pg_temp.check(
  (public.expand_notification_event('00000000-0000-0000-0000-00000000dead'::uuid) ->> 'code'),
  'EVENT_NOT_FOUND', 'an unknown event is reported as such');

-- Even with the dispatch marker cleared, the unique constraint holds the line.
update public.notification_events set dispatched_at = null
 where id = pg_temp.ev('SESSION_SCHEDULE_CHANGED');
select pg_temp.check(
  (public.expand_notification_event(pg_temp.ev('SESSION_SCHEDULE_CHANGED')) -> 'data' ->> 'created'),
  '0', 'expansion is idempotent on the constraint, not only on the marker');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries d
    where d.event_id = pg_temp.ev('SESSION_SCHEDULE_CHANGED')),
  '1', 'so a cleared marker still cannot double-send (AC-151)');

\echo ''
\echo '── D-08 narrows the recipients rather than the message ─────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'NOT_AUTHORIZED_FOR_ATHLETE', 'family A cannot book another family''s athlete');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'ok')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'true', 'family B books back in');
-- Narrowing to 2017 leaves Tomáš (2016) and Anna (2018) outside.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, (current_date + 30)::date, time '10:00', time '11:00', %L::uuid, 10,
    'BIRTH_YEAR_RANGE', 2017, 2017, null, null, null, null, false, true) ->> 'ok')$$,
    pg_temp.s(), pg_temp.fac('MH'))),
  'true', 'the coach narrows the birth-year range with the confirmation (D-08)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = pg_temp.s() and event_type = 'SESSION_ELIGIBILITY_NARROWED'),
  '1', 'which queues its own event');
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_ELIGIBILITY_NARROWED'))),
  '2', 'told to the affected families only');
select pg_temp.check(
  (select array_to_string(athlete_names, ', ') from public.notification_event_recipients(pg_temp.ev('SESSION_ELIGIBILITY_NARROWED'))
    where recipient_profile_id = '00000000-0000-0000-0000-0000000fa000'),
  'Tomáš Svoboda', 'and family A hears only about the child who fell outside, not about Ivan');

\echo ''
\echo '── Cancellation tells everyone still booked (AC-071, BR-072) ───────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid, 'Porucha chlazení') ->> 'ok')$$,
    pg_temp.s())),
  'true', 'the coach cancels the session');
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.ev('SESSION_CANCELLED'))),
  '2', 'both remaining families are recipients');
select pg_temp.check(
  (select payload ->> 'reason' from public.notification_events where id = pg_temp.ev('SESSION_CANCELLED')),
  'Porucha chlazení', 'the reason travels on the event, for the message to quote');
select pg_temp.check(
  (public.expand_notification_event(pg_temp.ev('SESSION_CANCELLED')) -> 'data' ->> 'created'),
  '2', 'expansion creates one delivery each');
select pg_temp.check(
  (select array_to_string(array(select jsonb_array_elements_text(payload -> 'athlete_names')), ', ')
     from public.notification_deliveries
    where event_id = pg_temp.ev('SESSION_CANCELLED')
      and recipient_profile_id = '00000000-0000-0000-0000-0000000fa000'),
  'Ivan Kotov, Tomáš Svoboda', 'family A gets one message naming both children (AC-072, AC-073)');

\echo ''
\echo '── Claiming, sending and recording ─────────────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.pending_notification_events(50)),
  '1', 'the narrowing event is still waiting, and the drain finds it');
select pg_temp.check(
  (select e.event_type from public.notification_events e
     where e.id = (select * from public.pending_notification_events(1))),
  'SESSION_ELIGIBILITY_NARROWED', 'which is the one nothing has expanded yet');
select pg_temp.check(
  (public.expand_notification_event(pg_temp.ev('SESSION_ELIGIBILITY_NARROWED')) -> 'data' ->> 'created'),
  '2', 'expanding it creates its deliveries');
select pg_temp.check(
  (select count(*)::text from public.pending_notification_events(50)),
  '0', 'and then nothing is left undispatched');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)),
  '5', 'the drain claims every sendable delivery');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries where status = 'SENDING'),
  '5', 'claiming marks them SENDING inside the claiming transaction');
select pg_temp.check(
  (select bool_and(claimed_at is not null)::text from public.notification_deliveries),
  'true', 'and stamps when it took them');
select pg_temp.check(
  (select bool_and(attempt_count = 1)::text from public.notification_deliveries),
  'true', 'and counts the attempt');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)),
  '0', 'a second drain running at once claims nothing twice');

create or replace function pg_temp.delivery() returns uuid language sql stable as
  $$ select id from public.notification_deliveries order by created_at, id limit 1 $$;

select pg_temp.check(
  (public.record_notification_delivery(pg_temp.delivery(), true, 'prov_123') ->> 'ok'),
  'true', 'a success is recorded');
select pg_temp.check(
  (select status::text || '|' || provider_message_id || '|' || (sent_at is not null)::text
     from public.notification_deliveries where id = pg_temp.delivery()),
  'SENT|prov_123|true', 'with the provider id and the send time');
select pg_temp.check(
  (public.record_notification_delivery('00000000-0000-0000-0000-00000000dead'::uuid, true) ->> 'code'),
  'DELIVERY_NOT_FOUND', 'an unknown delivery is reported as such');

create or replace function pg_temp.other() returns uuid language sql stable as
  $$ select id from public.notification_deliveries where status = 'SENDING' order by created_at, id limit 1 $$;
insert into t_ids (k, v) select 'failing', pg_temp.other();
select pg_temp.check(
  (public.record_notification_delivery((select v from t_ids where k='failing'), false, null, 'retryable: 503') ->> 'ok'),
  'true', 'a failure is recorded');
select pg_temp.check(
  (select status::text || '|' || last_error from public.notification_deliveries
     where id = (select v from t_ids where k='failing')),
  'FAILED|retryable: 503', 'with the error, for an operator to read');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)
     where delivery_id = (select v from t_ids where k='failing')),
  '1', 'and a FAILED delivery is retried on the next run');
select pg_temp.check(
  (select attempt_count::text from public.notification_deliveries
     where id = (select v from t_ids where k='failing')),
  '2', 'each attempt is counted');

-- The attempt budget stops a permanently broken address from being retried for
-- the life of the workspace.
update public.notification_deliveries set attempt_count = 5, status = 'FAILED'
 where id = (select v from t_ids where k='failing');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)
     where delivery_id = (select v from t_ids where k='failing')),
  '0', 'a delivery past the attempt budget is left alone');

-- A row stuck SENDING means the drain died between claiming and recording.
update public.notification_deliveries
   set status = 'SENDING', attempt_count = 0, claimed_at = now() - interval '1 hour'
 where id = (select v from t_ids where k='failing');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)
     where delivery_id = (select v from t_ids where k='failing')),
  '1', 'a stale SENDING row is reclaimed rather than stranded');
update public.notification_deliveries set status = 'SENDING', claimed_at = now()
 where id = (select v from t_ids where k='failing');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)
     where delivery_id = (select v from t_ids where k='failing')),
  '0', 'a fresh one is not, because a send may still be in flight');

-- D-18: an anonymisation that clears the address must not produce a send with
-- no recipient, and must not fail the drain either.
update public.notification_deliveries set recipient_email = null, status = 'PENDING', attempt_count = 0
 where id = (select v from t_ids where k='failing');
select pg_temp.check(
  (select count(*)::text from public.claim_notification_deliveries(10)
     where delivery_id = (select v from t_ids where k='failing')),
  '0', 'a delivery with no address is never claimed');
select pg_temp.check(
  (select count(*)::text from public.notification_deliveries
     where id = (select v from t_ids where k='failing')),
  '1', 'but the record of the intent is preserved (D-18)');

\echo ''
\echo '── The database names no provider (AC-152) ─────────────────────────'
select pg_temp.check(
  (select count(*)::text from information_schema.columns
    where table_schema = 'public'
      and (column_name ilike '%resend%' or column_name ilike '%sendgrid%'
           or column_name ilike '%mailgun%' or column_name ilike '%postmark%')),
  '0', 'no column names an email provider');
select pg_temp.check(
  (select count(*)::text from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'notification_deliveries'
     and pg_get_constraintdef(c.oid) ilike '%resend%'),
  '0', 'and no constraint does either');
select pg_temp.check(
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='notification_deliveries'
      and column_name='provider_message_id'),
  'text', 'the provider id is opaque text, not a typed vendor reference');

\echo ''
\echo '── Queue depth, for the drain to report ────────────────────────────'
select pg_temp.check(
  (public.notification_queue_depth() ->> 'undispatched_events'),
  '0', 'the queue reports undispatched events');
select pg_temp.check(
  (public.notification_queue_depth() ->> 'sent'),
  '1', 'and how many were sent');
-- The staleness window is what the trigger-maintained updated_at cannot
-- express: it is reset by any write, including one that has nothing to do with
-- the claim.
select pg_temp.check(
  (select (updated_at > claimed_at)::text from public.notification_deliveries
     where id = (select v from t_ids where k='failing')),
  'true', 'updated_at moves independently of the claim, which is why it is not the clock');
select pg_temp.check(
  ((public.notification_queue_depth() ->> 'pending')::int
   + (public.notification_queue_depth() ->> 'sending')::int
   + (public.notification_queue_depth() ->> 'failed')::int
   + (public.notification_queue_depth() ->> 'sent')::int)::text,
  (select count(*)::text from public.notification_deliveries),
  'and the four states account for every delivery');

\echo ''
\echo '── A coach removes one child: the parent is told (AC-260) ───────────'
-- Every other event finds its audience through the confirmed bookings on the
-- session. This one is about a booking that has just stopped being confirmed,
-- so that join would find nobody — and the one case where silence is worst is
-- the one where the parent otherwise drives to the rink.
--
-- The ids are captured before the removal, because afterwards the booking is
-- no longer confirmed and a lookup that filters on that finds nothing.
insert into t_ids (k, v)
select 'ivan_b', b.id from public.bookings b
 where b.training_session_id = pg_temp.s() and b.athlete_id = pg_temp.ath('Ivan');
insert into t_ids (k, v)
select 'tomas_b', b.id from public.bookings b
 where b.training_session_id = pg_temp.s() and b.athlete_id = pg_temp.ath('Tomáš');
create or replace function pg_temp.ivan_b() returns uuid language sql stable as
  $$ select v from t_ids where k = 'ivan_b' $$;
create or replace function pg_temp.tomas_b() returns uuid language sql stable as
  $$ select v from t_ids where k = 'tomas_b' $$;

-- The form limits the message; a caller that is not the form does not.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid, %L) ->> 'code')$$,
    pg_temp.ivan_b(), repeat('a', 201))),
  'MESSAGE_TOO_LONG', 'a message longer than the form allows is refused (AC-260)');
select pg_temp.check(
  (select status::text from public.bookings where id = pg_temp.ivan_b()),
  'CONFIRMED', 'and the refusal removed nobody (AC-260)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid,
    'Dnes trénují jen brankáři.') ->> 'ok')$$, pg_temp.ivan_b())),
  'true', 'the coach removes the athlete with a message for the parent (AC-260)');

create or replace function pg_temp.removal() returns uuid language sql stable as
  $$ select id from public.notification_events
      where event_type = 'BOOKING_REMOVED_BY_COACH' order by created_at desc limit 1 $$;

select pg_temp.check(
  (select (pg_temp.removal() is not null)::text),
  'true', 'which raises an event, where before it raised none (AC-260)');
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.removal())),
  '1', 'the guardian of the removed athlete is a recipient, cancelled booking and all (AC-260)');
select pg_temp.check(
  (select array_to_string(athlete_names, ', ')
     from public.notification_event_recipients(pg_temp.removal())),
  'Ivan Kotov', 'named as the athlete this is about (AC-260)');
select pg_temp.check(
  (select (recipient_profile_id = '00000000-0000-0000-0000-0000000fa000')::text
     from public.notification_event_recipients(pg_temp.removal())),
  'true', 'and only that family — nobody else booked into the session hears it (AC-260)');
select pg_temp.check(
  (select payload ->> 'reason' from public.notification_events where id = pg_temp.removal()),
  'Dnes trénují jen brankáři.', 'the coach message travels with the event (AC-260)');

-- The message is for the parent, and the row policy has always let them read
-- it. What is new is that it is meant to be read.
select pg_temp.check(
  pg_temp.as_user(:A, format($$select cancellation_reason from public.bookings where id = %L::uuid$$,
    pg_temp.ivan_b())),
  'Dnes trénují jen brankáři.', 'the parent can read it on their own booking (AC-260)');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select count(*)::text from public.bookings where id = %L::uuid$$,
    pg_temp.ivan_b())),
  '0', 'and another family reads neither the booking nor the message (AC-260, AC-091)');

-- The place is free again, which is the whole difference from a cancellation.
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy
    where training_session_id = pg_temp.s()),
  '2', 'the place is released immediately (AC-260, AC-043)');

-- D-06 — that the parent cannot put the child back — is asserted in
-- validation_roster.sql as AC-042a, against the same functions. Repeating it
-- here would only prove that this suite cancelled the session earlier, which
-- is a different refusal and says nothing about the rule.
-- Everyone else on the session is unaffected.
select pg_temp.check(
  (select status::text from public.bookings where id = pg_temp.tomas_b()),
  'CONFIRMED', 'the sibling keeps their place (AC-260)');

\echo ''
\echo '── One save, one e-mail (EMAILS.md §2, AC-283) ──────────────────────'
-- A second session: the one above has been cancelled, and these cases are about
-- a training that is still running.
insert into t_ids (k, v)
select 's2', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 40)::date, time '09:00', time '10:00', %L::uuid, 10, 'ALL',
  null, null, 'Šatna 2')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac('MH'))))::uuid;
create or replace function pg_temp.s2() returns uuid language sql stable as
  $$ select v from t_ids where k = 's2' $$;

select pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid,
  array[%L::uuid]) ->> 'ok')$$, pg_temp.s2(), pg_temp.ath('Ivan')));

-- The time and the hall, in one save. Before v3 this was two e-mails a minute
-- apart; now it is one, and its label is `Změna tréninku`.
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.update_training_session(
    %L::uuid, (current_date + 40)::date, time '10:30', time '11:30', %L::uuid, 10, 'ALL')
    -> 'data' ->> 'significant')$$, pg_temp.s2(), pg_temp.fac('VH'))),
  'true', 'two significant fields change in one save (AC-283)');
select pg_temp.check(
  (select count(*)::text from public.notification_events where training_session_id = pg_temp.s2()),
  '1', 'and queue one event, not one per field (AC-283)');
select pg_temp.check(
  (select event_type from public.notification_events where training_session_id = pg_temp.s2()),
  'SESSION_CHANGED', 'under the type the design gives that case (AC-283)');
select pg_temp.check(
  (select array_to_string(array(
      select jsonb_array_elements_text(payload -> 'change' -> 'fields') order by 1), ',')
     from public.notification_events where training_session_id = pg_temp.s2()),
  'FACILITY,TIME', 'naming both fields, so both rows can be highlighted (AC-283)');
-- The value that was, which is what the struck-through line under each row
-- prints. It comes from migration 28's record, so the e-mail and the app cannot
-- disagree about what the training used to be.
select pg_temp.check(
  (select payload -> 'change' -> 'previous' ->> 'facility_code'
     from public.notification_events where training_session_id = pg_temp.s2()),
  'MH', 'and what it used to be (AC-283)');
select pg_temp.check(
  (select (payload -> 'change' -> 'previous' ->> 'start_at' is not null)::text
     from public.notification_events where training_session_id = pg_temp.s2()),
  'true', 'including the time it used to start (AC-283)');

\echo ''
\echo '── The coach books a child, and the parent hears (DR-12, AC-284) ────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'ok')$$,
    pg_temp.s2(), pg_temp.ath('Anna'))),
  'true', 'the coach adds an athlete by hand (AC-284)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = pg_temp.s2() and event_type = 'BOOKING_ADDED_BY_COACH'),
  '1', 'which raises the event the design added for it (AC-284)');
create or replace function pg_temp.added() returns uuid language sql stable as
  $$ select id from public.notification_events
     where training_session_id = pg_temp.s2() and event_type = 'BOOKING_ADDED_BY_COACH'
     order by created_at desc limit 1 $$;
select pg_temp.check(
  (select array_to_string(athlete_names, ', ')
     from public.notification_event_recipients(pg_temp.added())),
  'Anna Kotova', 'told to the family of that child (AC-284)');
select pg_temp.check(
  (select count(*)::text from public.notification_event_recipients(pg_temp.added())),
  '1', 'and to nobody else on the training (AC-284)');
select pg_temp.check(
  (select (payload ->> 'actor_profile_id')
     from public.notification_events where id = pg_temp.added()),
  '00000000-0000-0000-0000-00000000c0ac', 'carrying the coach, whom E08 names (AC-284)');

-- A parent who books their own child needs no e-mail about it (EMAILS.md §4).
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid,
    array[%L::uuid]) ->> 'ok')$$, pg_temp.s2(), pg_temp.ath('Tomáš'))),
  'true', 'a parent books their own (AC-284)');
select pg_temp.check(
  (select count(*)::text from public.notification_events
    where training_session_id = pg_temp.s2() and event_type = 'BOOKING_ADDED_BY_COACH'),
  '1', 'and that raises nothing: the e-mail is about what the coach did (AC-284)');

\echo ''
\echo '── What a template cannot look up, the claim resolves (AC-283) ──────'
select pg_temp.as_user(:COACH, $$select public.set_own_staff_phone('777654321')->>'ok'$$);
create or replace function pg_temp.ivan_b2() returns uuid language sql stable as
  $$ select b.id from public.bookings b
      where b.training_session_id = pg_temp.s2()
        and b.athlete_id = pg_temp.ath('Ivan') limit 1 $$;
select pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid, 'Nemoc') ->> 'ok')$$,
  pg_temp.ivan_b2()));
create or replace function pg_temp.removed2() returns uuid language sql stable as
  $$ select id from public.notification_events
     where training_session_id = pg_temp.s2() and event_type = 'BOOKING_REMOVED_BY_COACH'
     order by created_at desc limit 1 $$;
select public.expand_notification_event(pg_temp.removed2());

create temp table t_claim as
  select * from public.claim_notification_deliveries(50) c
   where c.event_id = pg_temp.removed2();

select pg_temp.check(
  (select session_payload ->> 'coach_name' from t_claim),
  'Trenér Novák', 'the coach who removed the athlete, by name (AC-283)');
-- The second of exactly two places a parent is given this number (decision 28).
-- The drain is the service role; no client session can read that table at all.
select pg_temp.check(
  (select session_payload ->> 'coach_phone' from t_claim),
  '777654321', 'and their number, for E07 (AC-283, AC-280)');
select pg_temp.check(
  (select session_payload ->> 'deadline_hours' from t_claim),
  '12', 'the deadline the workspace keeps, for `Odhlásit lze` (AC-283)');
select pg_temp.check(
  (select session_payload ->> 'facility_name' from t_claim),
  'Velká hala', 'the hall by name, because the e-mail declines it (AC-283)');
-- The button opens this booking's own screen (§G6d), so the delivery carries it.
select pg_temp.check(
  (select array_to_string(array(select jsonb_array_elements_text(delivery_payload -> 'booking_ids')), ',')
     from t_claim),
  pg_temp.ivan_b2()::text, 'and the booking the button opens (AC-283)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
