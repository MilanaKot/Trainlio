-- Trainlio — coach roster validation
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- Covers AC-042, AC-042a to AC-042c, AC-050 and AC-142: the roster a coach
-- reads, the candidates they may add, the capacity override and the removal
-- that a guardian cannot undo.
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
\set COACH2 '''00000000-0000-0000-0000-00000000c0ad'''
\set A '''00000000-0000-0000-0000-0000000fa000'''
\set B '''00000000-0000-0000-0000-0000000fb000'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''
\set NOBODY ''''''

create or replace function pg_temp.ath(p_name text) returns uuid language sql stable as
  $$ select id from public.athletes where first_name = p_name $$;
create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces where name like 'Příbram%' $$;
create or replace function pg_temp.fac() returns uuid language sql stable as
  $$ select f.id from public.facilities f join public.locations l on l.id=f.location_id
     join public.workspaces w on w.id=l.workspace_id where f.code='MH' and w.name like 'Příbram%' $$;
create or replace function pg_temp.booking(p_session uuid, p_athlete uuid) returns uuid language sql stable as
  $$ select id from public.bookings where training_session_id = p_session and athlete_id = p_athlete
     and status = 'CONFIRMED' limit 1 $$;

create temp table t_ids (k text primary key, v uuid);

-- Capacity 2, so the third addition is the override case without any editing of
-- the session in between.
insert into t_ids (k, v)
select 's', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 30)::date, time '09:00', time '10:00', %L::uuid, 2, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.s() returns uuid language sql stable as
  $$ select v from t_ids where k = 's' $$;

\echo '── The roster a coach reads (BR-092, UI_SPEC) ──────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.s(), pg_temp.ath('Ivan'))),
  '1', 'a guardian books their athlete');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  '1', 'and the coach sees exactly that one row');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select booked_by_name from public.session_roster(%L::uuid)$$, pg_temp.s())),
  'Rodina A', 'the roster names who booked, which no policy on app_profiles allows (BR-092)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select created_by_role::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  'USER', 'and under which role');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (booked_at is not null)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  'true', 'with the booking time (AC-090)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select position_code || '/' || coalesce(club_name,'—') from public.session_roster(%L::uuid)$$, pg_temp.s())),
  'CENTER/—', 'and the sport profile for the session sport');
select pg_temp.check(
  pg_temp.as_user(:COACH2, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  '1', 'any coach of the workspace sees it, not only the session creator');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  '0', 'the guardian who made the booking cannot read the roster (D-13, AC-091)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  '0', 'and neither can a stranger holding the session id');
select pg_temp.check(
  pg_temp.as_user(:NOBODY, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.s())),
  '0', 'nor an unauthenticated caller');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.session_roster('00000000-0000-0000-0000-00000000dead'::uuid)$$),
  '0', 'an unknown session id yields nothing rather than an error');

\echo ''
\echo '── Who the coach may add ───────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.coach_session_candidates(%L::uuid)$$, pg_temp.s())),
  '3', 'the picker offers every active athlete of the workspace, not one family');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select string_agg(first_name || '=' || can_add::text, ',' order by first_name)
    from public.coach_session_candidates(%L::uuid)$$, pg_temp.s())),
  'Anna=true,Ivan=false,Tomáš=true', 'the already-booked athlete cannot be added twice');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select booking_status::text from public.coach_session_candidates(%L::uuid) where first_name='Ivan'$$, pg_temp.s())),
  'CONFIRMED', 'and the picker says why');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select count(*)::text from public.coach_session_candidates(%L::uuid)$$, pg_temp.s())),
  '0', 'a guardian cannot enumerate the workspace roster through the picker (S-T3)');

\echo ''
\echo '── Coach manual booking ────────────────────────────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'NOT_AUTHORIZED', 'a guardian calling the coach path is refused');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'NOT_AUTHORIZED', 'and so is anyone outside the workspace');
select pg_temp.check(
  pg_temp.as_user(:NOBODY, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'NOT_AUTHENTICATED', 'an unauthenticated caller never reaches the session lookup');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach('00000000-0000-0000-0000-00000000dead'::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.ath('Anna'))),
  'SESSION_NOT_FOUND', 'an unknown session is reported as such');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'ok')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'true', 'the coach adds an athlete no guardian of theirs manages');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) -> 'data' ->> 'capacity_override')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  null, 'a second attempt returns no data');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'ALREADY_BOOKED', 'because the athlete already holds a place (BR-031)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s()),
  '2', 'the session is now full at 2 / 2');
select pg_temp.check(
  (select created_by_role::text from public.bookings b
    where b.training_session_id = pg_temp.s() and b.athlete_id = pg_temp.ath('Anna')),
  'COACH', 'the booking records the role it was created under (D-14)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select booked_by_name from public.session_roster(%L::uuid) where first_name='Anna'$$, pg_temp.s())),
  'Trenér Novák', 'and the roster attributes it to the coach');

\echo ''
\echo '── The capacity override is a server-side gate (AC-050) ────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Tomáš'))),
  'WOULD_EXCEED_CAPACITY', 'a full session refuses the addition without confirmation');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid)
    -> 'details' ->> 'capacity') || '/' || (public.book_athlete_as_coach(%L::uuid, %L::uuid)
    -> 'details' ->> 'confirmed_count')$$,
    pg_temp.s(), pg_temp.ath('Tomáš'), pg_temp.s(), pg_temp.ath('Tomáš'))),
  '2/2', 'and returns the numbers the warning has to show');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.s()),
  '2', 'a refused addition leaves the occupancy untouched');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select can_add::text from public.coach_session_candidates(%L::uuid) where first_name='Tomáš'$$, pg_temp.s())),
  'true', 'the picker still offers them: a full session is a warning, not a bar');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) -> 'data' ->> 'capacity_override')$$,
    pg_temp.s(), pg_temp.ath('Tomáš'))),
  'true', 'with the confirmation the booking succeeds and says it overrode');
select pg_temp.check(
  (select o.confirmed_count || '/' || s.capacity from public.training_session_occupancy o
     join public.training_sessions s on s.id = o.training_session_id where o.training_session_id = pg_temp.s()),
  '3/2', 'occupancy passes capacity, exactly as AC-050 requires');
select pg_temp.check(
  (select coach_capacity_override::text from public.bookings b
    where b.training_session_id = pg_temp.s() and b.athlete_id = pg_temp.ath('Tomáš')),
  'true', 'the override is recorded on the booking (BR-033)');
select pg_temp.check(
  (select coach_capacity_override::text from public.bookings b
    where b.training_session_id = pg_temp.s() and b.athlete_id = pg_temp.ath('Anna')),
  'false', 'and not on the addition that fitted');

\echo ''
\echo '── The override is auditable (AC-142, BR-034) ──────────────────────'
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='BOOKING_CREATED_BY_COACH'),
  '2', 'each coach addition produces one entry (AC-140)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='BOOKING_CAPACITY_OVERRIDDEN'),
  '1', 'the override produces its own entry, only for the booking that overrode');
select pg_temp.check(
  (select (after ->> 'capacity') || ':' || (after ->> 'confirmed_before') || '->' || (after ->> 'confirmed_after')
     from public.audit_log where action='BOOKING_CAPACITY_OVERRIDDEN'),
  '2:2->3', 'recording what was exceeded and by how much');
select pg_temp.check(
  (select actor_profile_id::text from public.audit_log where action='BOOKING_CAPACITY_OVERRIDDEN'),
  '00000000-0000-0000-0000-00000000c0ac', 'attributed to the coach who confirmed it');

\echo ''
\echo '── Coach removal, at any time (AC-042, BR-042) ─────────────────────'
-- A session starting inside the guardian cancellation window: the one case
-- where the two cancellation paths visibly differ.
insert into t_ids (k, v)
select 'soon', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (now() at time zone 'Europe/Prague' + interval '6 hours')::date,
  (now() at time zone 'Europe/Prague' + interval '6 hours')::time,
  (now() at time zone 'Europe/Prague' + interval '7 hours')::time, %L::uuid, 10, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.soon() returns uuid language sql stable as
  $$ select v from t_ids where k = 'soon' $$;

select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.soon(), pg_temp.ath('Ivan'))),
  '1', 'a guardian books into a session six hours away');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'code')$$,
    pg_temp.booking(pg_temp.soon(), pg_temp.ath('Ivan')))),
  'CANCELLATION_DEADLINE_PASSED', 'and can no longer withdraw (AC-041)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.cancel_booking_as_coach(%L::uuid) ->> 'code')$$,
    pg_temp.booking(pg_temp.soon(), pg_temp.ath('Ivan')))),
  'NOT_AUTHORIZED', 'and cannot reach for the coach path to get around it');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select (public.cancel_booking_as_coach('00000000-0000-0000-0000-00000000dead'::uuid) ->> 'code')$$),
  'BOOKING_NOT_FOUND', 'an unknown booking is reported as such');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid, 'Nemoc v týmu') ->> 'ok')$$,
    pg_temp.booking(pg_temp.soon(), pg_temp.ath('Ivan')))),
  'true', 'the coach removes the athlete regardless of the deadline (AC-042)');
select pg_temp.check(
  (select status::text || '|' || coalesce(cancellation_reason,'—') from public.bookings b
     where b.training_session_id = pg_temp.soon() and b.athlete_id = pg_temp.ath('Ivan')),
  'CANCELLED_BY_COACH|Nemoc v týmu', 'the removal is marked as the coach''s, with the reason');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.soon()),
  '0', 'the place is released (AC-043)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action='BOOKING_CANCELLED_BY_COACH'),
  '1', 'the removal is audited');
select pg_temp.check(
  (select metadata ->> 'reason' from public.audit_log where action='BOOKING_CANCELLED_BY_COACH'),
  'Nemoc v týmu', 'with the reason the coach gave');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid) ->> 'code')$$,
    (select id from public.bookings where training_session_id = pg_temp.soon() and athlete_id = pg_temp.ath('Ivan')))),
  'BOOKING_NOT_CONFIRMED', 'removing twice changes nothing');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select status::text || '|' || coalesce(cancellation_reason,'—')
    from public.session_roster(%L::uuid)$$, pg_temp.soon())),
  'CANCELLED_BY_COACH|Nemoc v týmu', 'and the row stays on the roster, not deleted (BR-044)');

\echo ''
\echo '── D-06: the removal is not a parent undo (AC-042a, AC-042b) ───────'
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.soon(), pg_temp.ath('Ivan'))),
  'REMOVED_BY_COACH', 'the guardian cannot book the athlete back in (AC-042a)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select can_book::text from public.guardian_session_athletes(%L::uuid) where first_name='Ivan'$$, pg_temp.soon())),
  'false', 'and their picker stops offering the athlete');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select can_add::text from public.coach_session_candidates(%L::uuid) where first_name='Ivan'$$, pg_temp.soon())),
  'true', 'the coach''s picker still offers them: the block is not theirs');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'ok')$$,
    pg_temp.soon(), pg_temp.ath('Ivan'))),
  'true', 'and the coach can put the athlete back (AC-042b)');
select pg_temp.check(
  (select confirmed_count::text from public.training_session_occupancy where training_session_id = pg_temp.soon()),
  '1', 'which restores the place');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.session_roster(%L::uuid)$$, pg_temp.soon())),
  '2', 'the roster keeps both the removal and the restoration');

\echo ''
\echo '── AC-042c: a guardian''s own cancellation is not a block ───────────'
insert into t_ids (k, v)
select 'free', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 40)::date, time '09:00', time '10:00', %L::uuid, 10, 'ALL')
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.free() returns uuid language sql stable as
  $$ select v from t_ids where k = 'free' $$;

select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.free(), pg_temp.ath('Anna'))),
  '1', 'a guardian books');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.cancel_booking_as_guardian(%L::uuid) ->> 'ok')$$,
    pg_temp.booking(pg_temp.free(), pg_temp.ath('Anna')))),
  'true', 'then cancels, well before the deadline');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) -> 'data' ->> 'booked_count')$$,
    pg_temp.free(), pg_temp.ath('Anna'))),
  '1', 'and may book the same athlete again (AC-042c)');

\echo ''
\echo '── A cancelled session takes nobody, coach included (D-07) ─────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_training_session(%L::uuid, 'Porucha chlazení') ->> 'ok')$$, pg_temp.free())),
  'true', 'the coach cancels the session');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) ->> 'code')$$,
    pg_temp.free(), pg_temp.ath('Ivan'))),
  'SESSION_CANCELLED', 'and cannot add to it afterwards, even with the override');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select string_agg(status::text, ',' order by status::text)
    from public.session_roster(%L::uuid)$$, pg_temp.free())),
  'CANCELLED_BY_USER,CONFIRMED', 'the roster at cancellation is still readable, withdrawals included (AC-070a)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select eligibility from public.coach_session_candidates(%L::uuid) limit 1$$, pg_temp.free())),
  'SESSION_CANCELLED', 'and the picker says the session itself is the reason');

\echo ''
\echo '── A closed session still accepts a coach addition (BR-030) ────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_session_booking_state(%L::uuid, false) ->> 'ok')$$, pg_temp.s())),
  'true', 'the coach closes booking');
select pg_temp.check(
  pg_temp.as_user(:B, format($$select (public.book_athletes_as_guardian(%L::uuid, array[%L::uuid]) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'SESSION_NOT_OPEN', 'guardians are held off (BR-030)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.cancel_booking_as_coach(%L::uuid) ->> 'ok')$$,
    pg_temp.booking(pg_temp.s(), pg_temp.ath('Anna')))),
  'true', 'but the coach can still remove');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'code')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'WOULD_EXCEED_CAPACITY', 'the removal did not give back the place the override had taken');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) ->> 'ok')$$,
    pg_temp.s(), pg_temp.ath('Anna'))),
  'true', 'and the coach can still add, which is what a closed session is for');

\echo ''
\echo '── Eligibility is the one rule a coach does not override (PRD §10) ─'
insert into t_ids (k, v)
select 'y17', (pg_temp.as_user(:COACH, format($$select (public.create_training_session(
  %L::uuid, (current_date + 50)::date, time '09:00', time '10:00', %L::uuid, 10,
  'BIRTH_YEAR_RANGE', 2017, 2017)
  -> 'data' ->> 'training_session_id')$$, pg_temp.ws(), pg_temp.fac())))::uuid;
create or replace function pg_temp.y17() returns uuid language sql stable as
  $$ select v from t_ids where k = 'y17' $$;

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) ->> 'code')$$,
    pg_temp.y17(), pg_temp.ath('Anna'))),
  'NOT_ELIGIBLE', 'an athlete outside the birth-year range is refused');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) -> 'details' ->> 'reason')$$,
    pg_temp.y17(), pg_temp.ath('Anna'))),
  'BIRTH_YEAR_OUT_OF_RANGE', 'with the reason the coach needs to act on');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select string_agg(first_name || '=' || eligibility, ',' order by first_name)
    from public.coach_session_candidates(%L::uuid)$$, pg_temp.y17())),
  'Anna=BIRTH_YEAR_OUT_OF_RANGE,Ivan=ELIGIBLE,Tomáš=BIRTH_YEAR_OUT_OF_RANGE',
  'and the picker shows the ineligible ones with their reason, unlike the guardian''s');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid) ->> 'ok')$$,
    pg_temp.y17(), pg_temp.ath('Ivan'))),
  'true', 'the eligible one is added');
update public.athletes set is_active = false where id = pg_temp.ath('Tomáš');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select eligibility || '/' || can_add::text
    from public.coach_session_candidates(%L::uuid) where first_name='Tomáš'$$, pg_temp.s())),
  'ATHLETE_INACTIVE/false', 'a deactivated athlete is shown with the reason, not silently dropped (D-09)');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.book_athlete_as_coach(%L::uuid, %L::uuid, true) -> 'details' ->> 'reason')$$,
    pg_temp.y17(), pg_temp.ath('Tomáš'))),
  'ATHLETE_INACTIVE', 'and cannot be added by hand either');
select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select count(*)::text from public.session_roster(%L::uuid) where first_name='Tomáš'$$, pg_temp.s())),
  '1', 'but their existing booking stays on the roster (D-09)');

drop function pg_temp.as_user(text,text);
drop function pg_temp.check(text,text,text);
