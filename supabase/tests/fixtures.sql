insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000c0ac','coach@example.test'),
 ('00000000-0000-0000-0000-00000000c0ad','coach2@example.test'),
 ('00000000-0000-0000-0000-0000000fa000','familyA@example.test'),
 ('00000000-0000-0000-0000-0000000fb000','familyB@example.test'),
 ('00000000-0000-0000-0000-0000005f4a46','stranger@example.test'),
 ('00000000-0000-0000-0000-00000000ad11','wsadmin@example.test'),
 ('00000000-0000-0000-0000-00000000a170','platformadmin@example.test');
insert into public.app_profiles(id,auth_user_id,display_name) values
 ('00000000-0000-0000-0000-00000000c0ac','00000000-0000-0000-0000-00000000c0ac','Trenér Novák'),
 ('00000000-0000-0000-0000-00000000c0ad','00000000-0000-0000-0000-00000000c0ad','Trenér Dvořák'),
 ('00000000-0000-0000-0000-0000000fa000','00000000-0000-0000-0000-0000000fa000','Rodina A'),
 ('00000000-0000-0000-0000-0000000fb000','00000000-0000-0000-0000-0000000fb000','Rodina B'),
 ('00000000-0000-0000-0000-0000005f4a46','00000000-0000-0000-0000-0000005f4a46','Cizinec'),
 ('00000000-0000-0000-0000-00000000ad11','00000000-0000-0000-0000-00000000ad11','Workspace Admin'),
 ('00000000-0000-0000-0000-00000000a170','00000000-0000-0000-0000-00000000a170','Platform Admin');
insert into public.platform_admins(profile_id) values ('00000000-0000-0000-0000-00000000a170');
insert into public.workspace_members(workspace_id,profile_id,role)
 select w.id, v.p, v.r::public.workspace_role from public.workspaces w,
 (values ('00000000-0000-0000-0000-00000000c0ac'::uuid,'COACH'),
         ('00000000-0000-0000-0000-00000000c0ad'::uuid,'COACH'),
         ('00000000-0000-0000-0000-00000000ad11'::uuid,'WORKSPACE_ADMIN')) v(p,r);
insert into public.athletes(id,first_name,last_name,date_of_birth) values
 ('00000000-0000-0000-0000-0000000a0001','Ivan','Kotov','2017-10-23'),
 ('00000000-0000-0000-0000-0000000a0002','Anna','Kotova','2018-03-04'),
 ('00000000-0000-0000-0000-0000000a0003','Tomáš','Svoboda','2016-05-11');
insert into public.guardian_athlete_access(profile_id,athlete_id) values
 ('00000000-0000-0000-0000-0000000fa000','00000000-0000-0000-0000-0000000a0001'),
 ('00000000-0000-0000-0000-0000000fb000','00000000-0000-0000-0000-0000000a0002'),
 ('00000000-0000-0000-0000-0000000fa000','00000000-0000-0000-0000-0000000a0003');
insert into public.athlete_sport_profiles(id,athlete_id,sport_id,attributes)
 select v.pid, v.aid, s.id, '{"position":"CENTER","stick_side":"LEFT"}'::jsonb
 from public.sports s, (values
   ('00000000-0000-0000-0000-0000000b0001'::uuid,'00000000-0000-0000-0000-0000000a0001'::uuid),
   ('00000000-0000-0000-0000-0000000b0002'::uuid,'00000000-0000-0000-0000-0000000a0002'::uuid),
   ('00000000-0000-0000-0000-0000000b0003'::uuid,'00000000-0000-0000-0000-0000000a0003'::uuid)) v(pid,aid)
 where s.code='HOCKEY';
insert into public.workspace_athlete_memberships(workspace_id,athlete_id,athlete_sport_profile_id,sport_id)
 select w.id, asp.athlete_id, asp.id, asp.sport_id from public.workspaces w, public.athlete_sport_profiles asp;
insert into public.training_sessions(id,workspace_id,sport_id,location_id,facility_id,main_coach_profile_id,
  start_at,end_at,capacity,status,created_by,eligibility_mode,birth_year_from,birth_year_to,changing_room,public_notes)
 select '00000000-0000-0000-0000-0000000e0001', w.id, w.primary_sport_id, l.id, f.id,
   '00000000-0000-0000-0000-00000000c0ac', now()+interval '30 days', now()+interval '30 days 1 hour',
   3,'OPEN','00000000-0000-0000-0000-00000000c0ac','BIRTH_YEAR_RANGE',2016,2018,'Šatna 4','Vezměte si chrániče.'
 from public.workspaces w join public.locations l on l.workspace_id=w.id
   join public.facilities f on f.location_id=l.id and f.code='MH';
insert into public.training_session_coaches(training_session_id,profile_id,role)
 values ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-00000000c0ac','MAIN');
insert into public.training_session_internal_notes(training_session_id,notes)
 values ('00000000-0000-0000-0000-0000000e0001','Interní: rodič dluží platbu.');
insert into public.bookings(training_session_id,athlete_id,created_by,created_by_role) values
 ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000fa000','USER'),
 ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000a0003','00000000-0000-0000-0000-0000000fa000','USER');
