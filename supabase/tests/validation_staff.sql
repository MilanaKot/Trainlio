-- Trainlio — staff names, and the administrator who fills them in (D-11)
-- Run after the migrations and fixtures, on its own freshly created database.
--
-- D-11 says the coach is the product. Until migration 21 the schema could not
-- honour that: the only name column was writable by its owner alone, so a coach
-- who never opened Účet was permanently "—" to every parent, and no
-- administrator could fix it. These cases cover the two halves of the fix — the
-- name being structured and derived, and who may write whose.
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

\set COACH  '''00000000-0000-0000-0000-00000000c0ac'''
\set COACH2 '''00000000-0000-0000-0000-00000000c0ad'''
\set ADMIN  '''00000000-0000-0000-0000-00000000ad11'''
\set A      '''00000000-0000-0000-0000-0000000fa000'''
\set STRANGER '''00000000-0000-0000-0000-0000005f4a46'''

create or replace function pg_temp.ws() returns uuid language sql stable as
  $$ select id from public.workspaces limit 1 $$;
create or replace function pg_temp.name_of(p_profile uuid) returns text language sql stable as
  $$ select coalesce(display_name, '(null)') from public.app_profiles where id = p_profile $$;

\echo ''
\echo '── display_name is derived, not stored by hand (AC-244) ─────────────'
select pg_temp.check(pg_temp.name_of(:COACH), 'Trenér Novák',
  'the fixtures set two columns and the third is composed (AC-244)');
select pg_temp.check(
  (select first_name || '/' || coalesce(last_name, '(null)') from public.app_profiles where id = :STRANGER),
  'Cizinec/(null)', 'a one-word name is a given name, and composes to itself (AC-244)');
select pg_temp.check(pg_temp.name_of(:STRANGER), 'Cizinec',
  'no trailing space when there is no surname (AC-244)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$update public.app_profiles set display_name='Ředitel'
    where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'no client role may write display_name at all (AC-244)');
select pg_temp.check(
  (select count(*)::text from information_schema.column_privileges
    where table_schema='public' and table_name='app_profiles'
      and column_name='display_name' and privilege_type='UPDATE'
      and grantee in ('authenticated','anon')),
  '0', 'and no grant would let one — SELECT stays, UPDATE is gone (AC-244)');

\echo ''
\echo '── Whitespace is not a name (AC-243, AC-246) ───────────────────────'
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set first_name='  Jana  ', last_name='  Kotová '
    where id=public.current_profile_id() returning display_name$$),
  'Jana Kotová', 'the parts are trimmed before they are composed (AC-246)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set first_name='   ', last_name=null
    where id=public.current_profile_id() returning coalesce(display_name,'(null)')$$),
  '(null)', 'a blank given name is no name, not a blank one (AC-246)');
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set first_name=null, last_name='Kotová'
    where id=public.current_profile_id() returning '1'$$),
  'DENIED', 'a surname with no given name is refused (AC-246)');

\echo ''
\echo '── Only an administrator of this workspace may name staff (AC-241) ──'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'NOT_AUTHORIZED', 'a coach is not an administrator (AC-241)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'NOT_AUTHORIZED', 'a guardian cannot rename the coach (AC-241)');
select pg_temp.check(
  pg_temp.as_user(:STRANGER, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'NOT_AUTHORIZED', 'nor can someone with no relationship to the workspace (AC-241)');
select pg_temp.check(pg_temp.name_of(:COACH), 'Trenér Novák',
  'and none of those attempts changed anything (AC-241)');

\echo ''
\echo '── Staff of this workspace, and nobody else (AC-242) ────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-0000000fa000'::uuid, 'Jana', 'Kotová') ->> 'code'$$),
  'MEMBER_NOT_FOUND', 'a guardian is not staff: their name is theirs to give (AC-242)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(
    '00000000-0000-0000-0000-00000000dead'::uuid,
    '00000000-0000-0000-0000-00000000c0ac'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'NOT_AUTHORIZED', 'an administrator of one workspace administers only that one (AC-242)');
-- A coach who has left is still on last season's rosters, so a misspelling
-- there is as worth fixing as anywhere else.
update public.workspace_members set is_active = false
 where profile_id = :COACH2 and workspace_id = pg_temp.ws();
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, 'Pavel', 'Dvořák') ->> 'display_name'$$),
  'Pavel Dvořák', 'a former member can still be corrected (AC-242)');
update public.workspace_members set is_active = true
 where profile_id = :COACH2 and workspace_id = pg_temp.ws();

\echo ''
\echo '── Both halves are required of a coach (AC-243) ─────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, 'Pavel', null) ->> 'code'$$),
  'NAME_REQUIRED', 'a coach without a surname is not how a parent asks for them (AC-243)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, '   ', 'Dvořák') ->> 'code'$$),
  'NAME_REQUIRED', 'and a blank given name is not a given name (AC-243)');
select pg_temp.check(pg_temp.name_of(:COACH), 'Trenér Novák',
  'a refused call writes nothing (AC-243)');

\echo ''
\echo '── The administrator names the coach (AC-240) ───────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ac'::uuid, ' Pavel ', 'Zeman') ->> 'display_name'$$),
  'Pavel Zeman', 'the call returns the composed name (AC-240)');
select pg_temp.check(
  (select first_name || '/' || last_name from public.app_profiles where id = :COACH),
  'Pavel/Zeman', 'stored as two trimmed columns (AC-240)');
-- The point of the whole migration: what a parent now reads on the session page.
select pg_temp.check(
  pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s
    join public.app_profiles p on p.id = s.main_coach_profile_id
   where s.id='00000000-0000-0000-0000-0000000e0001'$$),
  'Pavel Zeman', 'and a guardian reads it as the session main coach (AC-240, D-11)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000ad11'::uuid, 'Milan', 'Kotov') ->> 'ok'$$),
  'true', 'an administrator may also name themselves (AC-240)');

\echo ''
\echo '── The change is audited (AC-245) ──────────────────────────────────'
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'MEMBER_NAME_CHANGED'),
  '3', 'one entry per successful call, and none for the refusals (AC-245)');
select pg_temp.check(
  (select (before ->> 'last_name') || ' → ' || (after ->> 'last_name')
     from public.audit_log
    where action = 'MEMBER_NAME_CHANGED' and entity_id = :COACH),
  'Novák → Zeman', 'recording what it was and what it became (AC-245)');
select pg_temp.check(
  (select (actor_profile_id = :ADMIN)::text from public.audit_log
    where action = 'MEMBER_NAME_CHANGED' and entity_id = :COACH),
  'true', 'and who did it — the point of auditing a change to someone else (AC-245)');
select pg_temp.check(
  (select entity_type from public.audit_log
    where action = 'MEMBER_NAME_CHANGED' and entity_id = :COACH),
  'PROFILE', 'against the profile, not the workspace or a session (AC-245)');
-- Renaming yourself is not a club event, so nothing records it.
select pg_temp.check(
  pg_temp.as_user(:A, $$update public.app_profiles set first_name='Jana', last_name='Kotová'
    where id=public.current_profile_id() returning display_name$$),
  'Jana Kotová', 'a person setting their own name needs no audit entry (AC-246)');
select pg_temp.check(
  (select count(*)::text from public.audit_log where action = 'MEMBER_NAME_CHANGED'),
  '3', 'and does not get one (AC-246)');

\echo ''
\echo '── The roster the screen reads (AC-240, AC-241) ─────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select count(*)::text from public.workspace_staff(pg_temp.ws())$$),
  '3', 'an administrator sees the workspace staff (AC-240)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select bool_and(is_editable)::text
    from public.workspace_staff(pg_temp.ws())$$),
  'true', 'and every row is theirs to edit (AC-240)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select bool_or(is_editable)::text
    from public.workspace_staff(pg_temp.ws())$$),
  'false', 'a coach sees the same list and may edit none of it (AC-241)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.workspace_staff(pg_temp.ws())$$),
  '0', 'a guardian gets no staff list from it (AC-241)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select array_to_string(roles, ',') from public.workspace_staff(pg_temp.ws())
    where profile_id = '00000000-0000-0000-0000-00000000ad11'$$),
  'WORKSPACE_ADMIN', 'the roles a member holds come back with them (AC-240)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select has_login::text from public.workspace_staff(pg_temp.ws())
    where profile_id = '00000000-0000-0000-0000-00000000c0ac'$$),
  'true', 'as does whether they have ever signed in (AC-240)');

\echo ''
\echo '── An erased profile is not renamed (AC-247) ────────────────────────'
select public.anonymize_profile(:COACH2, 'test');
select pg_temp.check(
  (select coalesce(first_name,'(null)') || '/' || coalesce(last_name,'(null)')
     from public.app_profiles where id = :COACH2),
  '(null)/(null)', 'the stamp clears both name columns, not only the composed one (AC-247)');
select pg_temp.check(pg_temp.name_of(:COACH2), '(null)',
  'so the composed name goes with them (AC-247)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'MEMBER_NOT_FOUND', 'and no administrator can give it back (AC-247)');
-- Belt and braces: the guard must hold even if the membership were still active,
-- because the D-18 stamp is the durable fact and the deactivation is a side
-- effect of one function.
update public.workspace_members set is_active = true where profile_id = :COACH2;
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000c0ad'::uuid, 'Pavel', 'Dvořák') ->> 'code'$$),
  'MEMBER_NOT_FOUND', 'the stamp alone is enough to refuse (AC-247)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select count(*)::text from public.workspace_staff(pg_temp.ws())
    where profile_id = '00000000-0000-0000-0000-00000000c0ad' and is_editable$$),
  '0', 'and the screen is told not to offer it (AC-247)');

\echo ''
\echo '── A coach exists before a login does (AC-248) ──────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.create_workspace_coach(pg_temp.ws(),
    'Petr', 'Málek') ->> 'code'$$),
  'NOT_AUTHORIZED', 'a coach cannot add a colleague (AC-248)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.create_workspace_coach(pg_temp.ws(),
    'Petr', '  ') ->> 'code'$$),
  'NAME_REQUIRED', 'and an administrator cannot add half a name (AC-248)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.create_workspace_coach(pg_temp.ws(),
    ' Petr ', 'Málek') ->> 'display_name'$$),
  'Petr Málek', 'an administrator adds a coach who has never signed in (AC-248)');
-- SECURITY DEFINER on purpose. Once this coach is deactivated below, an
-- authenticated caller cannot see their profile row at all — is_visible_staff_
-- profile() covers active staff — so a plain lookup would quietly return null
-- and every later case would read as "member not found". That invisibility is
-- correct, and it is also why the screen reads the staff list through
-- workspace_staff() rather than from the table.
create or replace function pg_temp.malek() returns uuid
language sql stable security definer as
  $$ select id from public.app_profiles where display_name = 'Petr Málek' $$;
select pg_temp.check(
  (select (auth_user_id is null)::text from public.app_profiles where id = pg_temp.malek()),
  'true', 'the profile carries no login (AC-248)');
select pg_temp.check(
  (select role::text from public.workspace_members
    where profile_id = pg_temp.malek() and workspace_id = pg_temp.ws()),
  'COACH', 'and is active staff of the workspace from the start (AC-248)');
-- The point of adding them: they can lead a training immediately. Written
-- through training_session_coaches, which is the canonical direction, so what
-- is under test is the invariant that could have refused it —
-- enforce_session_coach_is_staff asks for active membership of the workspace
-- and says nothing about a login.
update public.training_session_coaches
   set profile_id = pg_temp.malek()
 where training_session_id = '00000000-0000-0000-0000-0000000e0001' and role = 'MAIN';
select pg_temp.check(
  (select (main_coach_profile_id = pg_temp.malek())::text from public.training_sessions
    where id = '00000000-0000-0000-0000-0000000e0001'),
  'true', 'a coach with no login can lead a session, and the mirror follows (AC-248)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s
    join public.app_profiles p on p.id = s.main_coach_profile_id
   where s.id='00000000-0000-0000-0000-0000000e0001'$$),
  'Petr Málek', 'and a guardian reads their name like any other (AC-248, D-11)');
select pg_temp.check(
  (select (after ->> 'role') from public.audit_log
    where action = 'MEMBER_ADDED' and entity_id = pg_temp.malek()),
  'COACH', 'the addition is audited (AC-248)');

\echo ''
\echo '── A coach leaves, and is never deleted (AC-249) ────────────────────'
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), false) ->> 'code'$$),
  'NOT_AUTHORIZED', 'a coach cannot deactivate a colleague (AC-249)');
-- They lead a session, so the first attempt comes back with the count rather
-- than silently leaving an uneditable training behind (AC-251).
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), false) ->> 'code'$$),
  'LEADS_FUTURE_SESSIONS', 'a coach with future trainings is not quietly removed (AC-251)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), false) -> 'details' ->> 'future_sessions'$$),
  '1', 'and the warning quotes the server''s own count (AC-251)');
select pg_temp.check(
  (select is_active::text from public.workspace_members where profile_id = pg_temp.malek()),
  'true', 'nothing changed while the warning stood (AC-251)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), false, true) ->> 'ok'$$),
  'true', 'the confirmed call goes through (AC-251)');
select pg_temp.check(
  (select count(*)::text from public.app_profiles where id = pg_temp.malek()),
  '1', 'the profile is kept, because last season happened (AC-249)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'MEMBER_DEACTIVATED' and entity_id = pg_temp.malek()),
  '1', 'and the departure is audited (AC-249)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), true) ->> 'ok'$$),
  'true', 'they can come back (AC-249)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select (public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), true) ->> 'unchanged')$$),
  'true', 'and a second activation is a no-op, not a second audit entry (AC-249)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
    where action = 'MEMBER_ACTIVATED' and entity_id = pg_temp.malek()),
  '1', 'which the log shows (AC-249)');

\echo ''
\echo '── The workspace keeps an administrator (AC-250) ────────────────────'
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000ad11'::uuid, false) ->> 'code'$$),
  'LAST_ADMIN', 'the only administrator cannot remove themselves (AC-250)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.create_workspace_coach(pg_temp.ws(),
    'Druhá', 'Správkyně', 'WORKSPACE_ADMIN') ->> 'ok'$$),
  'true', 'a second administrator can be added (AC-250)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    '00000000-0000-0000-0000-00000000ad11'::uuid, false) ->> 'ok'$$),
  'true', 'and then the first may step down (AC-250)');

\echo ''
\echo '── What the screen is told (AC-240, AC-249) ─────────────────────────'
-- The administrator just deactivated themselves, so read the list as the coach.
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select count(*)::text from public.workspace_staff(pg_temp.ws())$$),
  '5', 'inactive members stay on the list, or nobody could bring them back (AC-249)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select is_active::text from public.workspace_staff(pg_temp.ws())
    where profile_id = '00000000-0000-0000-0000-00000000ad11'$$),
  'false', 'with their state on the row (AC-249)');
select pg_temp.check(
  pg_temp.as_user(:COACH, $$select future_sessions::text from public.workspace_staff(pg_temp.ws())
    where display_name = 'Petr Málek'$$),
  '1', 'and the count that makes the warning predictable (AC-251)');

\echo ''
\echo '── A coach who leaves keeps their name on their trainings (AC-257) ──'
-- By now the fixture session is led by Petr Málek, the coach added above who
-- has never signed in. That makes the case stronger rather than weaker: his
-- profile has no login at all, and a parent must still read his name.
select pg_temp.check(
  pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s
    join public.app_profiles p on p.id = s.main_coach_profile_id
   where s.id='00000000-0000-0000-0000-0000000e0001'$$),
  'Petr Málek', 'a guardian reads the name while the coach is active (AC-257, D-11)');

-- The section above left the fixture administrator stepped down, and the second
-- administrator it created has no login to act as. Restore the first, so this
-- section has a working one — and assert every administrative call, because a
-- refused one would let the cases below pass without proving anything.
update public.workspace_members set is_active = true where profile_id = :ADMIN;

select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_active(pg_temp.ws(),
    pg_temp.malek(), false, true) ->> 'ok'$$),
  'true', 'the administrator deactivates the coach who leads the session (AC-257)');

-- The defect this migration exists for: an administrative act that has nothing
-- to do with the parent used to blank the name on every training the coach led.
select pg_temp.check(
  pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s
    join public.app_profiles p on p.id = s.main_coach_profile_id
   where s.id='00000000-0000-0000-0000-0000000e0001'$$),
  'Petr Málek', 'and still reads it after the coach is deactivated (AC-257)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.is_visible_staff_profile(pg_temp.malek())::text$$),
  'true', 'because they are named on a training the guardian can see (AC-257)');

-- Renaming a departed coach still reaches the guardian (admin/SPEC.md test 3).
select pg_temp.check(
  pg_temp.as_user(:ADMIN, $$select public.set_member_name(pg_temp.ws(),
    pg_temp.malek(), 'Petr', 'Novotný') ->> 'display_name'$$),
  'Petr Novotný', 'the administrator corrects the departed coach name (AC-257)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select p.display_name from public.training_sessions s
    join public.app_profiles p on p.id = s.main_coach_profile_id
   where s.id='00000000-0000-0000-0000-0000000e0001'$$),
  'Petr Novotný', 'and a correction to their name still reaches the parent (AC-257)');

-- The widening is the narrow one: being former staff is not by itself enough.
select pg_temp.as_user(:ADMIN, $$select public.create_workspace_coach(pg_temp.ws(),
  'Nikdy', 'Nevedl')$$);
create or replace function pg_temp.never() returns uuid language sql stable security definer as
  $$ select id from public.app_profiles where display_name = 'Nikdy Nevedl' $$;
update public.workspace_members set is_active = false where profile_id = pg_temp.never();
select pg_temp.check(
  pg_temp.as_user(:A, $$select public.is_visible_staff_profile(pg_temp.never())::text$$),
  'false', 'a former coach who never led anything stays invisible (AC-257)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.app_profiles
    where id = pg_temp.never()$$),
  '0', 'and their profile is not readable at all (AC-257)');

-- Nothing else about the departed coach opened up.
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.workspace_members
    where profile_id = '00000000-0000-0000-0000-00000000c0ac'$$),
  '0', 'the guardian still reads no membership row (AC-257, D-17)');
select pg_temp.check(
  pg_temp.as_user(:A, $$select count(*)::text from public.app_profiles
    where id = '00000000-0000-0000-0000-0000000fb000'$$),
  '0', 'and no other family became visible along the way (AC-257, AC-091)');

update public.workspace_members set is_active = true
 where profile_id = :COACH and workspace_id = pg_temp.ws();

\echo ''
\echo '── The club mark (AC-277) ──────────────────────────────────────────'
-- Not in the design handoff; added on request and recorded in
-- docs/DESIGN_DEVIATIONS.md.
select pg_temp.check(
  (select (logo_path is null)::text from public.workspaces where id = pg_temp.ws()),
  'true', 'a club starts with no mark (AC-277)');

select pg_temp.check(
  pg_temp.as_user(:COACH, format($$select (public.set_workspace_logo(%L::uuid,
    'logos/%s/a.png') ->> 'code')$$, pg_temp.ws(), pg_temp.ws())),
  'NOT_AUTHORIZED', 'a coach cannot change it (AC-277, D-17)');
select pg_temp.check(
  pg_temp.as_user(:A, format($$select (public.set_workspace_logo(%L::uuid,
    'logos/%s/a.png') ->> 'code')$$, pg_temp.ws(), pg_temp.ws())),
  'NOT_AUTHORIZED', 'nor can a parent (AC-277)');
select pg_temp.check(
  (select (logo_path is null)::text from public.workspaces where id = pg_temp.ws()),
  'true', 'and neither refusal changed anything (AC-277)');

select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.set_workspace_logo(%L::uuid,
    'logos/%s/mark.png') ->> 'ok')$$, pg_temp.ws(), pg_temp.ws())),
  'true', 'an administrator can (AC-277)');
select pg_temp.check(
  (select logo_path from public.workspaces where id = pg_temp.ws()),
  format('logos/%s/mark.png', pg_temp.ws()), 'and the path is stored (AC-277)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
   where action = 'WORKSPACE_LOGO_CHANGED' and entity_id = pg_temp.ws()),
  '1', 'the change is audited (AC-277)');

-- The path names the folder the storage policy reads as the workspace, so a
-- path naming another one would be a mark this club could write into another
-- club's folder.
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.set_workspace_logo(%L::uuid,
    'logos/00000000-0000-0000-0000-000000000001/x.png') ->> 'code')$$, pg_temp.ws())),
  'INVALID_LOGO_PATH', 'a path naming another workspace is refused (AC-277)');
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.set_workspace_logo(%L::uuid,
    'x.png') ->> 'code')$$, pg_temp.ws())),
  'INVALID_LOGO_PATH', 'and so is one with no folder at all (AC-277)');

-- Setting the same mark twice writes no second entry, so the log stays a log
-- of changes.
select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.set_workspace_logo(%L::uuid,
    'logos/%s/mark.png') -> 'data' ->> 'unchanged')$$, pg_temp.ws(), pg_temp.ws())),
  'true', 'setting the same mark again changes nothing (AC-277)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
   where action = 'WORKSPACE_LOGO_CHANGED' and entity_id = pg_temp.ws()),
  '1', 'and writes no second audit entry (AC-277)');

select pg_temp.check(
  pg_temp.as_user(:ADMIN, format($$select (public.set_workspace_logo(%L::uuid) ->> 'ok')$$,
    pg_temp.ws())),
  'true', 'calling it without a path clears the mark (AC-277)');
select pg_temp.check(
  (select (logo_path is null)::text from public.workspaces where id = pg_temp.ws()),
  'true', 'and the club has none again (AC-277)');
select pg_temp.check(
  (select count(*)::text from public.audit_log
   where action = 'WORKSPACE_LOGO_CHANGED' and entity_id = pg_temp.ws()),
  '2', 'which is itself a change worth recording (AC-277)');

-- The bucket is public on purpose: the mark travels in e-mails, and a mail
-- client can follow neither a signed URL nor a private bucket. The athlete
-- bucket is the opposite and must stay that way (BR-093, AC-092).
select pg_temp.check(
  (select public::text from storage.buckets where id = 'workspace-logos'),
  'true', 'the logo bucket is public (AC-277)');
select pg_temp.check(
  (select public::text from storage.buckets where id = 'athlete-photos'),
  'false', 'and the athlete bucket is still not (AC-277, AC-092)');
