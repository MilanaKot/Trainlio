-- ---------------------------------------------------------------------------
-- Attendance, the payment undo, and a training without a main coach
-- (handoff v3.4, decisions 38–46; coach/SPEC.md K2, K13, K2e; admin A3f;
-- guardian G8b).
--
-- Attendance (decision 40) is two states, `Byl` and `Nebyl`, recorded per
-- booking from the moment the training starts and editable at any time after.
-- A booking nobody marked stays null; it is *shown* as `Nebyl` once the
-- training is over, which is a reading rule, not a stored value — the
-- percentage code does that, not a job that writes `ABSENT` at the end.
--
-- It lives on `bookings`, next to the paid flag, because a guardian reads it
-- too (G8b). Payment and attendance never touch each other (decision 41).
--
-- Who may write: `canEdit(session)` (decision 33), through the functions below
-- only, exactly as for payment (migration 43).
-- ---------------------------------------------------------------------------

create type public.attendance_status as enum ('PRESENT', 'ABSENT');

alter table public.bookings
  add column attendance    public.attendance_status,
  add column attendance_at timestamptz,
  add column attendance_by uuid references public.app_profiles(id) on delete restrict,
  add constraint bookings_attendance_consistent
    check ((attendance is null) = (attendance_at is null)
       and (attendance is null) = (attendance_by is null));

comment on column public.bookings.attendance is
  'Decision 40: Byl / Nebyl, marked by a coach from the session start. Null is unmarked, read as ABSENT once the session has ended. Guardian-visible (G8b).';

-- ---------------------------------------------------------------------------
-- A training whose main coach was deactivated (A3f, K2e, decision 46).
--
-- The column was required because every training had somebody leading it.
-- Deactivating that somebody now leaves their future trainings without one
-- until an administrator assigns a new coach; the two columns below say who it
-- was and when, for the K2e notice (`{coach} byl deaktivován {d. m.}`).
-- ---------------------------------------------------------------------------

alter table public.training_sessions
  alter column main_coach_profile_id drop not null,
  add column main_coach_vacated_from uuid references public.app_profiles(id) on delete restrict,
  add column main_coach_vacated_at   timestamptz,
  add constraint training_sessions_vacated_consistent
    check ((main_coach_vacated_from is null) = (main_coach_vacated_at is null)
       and (main_coach_vacated_from is null or main_coach_profile_id is null));

comment on column public.training_sessions.main_coach_profile_id is
  'Mirror of the MAIN row in training_session_coaches. Null only when the main coach was deactivated (A3f) and nobody has been assigned yet.';

-- An empty main coach is not a coach from another club.
create or replace function public.enforce_session_main_coach_is_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.main_coach_profile_id is not null then
    perform public.assert_profile_is_workspace_staff(new.workspace_id, new.main_coach_profile_id);
  end if;
  return new;
end;
$$;

-- Restated from migration 42. With no main coach the comparison is null, and
-- `not null` is null: every caller's `if not can_edit_session(...)` would let
-- anybody through. Nobody leads such a training, so only those who may edit
-- every training may edit it (K2e).
create or replace function public.can_edit_session(p_workspace_id uuid, p_main_coach_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_edit_all_trainings(p_workspace_id)
      or (public.is_workspace_coach(p_workspace_id)
          and p_main_coach_profile_id is not null
          and p_main_coach_profile_id = public.current_profile_id());
$$;

-- ---------------------------------------------------------------------------
-- Audit vocabulary.
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
    'BOOKING_PAYMENT_MARKED', 'BOOKING_NOTE_CHANGED', 'BOOKING_MESSAGE_SENT',
    -- Migration 44 (v3.4).
    'BOOKING_ATTENDANCE_MARKED',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    'MEMBER_ROLE_CHANGED',
    'MEMBER_PERMISSION_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED'
  )
);

-- ---------------------------------------------------------------------------
-- K2 / K13 · the attendance toggle. `unmarked → Byl → Nebyl → Byl`: the
-- interface never goes back to unmarked, so neither does this.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_attendance(
  p_booking_id uuid,
  p_attendance public.attendance_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_target record;
  v_start  timestamptz;
  v_was    public.attendance_status;
begin
  select * into v_target from public.booking_edit_target(p_booking_id);
  if v_target.o_code is not null then
    return jsonb_build_object('ok', false, 'code', v_target.o_code);
  end if;

  if p_attendance is null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;

  select s.start_at into v_start
    from public.training_sessions s where s.id = v_target.o_session_id;

  -- Decision 40: nobody has come to a training that has not begun.
  if v_start > now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_STARTED');
  end if;

  select b.attendance into v_was
    from public.bookings b where b.id = p_booking_id
     for update;

  if v_was is not distinct from p_attendance then
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('attendance', p_attendance));
  end if;

  update public.bookings b
     set attendance = p_attendance, attendance_at = now(), attendance_by = v_actor
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_target.o_workspace, v_actor, 'BOOKING_ATTENDANCE_MARKED', 'BOOKING', p_booking_id,
     jsonb_build_object('attendance', v_was), jsonb_build_object('attendance', p_attendance));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('attendance', p_attendance));
end;
$$;

revoke all on function public.set_booking_attendance(uuid, public.attendance_status) from public;
grant execute on function public.set_booking_attendance(uuid, public.attendance_status) to authenticated;

-- ---------------------------------------------------------------------------
-- K2 · `Ostatní byli`. The unmarked confirmed bookings only — somebody marked
-- `Nebyl` stays so — and no confirmation (decision 42).
-- ---------------------------------------------------------------------------
create or replace function public.mark_session_present(p_training_session_id uuid)
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

  select s.id, s.workspace_id, s.status, s.main_coach_profile_id, s.start_at
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

  if v_session.start_at > v_now then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_STARTED');
  end if;

  with marked as (
    update public.bookings b
       set attendance = 'PRESENT', attendance_at = v_now, attendance_by = v_actor
     where b.training_session_id = p_training_session_id
       and b.status = 'CONFIRMED'
       and b.attendance is null
    returning b.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from marked;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  select v_session.workspace_id, v_actor, 'BOOKING_ATTENDANCE_MARKED', 'BOOKING', id,
         jsonb_build_object('attendance', null),
         jsonb_build_object('attendance', 'PRESENT', 'all', true)
    from unnest(v_ids) as id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'marked', cardinality(v_ids)));
end;
$$;

revoke all on function public.mark_session_present(uuid) from public;
grant execute on function public.mark_session_present(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Restated from migration 43: the audit of an unmarking now keeps who marked
-- it and when, which is what `Vrátit` puts back (below).
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
     jsonb_strip_nulls(jsonb_build_object('paid', not p_paid, 'paid_at', v_was, 'paid_by', v_by)),
     jsonb_build_object('paid', p_paid));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'paid_at', case when p_paid then now() end,
    'paid_by', case when p_paid then v_actor end));
end;
$$;

-- ---------------------------------------------------------------------------
-- `Vrátit` on the `Platba zrušena` toast (DS §6.16, decision 39). Puts back
-- the who and when the caller's own unmarking took away, read from the audit
-- rather than from the client: a coach must not be able to name somebody else
-- as having taken a payment. Only the caller's latest unmarking of this
-- booking counts, only for a minute (the toast lasts four seconds), and only
-- while the booking is still unpaid.
-- ---------------------------------------------------------------------------
create or replace function public.undo_booking_unpaid(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_target record;
  v_paid   timestamptz;
  v_entry  record;
begin
  select * into v_target from public.booking_edit_target(p_booking_id);
  if v_target.o_code is not null then
    return jsonb_build_object('ok', false, 'code', v_target.o_code);
  end if;

  select b.paid_at into v_paid
    from public.bookings b where b.id = p_booking_id
     for update;

  select a.before, a.after, a.created_at, a.actor_profile_id into v_entry
    from public.audit_log a
   where a.entity_type = 'BOOKING'
     and a.entity_id = p_booking_id
     and a.action = 'BOOKING_PAYMENT_MARKED'
   order by a.created_at desc, a.id desc
   limit 1;

  if v_paid is not null
     or v_entry.after is null
     or (v_entry.after ->> 'paid')::boolean
     or v_entry.before ->> 'paid_at' is null
     or v_entry.created_at < now() - interval '1 minute'
     or v_entry.actor_profile_id is distinct from v_actor then
    return jsonb_build_object('ok', false, 'code', 'UNDO_EXPIRED');
  end if;

  update public.bookings b
     set paid_at = (v_entry.before ->> 'paid_at')::timestamptz,
         paid_by = (v_entry.before ->> 'paid_by')::uuid
   where b.id = p_booking_id;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (v_target.o_workspace, v_actor, 'BOOKING_PAYMENT_MARKED', 'BOOKING', p_booking_id,
     jsonb_build_object('paid', false),
     jsonb_build_object('paid', true, 'undo', true));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'paid_at', v_entry.before ->> 'paid_at',
    'paid_by', v_entry.before ->> 'paid_by'));
end;
$$;

revoke all on function public.undo_booking_unpaid(uuid) from public;
grant execute on function public.undo_booking_unpaid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The roster, restated from migration 43 with attendance.
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
  attendance_by_name text
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
    marker.display_name
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  join public.athletes a on a.id = b.athlete_id
  left join public.app_profiles booker on booker.id = b.created_by
  left join public.app_profiles payer on payer.id = b.paid_by
  left join public.app_profiles sender on sender.id = b.parent_message_sent_by
  left join public.app_profiles marker on marker.id = b.attendance_by
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
-- A3f · deactivating a coach who leads future trainings (decision 46).
--
-- Replaces the D-25 handover of migration 39: the administrator is warned
-- (`LEADS_FUTURE_SESSIONS`, now with the trainings listed for the sheet) and,
-- on confirming, those trainings are left without a main coach until somebody
-- is assigned (K2e). The coach also leaves the trainings they assist on.
-- Trainings that have started keep them: they are a record of who was there.
--
-- Nobody is e-mailed now. The e-mail (E05) goes when a new main coach is
-- assigned, through update_training_session.
-- ---------------------------------------------------------------------------

drop function public.set_member_active(uuid, uuid, boolean, boolean, boolean);

create function public.set_member_active(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_is_active    boolean,
  p_confirm      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_was      boolean;
  v_future   jsonb;
  v_count    integer := 0;
  v_admins   integer;
  v_vacated  integer := 0;
  v_now      timestamptz := now();
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select bool_or(m.is_active) into v_was
    from public.workspace_members m
    join public.app_profiles p on p.id = m.profile_id
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id
     and p.anonymized_at is null;

  if v_was is null then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  if v_was = p_is_active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if not p_is_active then
    select count(*) into v_admins
      from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
       and m.profile_id <> p_profile_id;

    if v_admins = 0 and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id
         and m.profile_id = p_profile_id
         and m.role = 'WORKSPACE_ADMIN'
         and m.is_active
    ) then
      return jsonb_build_object('ok', false, 'code', 'LAST_ADMIN');
    end if;

    -- The trainings the A3f sheet lists, soonest first.
    select count(*)::int,
           coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'start_at', s.start_at, 'end_at', s.end_at,
             'facility_code', f.code) order by s.start_at), '[]'::jsonb)
      into v_count, v_future
      from public.training_sessions s
      join public.facilities f on f.id = s.facility_id
     where s.workspace_id = p_workspace_id
       and s.main_coach_profile_id = p_profile_id
       and s.status <> 'CANCELLED'
       and s.start_at > v_now;

    if v_count > 0 and not p_confirm then
      return jsonb_build_object('ok', false, 'code', 'LEADS_FUTURE_SESSIONS',
        'details', jsonb_build_object('future_sessions', v_count, 'sessions', v_future));
    end if;

    -- The mirror column first, then the canonical row: no trigger follows a
    -- deleted MAIN row, and the coach is still active staff at this point.
    with vacated as (
      update public.training_sessions s
         set main_coach_profile_id   = null,
             main_coach_vacated_from = p_profile_id,
             main_coach_vacated_at   = v_now
       where s.workspace_id = p_workspace_id
         and s.main_coach_profile_id = p_profile_id
         and s.status <> 'CANCELLED'
         and s.start_at > v_now
      returning s.id
    )
    select count(*)::int into v_vacated from vacated;

    delete from public.training_session_coaches c
     using public.training_sessions s
     where s.id = c.training_session_id
       and s.workspace_id = p_workspace_id
       and c.profile_id = p_profile_id
       and s.status <> 'CANCELLED'
       and s.start_at > v_now;
  end if;

  update public.workspace_members m
     set is_active = p_is_active
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id;

  -- §A3 (v3, DR-08): deactivation takes the administrator's role with it.
  if not p_is_active then
    insert into public.workspace_members (workspace_id, profile_id, role, is_active)
    values (p_workspace_id, p_profile_id, 'COACH', false)
    on conflict (workspace_id, profile_id, role) do update set is_active = false;

    delete from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.role         = 'WORKSPACE_ADMIN';
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor,
     case when p_is_active then 'MEMBER_ACTIVATED' else 'MEMBER_DEACTIVATED' end,
     'PROFILE', p_profile_id,
     jsonb_build_object('is_active', v_was),
     jsonb_build_object('is_active', p_is_active,
                        'future_sessions', v_count,
                        'vacated_sessions', v_vacated));

  return jsonb_build_object('ok', true, 'is_active', p_is_active,
                            'vacated_sessions', v_vacated);
end;
$$;

comment on function public.set_member_active(uuid, uuid, boolean, boolean) is
  'Activates or deactivates a member. Deactivating a coach who leads future trainings needs p_confirm, and leaves those trainings without a main coach (A3f, decision 46).';

revoke all on function public.set_member_active(uuid, uuid, boolean, boolean) from public;
grant execute on function public.set_member_active(uuid, uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Restated from migration 28: clearing the main coach is not a change.
-- ---------------------------------------------------------------------------
create or replace function public.record_significant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fields   text[] := '{}';
  v_previous jsonb  := '{}'::jsonb;
  v_timezone text;
  v_existing jsonb;
begin
  -- Nothing to describe until a change has been declared significant. This is
  -- what keeps the record in step with D-11 rather than defining significance
  -- a second time: capacity, changing room and notes never stamp it.
  if new.significant_changed_at is null then
    return new;
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = new.workspace_id;

  -- Local wall clock, because that is the distinction a parent makes: the same
  -- instant is a different date to them the moment it crosses midnight.
  if (old.start_at at time zone v_timezone)::date
       is distinct from (new.start_at at time zone v_timezone)::date then
    v_fields := v_fields || 'DATE'::text;
    v_previous := v_previous || jsonb_build_object('start_at', old.start_at, 'end_at', old.end_at);
  end if;

  if (old.start_at at time zone v_timezone)::time
       is distinct from (new.start_at at time zone v_timezone)::time
     or (old.end_at at time zone v_timezone)::time
       is distinct from (new.end_at at time zone v_timezone)::time then
    v_fields := v_fields || 'TIME'::text;
    v_previous := v_previous || jsonb_build_object('start_at', old.start_at, 'end_at', old.end_at);
  end if;

  if old.location_id is distinct from new.location_id then
    v_fields := v_fields || 'LOCATION'::text;
    v_previous := v_previous || jsonb_build_object(
      'location_name', (select l.name from public.locations l where l.id = old.location_id));
  end if;

  if old.facility_id is distinct from new.facility_id then
    v_fields := v_fields || 'FACILITY'::text;
    v_previous := v_previous || jsonb_build_object(
      'facility_code', (select f.code from public.facilities f where f.id = old.facility_id),
      'facility_name', (select f.name from public.facilities f where f.id = old.facility_id));
  end if;

  -- Migration 44: a training left without its main coach (A3f) is not a
  -- change to tell anyone about — the guardian sees `Trenér bude upřesněn`,
  -- and the e-mail comes when somebody takes it over. Without this, clearing
  -- the coach would join whatever change was recorded last.
  if old.main_coach_profile_id is distinct from new.main_coach_profile_id
     and new.main_coach_profile_id is not null then
    v_fields := v_fields || 'MAIN_COACH'::text;
    v_previous := v_previous || jsonb_build_object(
      'main_coach_name',
      (select p.display_name from public.app_profiles p where p.id = old.main_coach_profile_id));
  end if;

  if array_length(v_fields, 1) is null then
    return new;
  end if;

  v_existing := new.significant_change;

  if v_existing is not null
     and v_existing ->> 'changed_at' = to_jsonb(new.significant_changed_at) #>> '{}' then
    -- The second statement of the same change.
    new.significant_change := jsonb_build_object(
      'changed_at', v_existing -> 'changed_at',
      'fields', (
        select to_jsonb(array_agg(distinct f order by f))
        from unnest(
          array(select jsonb_array_elements_text(v_existing -> 'fields')) || v_fields
        ) f
      ),
      -- The older value wins: within one change, the first statement already
      -- holds what the parent is being told it used to be.
      'previous', v_previous || coalesce(v_existing -> 'previous', '{}'::jsonb)
    );
  else
    new.significant_change := jsonb_build_object(
      'changed_at', to_jsonb(new.significant_changed_at),
      'fields', (select to_jsonb(array_agg(distinct f order by f)) from unnest(v_fields) f),
      'previous', v_previous
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_training_session, restated from migration 42: assigning a coach to a
-- training that has none (K2e `Přiřadit trenéra`) creates its MAIN row, and is
-- a main-coach change like any other — E05 to the booked families.
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

  -- Migration 42 (decision 33): an administrator, a coach who may edit every
  -- training, or this training's own main coach.
  if not public.can_edit_session(v_session.workspace_id, v_session.main_coach_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  -- Leading the training is what lets a coach without the permission edit it;
  -- handing it to somebody else would lock them out of their own training.
  if p_main_coach_profile_id is not null
     and p_main_coach_profile_id is distinct from v_session.main_coach_profile_id
     and not public.can_edit_all_trainings(v_session.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  -- D-07: a cancelled session is terminal. Nothing about it may be edited,
  -- because its cancellation emails may already have gone out.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
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
      --
      -- Migration 44 (K2e): a training whose main coach was deactivated has no
      -- MAIN row to move, so the new coach gets one. Somebody already on it as
      -- an assistant is promoted rather than listed twice.
      if v_session.main_coach_profile_id is null then
        -- Who left goes first: a training cannot both have a main coach and
        -- be waiting for one (training_sessions_vacated_consistent).
        update public.training_sessions s
           set main_coach_vacated_from = null,
               main_coach_vacated_at   = null
         where s.id = p_training_session_id;
        delete from public.training_session_coaches c
         where c.training_session_id = p_training_session_id
           and c.profile_id = v_coach;
        insert into public.training_session_coaches (training_session_id, profile_id, role)
        values (p_training_session_id, v_coach, 'MAIN');
      else
        update public.training_session_coaches c
           set profile_id = v_coach
         where c.training_session_id = p_training_session_id and c.role = 'MAIN';
      end if;
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
