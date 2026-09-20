-- Trainlio — booking engine validation
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- The concurrency requirement (AC-022) needs two parallel connections and is
-- proven separately, in concurrency.sh.
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

-- Family A guards Ivan (2017) and Tomáš (2016); family B guards Anna (2018).
create or replace function pg_temp.ath(p_name text) returns uuid language sql stable as
  $$ select id from public.athletes where first_name = p_name $$;
create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like 'Příbram%' $$;
create or replace function pg_temp.fac() returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code='MH' and w.name like 'Příbram%' $$;

create temp table t_ids (k text primary key, v uuid);

-- A session 30 days out, capacity 2, open to all athletes. The fixtures'
-- sessions already carry bookings, so the suite makes its own.
insert into t_ids (k, v)
select 's', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 30)::date, time '09:00', time '10:00', %L::uuid, 2, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;

create or replace function pg_temp.s() returns uuid language sql stable as
  $$ select v from t_ids where k = 's' $$;

\echo '── The picker shows only what the server would accept ──────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select count(*)::text from public.guardian_session_athletes(%L::uuid)$$, pg_temp.s())),
  '2', 'a guardian sees their own two athletes');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select count(*)::text from public.guardian_session_athletes(%L::uuid)$$, pg_temp.s())),
  '1', 'and another family sees only theirs (AC-091)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select string_agg(eligibility, ',' order by first_name)
    from public.guardian_session_athletes(%L::uuid)$$, pg_temp.s())),
  'ELIGIBLE,ELIGIBLE', 'both are eligible for an all-athletes session');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select bool_and(can_book)::text from public.guardian_session_athletes(%L::uuid)$$, pg_temp.s())),
  'true', 'and both can be booked');

\echo ''
\echo '── Atomic multi-athlete booking (D-05, AC-020, AC-024) ─────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[]::uuid[]) ->> 'code')$$, pg_temp.s())),
  'EMPTY_SELECTION', 'an empty selection is refused');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Ivan'), pg_temp.ath('Ivan'))),
  'DUPLICATE_ATHLETE_IN_REQUEST', 'the same child twice is refused');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.s(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš'))),
  '2', 'two siblings are booked in one action (AC-024)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s()),
  '2', 'and occupancy reaches 2 / 2 (AC-020)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='BOOKING_CREATED_BY_GUARDIAN'),
  '2', 'each booking is audited separately (BR-036)');
select pg_temp.check(
  (select string_agg(distinct created_by_role::text, ',') from public.bookings where training_session_id = pg_temp.s()),
  'USER', 'recorded as guardian-created, never inferred (D-14)');

\echo ''
\echo '── A full session (AC-021) ─────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'INSUFFICIENT_CAPACITY', 'booking into a full session is refused');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'details' ->> 'available_places')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  '0', 'and reports no places left');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Ivan'))),
  'ALREADY_BOOKED', 'the same athlete cannot be booked twice (AC-023)');

\echo ''
\echo '── Not enough places for the whole selection (AC-024a..c) ──────────'
insert into t_ids (k, v)
select 's2', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 31)::date, time '09:00', time '10:00', %L::uuid, 1, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.s2() returns uuid language sql stable as
  $$ select v from t_ids where k = 's2' $$;

select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid]) ->> 'code')$$,
    pg_temp.s2(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš'))),
  'INSUFFICIENT_CAPACITY', 'two children into one free place is refused (AC-024a)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s2()),
  '0', 'and NEITHER child is booked — the point of D-05');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid]) -> 'details' ->> 'available_places')$$,
    pg_temp.s2(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš'))),
  '1', 'the parent is told how many places remain');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.s2(), pg_temp.ath('Ivan'))),
  '1', 'reducing the selection then succeeds (AC-024b)');

\echo ''
\echo '── Eligibility (AC-030, AC-031, AC-032) ────────────────────────────'
insert into t_ids (k, v)
select 's3', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 32)::date, time '09:00', time '10:00', %L::uuid, 10, 'BIRTH_YEAR_RANGE', 2017, 2018)
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.s3() returns uuid language sql stable as
  $$ select v from t_ids where k = 's3' $$;

select pg_temp.check(
  pg_temp.as_user(:A, format($$select eligibility from public.guardian_session_athletes(%L::uuid) where first_name='Ivan'$$, pg_temp.s3())),
  'ELIGIBLE', 'a 2017 athlete is eligible for 2017–2018 (AC-030)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select eligibility from public.guardian_session_athletes(%L::uuid) where first_name='Tomáš'$$, pg_temp.s3())),
  'BIRTH_YEAR_OUT_OF_RANGE', 'a 2016 athlete is not');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid]) ->> 'code')$$,
    pg_temp.s3(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš'))),
  'NOT_ELIGIBLE', 'selecting one ineligible child refuses the whole action (AC-024c)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s3()),
  '0', 'and books neither');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid, %L::uuid])
    -> 'details' -> 'athletes' -> 0 ->> 'reason')$$, pg_temp.s3(), pg_temp.ath('Ivan'), pg_temp.ath('Tomáš'))),
  'BIRTH_YEAR_OUT_OF_RANGE', 'naming which child and why');

\echo ''
\echo '── Session state (BR-030) ──────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, false) ->> 'ok')$$, pg_temp.s3())),
  'true', 'a coach closes booking');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s3(), pg_temp.ath('Ivan'))),
  'SESSION_NOT_OPEN', 'and a closed session accepts nothing, even with places free');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, true) ->> 'ok')$$, pg_temp.s3())),
  'true', 'reopening restores it');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.s3(), pg_temp.ath('Ivan'))),
  '1', 'and booking works again');

\echo ''
\echo '── Cancellation and the deadline (AC-040, AC-041, AC-043) ──────────'
create or replace function pg_temp.booking(p_session uuid, p_athlete uuid) returns uuid language sql stable as
  $$ select id from public.bookings where training_session_id = p_session and athlete_id = p_athlete
     and status = 'CONFIRMED' limit 1 $$;

select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'ok')$$,
    pg_temp.booking(pg_temp.s(), pg_temp.ath('Tomáš')))),
  'true', 'a guardian can cancel well before the session (AC-040)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s()),
  '1', 'a cancelled booking stops counting toward occupancy (AC-043)');
select pg_temp.check(
  (select status::text from public.bookings where training_session_id = pg_temp.s() and athlete_id = pg_temp.ath('Tomáš')),
  'CANCELLED_BY_USER', 'and is preserved, not deleted (BR-044)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='BOOKING_CANCELLED_BY_GUARDIAN'),
  '1', 'the cancellation is audited');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'code')$$,
    pg_temp.booking(pg_temp.s(), pg_temp.ath('Ivan')))),
  'NOT_AUTHORIZED_FOR_ATHLETE', 'another family cannot cancel their booking');

-- A session starting inside the 12-hour window.
insert into t_ids (k, v)
select 'soon', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, current_date, (now() at time zone 'Europe/Prague' + interval '6 hours')::time,
  (now() at time zone 'Europe/Prague' + interval '7 hours')::time, %L::uuid, 10, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.soon() returns uuid language sql stable as
  $$ select v from t_ids where k = 'soon' $$;

select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.soon(), pg_temp.ath('Tomáš'))),
  '1', 'booking is still allowed inside the cancellation window (PRD §10)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'code')$$,
    pg_temp.booking(pg_temp.soon(), pg_temp.ath('Tomáš')))),
  'CANCELLATION_DEADLINE_PASSED', 'but cancelling is not (AC-041)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.soon()),
  '1', 'and the booking stands');

\echo ''
\echo '── A session that has started ──────────────────────────────────────'
update public.training_sessions set start_at = now() - interval '1 minute',
  end_at = now() + interval '59 minutes' where id = pg_temp.s3();
-- The session-level checks run before the per-athlete loop, so a started
-- session refuses everyone for the same reason — including an athlete who
-- would otherwise have been rejected as already booked. That ordering is the
-- contract's, and it gives the parent the one reason that actually applies.
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s3(), pg_temp.ath('Anna'))),
  'SESSION_ALREADY_STARTED', 'a started session accepts nobody new');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s3(), pg_temp.ath('Ivan'))),
  'SESSION_ALREADY_STARTED', 'and says so even for an athlete already booked into it');

\echo ''
\echo '── A cancelled session (D-07) ──────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid) ->> 'ok')$$, pg_temp.s2())),
  'true', 'a coach cancels a session');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s2(), pg_temp.ath('Anna'))),
  'SESSION_CANCELLED', 'nobody can book into it');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'code')$$,
    pg_temp.booking(pg_temp.s2(), pg_temp.ath('Ivan')))),
  'SESSION_CANCELLED', 'and a guardian has nothing left to withdraw from');
select pg_temp.check(
  (select status::text from public.bookings where training_session_id = pg_temp.s2() and athlete_id = pg_temp.ath('Ivan')),
  'CONFIRMED', 'their booking is preserved as the roster at cancellation (AC-070a)');

\echo ''
\echo '── D-06: a coach removal is not a parent undo ──────────────────────'
update public.bookings set status='CANCELLED_BY_COACH', cancelled_at=now(),
  cancelled_by='00000000-0000-0000-0000-00000000c0ac'
  where training_session_id = pg_temp.s() and athlete_id = pg_temp.ath('Ivan');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select can_book::text from public.guardian_session_athletes(%L::uuid) where first_name='Ivan'$$, pg_temp.s())),
  'false', 'the picker stops offering the removed athlete');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Ivan'))),
  'REMOVED_BY_COACH', 'and the booking path refuses it');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
