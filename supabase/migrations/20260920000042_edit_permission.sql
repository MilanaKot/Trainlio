-- ---------------------------------------------------------------------------
-- Who may edit a training (handoff v3.2, decision 33).
--
--   canEdit(session) = isAdmin || canEditTrainings || session.main coach = me
--   canCreate        = isAdmin || canEditTrainings
--
-- `Může upravovat všechny tréninky` is a coach's permission, on by default. A
-- coach without it still edits every training they lead as main coach, views
-- the rest (roster, guardians' phones, internal note — reading is unchanged),
-- and creates nothing: no new training, no copy, no series. They also cannot
-- hand their own training to another main coach, which would lock them out of
-- it.
--
-- Where the value lives. On the coach's COACH row in workspace_members, which
-- is per club, like the role. An administrator can always edit, but that is
-- computed (can_edit_all_trainings) rather than written into the column: the
-- spec also says that taking the administrator role away "keeps the previous
-- value", which a column forced to true could not remember.
-- set_member_can_edit_trainings refuses to switch it off for an administrator,
-- so the screen and the API say the same thing.
--
-- Where it is enforced. Coaches have no INSERT or UPDATE on sessions or
-- bookings at all (CLAUDE.md principle 10), so there is no write policy to
-- mirror it into; every write goes through a SECURITY DEFINER function, and
-- each of the ten that change a training, its roster or an athlete's note now
-- asks one of the two helpers below and refuses with FORBIDDEN_EDIT. Each is
-- restated whole from its latest migration with that block added right after
-- its existing staff check, and nothing else changed.
-- ---------------------------------------------------------------------------

alter table public.workspace_members
  add column can_edit_trainings boolean not null default true;

comment on column public.workspace_members.can_edit_trainings is
  'Decision 33. On the COACH row: may create trainings and edit every training. Without it a coach edits only the trainings they lead as main coach. Administrators can always edit (can_edit_all_trainings); this column keeps the coach''s own value underneath.';

-- May the caller create trainings and edit every training of this club?
create or replace function public.can_edit_all_trainings(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_workspace_admin(p_workspace_id)
      or exists (
        select 1
          from public.workspace_members wm
         where wm.workspace_id = p_workspace_id
           and wm.profile_id = public.current_profile_id()
           and wm.is_active
           and wm.role = 'COACH'
           and wm.can_edit_trainings
      );
$$;

-- May the caller edit this training? It takes the club and the training's
-- main coach rather than the training's id, because every caller has already
-- read the row (most of them under a lock).
create or replace function public.can_edit_session(p_workspace_id uuid, p_main_coach_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_edit_all_trainings(p_workspace_id)
      or (public.is_workspace_coach(p_workspace_id)
          and p_main_coach_profile_id = public.current_profile_id());
$$;

revoke all on function public.can_edit_all_trainings(uuid) from public;
grant execute on function public.can_edit_all_trainings(uuid) to authenticated;
revoke all on function public.can_edit_session(uuid, uuid) from public;
grant execute on function public.can_edit_session(uuid, uuid) to authenticated;

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
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    'MEMBER_ROLE_CHANGED',
    -- Decision 33: who may edit every training.
    'MEMBER_PERMISSION_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED'
  )
);

-- ---------------------------------------------------------------------------
-- §A2/§A3 `Může upravovat všechny tréninky`. Administrators only.
-- ---------------------------------------------------------------------------
create or replace function public.set_member_can_edit_trainings(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_value        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_was   boolean;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_value is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PERMISSION');
  end if;

  -- Admin test 17: an administrator can always edit, and the API says so too.
  if not p_value and exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.role         = 'WORKSPACE_ADMIN'
       and m.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'ADMIN_ALWAYS_EDITS');
  end if;

  select m.can_edit_trainings into v_was
    from public.workspace_members m
    join public.app_profiles p on p.id = m.profile_id
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id
     and m.role         = 'COACH'
     and p.anonymized_at is null
   for update of m;

  if not found then
    -- An administrator with no coach row is already allowed everything; asking
    -- for that again is not an error. Anybody else here is not a coach.
    if p_value and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id and m.profile_id = p_profile_id
         and m.role = 'WORKSPACE_ADMIN' and m.is_active
    ) then
      return jsonb_build_object('ok', true, 'unchanged', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  if v_was = p_value then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  update public.workspace_members m
     set can_edit_trainings = p_value
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id
     and m.role         = 'COACH';

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_PERMISSION_CHANGED', 'PROFILE', p_profile_id,
     jsonb_build_object('can_edit_trainings', v_was),
     jsonb_build_object('can_edit_trainings', p_value));

  return jsonb_build_object('ok', true, 'can_edit_trainings', p_value);
end;
$$;

revoke all on function public.set_member_can_edit_trainings(uuid, uuid, boolean) from public;
grant execute on function public.set_member_can_edit_trainings(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- The staff list (§A1, §A3) and the caller's own state carry the permission.
-- Restated from migration 36 with one column added to each.
-- ---------------------------------------------------------------------------

drop function public.workspace_staff(uuid);

create function public.workspace_staff(p_workspace_id uuid)
returns table (
  profile_id       uuid,
  first_name       text,
  last_name        text,
  display_name     text,
  roles            public.workspace_role[],
  is_active        boolean,
  has_login        boolean,
  is_editable      boolean,
  future_sessions  integer,
  phone            text,
  email            text,
  invited_at       timestamptz,
  first_sign_in_at timestamptz,
  last_seen_at     timestamptz,
  -- Decision 33: the coach's own value, kept under an administrator's role.
  can_edit_trainings boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.first_name,
    p.last_name,
    p.display_name,
    array_agg(distinct m.role),
    bool_or(m.is_active),
    p.auth_user_id is not null,
    public.is_workspace_admin(p_workspace_id) and p.anonymized_at is null,
    (select count(*)::int
       from public.training_sessions s
      where s.workspace_id = p_workspace_id
        and s.main_coach_profile_id = p.id
        and s.status <> 'CANCELLED'
        and s.start_at > now()),
    -- Contact details go to an administrator, and to the coach themselves.
    -- A coach does not get a directory of their colleagues out of a screen
    -- they cannot write to.
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.phone end,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.email end,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.invited_at end,
    c.first_sign_in_at,
    case when public.is_workspace_admin(p_workspace_id) or p.id = public.current_profile_id()
         then c.last_seen_at end,
    -- No coach row (an administrator who never coached) reads as on, which is
    -- what such a row would be created with.
    coalesce(bool_and(m.can_edit_trainings) filter (where m.role = 'COACH'), true)
  from public.workspace_members m
  join public.app_profiles p on p.id = m.profile_id
  left join public.staff_contacts c on c.profile_id = p.id
  where m.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
  group by p.id, p.first_name, p.last_name, p.display_name, p.auth_user_id, p.anonymized_at,
           c.phone, c.email, c.invited_at, c.first_sign_in_at, c.last_seen_at
  order by bool_or(m.is_active) desc, p.last_name nulls last, p.first_name nulls last;
$$;

revoke all on function public.workspace_staff(uuid) from public;
grant execute on function public.workspace_staff(uuid) to authenticated;

drop function public.own_staff_state();

create function public.own_staff_state()
returns table (
  profile_id       uuid,
  is_staff         boolean,
  is_admin         boolean,
  phone            text,
  email            text,
  first_sign_in_at timestamptz,
  welcomed_at      timestamptz,
  -- Decision 33, as it applies to the caller: may create trainings and edit
  -- every one. False means they edit only what they lead as main coach.
  can_edit_all     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    exists (select 1 from public.workspace_members m
             where m.profile_id = p.id and m.is_active),
    exists (select 1 from public.workspace_members m
             where m.profile_id = p.id and m.is_active and m.role = 'WORKSPACE_ADMIN'),
    c.phone,
    c.email,
    c.first_sign_in_at,
    c.welcomed_at,
    exists (select 1 from public.workspace_members m
             where m.profile_id = p.id and m.is_active
               and (m.role = 'WORKSPACE_ADMIN' or (m.role = 'COACH' and m.can_edit_trainings)))
  from public.app_profiles p
  left join public.staff_contacts c on c.profile_id = p.id
  where p.id = public.current_profile_id();
$$;

revoke all on function public.own_staff_state() from public;
grant execute on function public.own_staff_state() to authenticated;

-- ---------------------------------------------------------------------------
-- The ten functions that change a training, its roster or an athlete's note.
-- ---------------------------------------------------------------------------

-- create_training_session, restated from migration 13.
create or replace function public.create_training_session(
  p_workspace_id          uuid,
  p_local_date            date,
  p_local_start_time      time,
  p_local_end_time        time,
  p_facility_id           uuid,
  p_capacity              integer default 10,
  p_eligibility_mode      public.eligibility_mode default 'ALL',
  p_birth_year_from       integer default null,
  p_birth_year_to         integer default null,
  p_changing_room         text default null,
  p_public_notes          text default null,
  p_internal_notes        text default null,
  p_main_coach_profile_id uuid default null,
  p_status                public.session_status default 'OPEN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := public.current_profile_id();
  v_timezone    text;
  v_location_id uuid;
  v_coach       uuid;
  v_session_id  uuid;
  v_start       timestamptz;
  v_end         timestamptz;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Migration 42 (decision 33): creating needs the permission, even for a
  -- training the caller would lead.
  if not public.can_edit_all_trainings(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if p_status not in ('DRAFT', 'OPEN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_STATUS');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, p_workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  -- Converted from the workspace's wall clock, one occurrence at a time. The
  -- same rule that keeps a recurring series on 09:00 across a DST boundary.
  v_start := (p_local_date + p_local_start_time) at time zone v_timezone;
  v_end   := (p_local_date + p_local_end_time)   at time zone v_timezone;

  v_coach := coalesce(p_main_coach_profile_id, v_actor);

  begin
    insert into public.training_sessions (
      workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
      start_at, end_at, changing_room, capacity,
      eligibility_mode, birth_year_from, birth_year_to,
      status, public_notes, created_by
    )
    select p_workspace_id, w.primary_sport_id, v_location_id, p_facility_id, v_coach,
           v_start, v_end, nullif(btrim(coalesce(p_changing_room, '')), ''), p_capacity,
           p_eligibility_mode, p_birth_year_from, p_birth_year_to,
           p_status, nullif(btrim(coalesce(p_public_notes, '')), ''), v_actor
    from public.workspaces w
    where w.id = p_workspace_id
    returning id into v_session_id;

    insert into public.training_session_coaches (training_session_id, profile_id, role)
    values (v_session_id, v_coach, 'MAIN');

    if nullif(btrim(coalesce(p_internal_notes, '')), '') is not null then
      insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
      values (v_session_id, btrim(p_internal_notes), v_actor);
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, after)
  values (p_workspace_id, v_actor, 'SESSION_CREATED', 'TRAINING_SESSION', v_session_id,
          jsonb_build_object('start_at', v_start, 'end_at', v_end, 'capacity', p_capacity,
                             'status', p_status, 'facility_id', p_facility_id));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('training_session_id', v_session_id));
end;
$$;

-- create_session_series, restated from migration 40.
create or replace function public.create_session_series(
  p_workspace_id          uuid,
  p_by_weekdays           integer[],
  p_local_date_from       date,
  p_local_date_to         date,
  p_local_start_time      time,
  p_local_end_time        time,
  p_facility_id           uuid,
  p_excluded_dates        date[] default null,
  p_capacity              integer default 10,
  p_eligibility_mode      public.eligibility_mode default 'ALL',
  p_birth_year_from       integer default null,
  p_birth_year_to         integer default null,
  p_changing_room         text default null,
  p_public_notes          text default null,
  p_internal_notes        text default null,
  p_main_coach_profile_id uuid default null,
  p_status                public.session_status default 'OPEN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := public.current_profile_id();
  v_timezone    text;
  v_location_id uuid;
  v_coach       uuid;
  v_series_id   uuid;
  v_weekdays    integer[];
  v_candidates  date[];
  v_excluded    date[];
  v_dates       date[];
  v_date        date;
  v_session_id  uuid;
  v_ids         uuid[] := '{}';
  v_changing    text := nullif(btrim(coalesce(p_changing_room, '')), '');
  v_public      text := nullif(btrim(coalesce(p_public_notes, '')), '');
  v_internal    text := nullif(btrim(coalesce(p_internal_notes, '')), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Migration 42 (decision 33): creating needs the permission, even for a
  -- training the caller would lead.
  if not public.can_edit_all_trainings(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if p_status not in ('DRAFT', 'OPEN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_STATUS');
  end if;

  -- Duplicates and ordering are normalised rather than refused: {7,1,1} is not
  -- a mistake a coach can make in the UI, and it means exactly {1,7}. A value
  -- outside 1..7, or a null element, is refused instead of quietly dropped:
  -- neither has an honest reading, and silently creating a shorter series than
  -- the coach asked for is worse than refusing.
  v_weekdays := public.canonical_weekdays(p_by_weekdays);
  if array_length(v_weekdays, 1) is null
     or array_position(p_by_weekdays, null) is not null
     or not (v_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WEEKDAY');
  end if;

  if p_local_date_from is null or p_local_date_to is null
     or p_local_date_to < p_local_date_from then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DATE_RANGE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  -- Checked before generating, so an absurd range is refused rather than
  -- expanded. With the ceiling at 200 this bound is no longer only a backstop:
  -- one to three weekdays reach it before the ceiling (a year of three a week
  -- is 157), four to seven reach the ceiling first.
  if p_local_date_to - p_local_date_from > 366 then
    return jsonb_build_object('ok', false, 'code', 'SERIES_TOO_LONG');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, p_workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  v_candidates := array(
    select d from public.weekly_occurrence_dates(p_local_date_from, p_local_date_to, v_weekdays) d
  );
  v_dates := array(
    select d
    from public.weekly_occurrence_dates(p_local_date_from, p_local_date_to, v_weekdays, p_excluded_dates) d
  );
  -- Only the exclusions that actually suppressed a date are recorded. An
  -- exclusion naming a date the pattern never produced changes nothing, so it
  -- is dropped rather than treated as an error: the client cannot conjure an
  -- occurrence, only decline one.
  v_excluded := array(
    select c
    from unnest(v_candidates) c
    where c = any (array_remove(coalesce(p_excluded_dates, '{}'::date[]), null))
    order by c
  );

  if array_length(v_dates, 1) is null then
    return jsonb_build_object('ok', false, 'code', 'SERIES_EMPTY');
  end if;

  -- The ceiling applies to what gets created, which is what the coach's footer
  -- counts ("Vytvořit {n} tréninků", n = checked).
  if array_length(v_dates, 1) > 200 then
    return jsonb_build_object('ok', false, 'code', 'SERIES_TOO_LONG');
  end if;

  v_coach := coalesce(p_main_coach_profile_id, v_actor);

  begin
    insert into public.session_series (
      workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
      frequency, by_weekdays, excluded_dates, local_date_from, local_date_to,
      local_start_time, local_end_time,
      -- Snapshotted, not referenced: this records how the existing sessions
      -- were produced, so a later workspace timezone change cannot rewrite it.
      generated_in_timezone, generated_count, generated_at,
      capacity, eligibility_mode, birth_year_from, birth_year_to,
      changing_room, public_notes, internal_notes, created_by
    )
    select p_workspace_id, w.primary_sport_id, v_location_id, p_facility_id, v_coach,
           'WEEKLY', v_weekdays, v_excluded, p_local_date_from, p_local_date_to,
           p_local_start_time, p_local_end_time,
           v_timezone, array_length(v_dates, 1), now(),
           p_capacity, p_eligibility_mode, p_birth_year_from, p_birth_year_to,
           v_changing, v_public, v_internal, v_actor
    from public.workspaces w
    where w.id = p_workspace_id
    returning id into v_series_id;

    foreach v_date in array v_dates loop
      insert into public.training_sessions (
        workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
        series_id, start_at, end_at, changing_room, capacity,
        eligibility_mode, birth_year_from, birth_year_to,
        status, public_notes, created_by
      )
      select p_workspace_id, w.primary_sport_id, v_location_id, p_facility_id, v_coach,
             v_series_id,
             -- Converted per occurrence. This is the line the whole feature
             -- exists for: (date + time) AT TIME ZONE resolves each local wall
             -- clock against the offset in force on that date.
             (v_date + p_local_start_time) at time zone v_timezone,
             (v_date + p_local_end_time)   at time zone v_timezone,
             v_changing, p_capacity,
             p_eligibility_mode, p_birth_year_from, p_birth_year_to,
             p_status, v_public, v_actor
      from public.workspaces w
      where w.id = p_workspace_id
      returning id into v_session_id;

      insert into public.training_session_coaches (training_session_id, profile_id, role)
      values (v_session_id, v_coach, 'MAIN');

      if v_internal is not null then
        insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
        values (v_session_id, v_internal, v_actor);
      end if;

      v_ids := v_ids || v_session_id;
    end loop;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, after, metadata)
  values (p_workspace_id, v_actor, 'SESSION_SERIES_CREATED', 'SESSION_SERIES', v_series_id,
          jsonb_build_object('by_weekdays', to_jsonb(v_weekdays),
                             'excluded_dates', to_jsonb(v_excluded),
                             'local_date_from', p_local_date_from,
                             'local_date_to', p_local_date_to,
                             'local_start_time', p_local_start_time,
                             'local_end_time', p_local_end_time,
                             'generated_in_timezone', v_timezone),
          jsonb_build_object('generated_count', array_length(v_dates, 1),
                             'excluded_count', coalesce(array_length(v_excluded, 1), 0),
                             'training_session_ids', to_jsonb(v_ids)));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'session_series_id', v_series_id,
    'generated_count', array_length(v_dates, 1),
    'excluded_count', coalesce(array_length(v_excluded, 1), 0),
    'training_session_ids', to_jsonb(v_ids)
  ));
end;
$$;

-- duplicate_training_session, restated from migration 13.
create or replace function public.duplicate_training_session(
  p_training_session_id uuid,
  p_local_date          date,
  p_local_start_time    time default null,
  p_local_end_time      time default null,
  p_status              public.session_status default 'OPEN'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_source   record;
  v_timezone text;
  v_new_id   uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_start_t  time;
  v_end_t    time;
  v_notes    text;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_source from public.training_sessions s where s.id = p_training_session_id;
  if v_source.id is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_NOT_FOUND');
  end if;

  if not public.is_workspace_coach(v_source.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Migration 42 (decision 33): creating needs the permission, even for a
  -- training the caller would lead.
  if not public.can_edit_all_trainings(v_source.workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if p_status not in ('DRAFT', 'OPEN') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SESSION_STATUS');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = v_source.workspace_id;

  -- Times default to the source's own wall-clock times in the workspace zone,
  -- not to the same instant: duplicating a 09:00 session onto a date after a
  -- daylight-saving change must still produce 09:00.
  v_start_t := coalesce(p_local_start_time, (v_source.start_at at time zone v_timezone)::time);
  v_end_t   := coalesce(p_local_end_time,   (v_source.end_at   at time zone v_timezone)::time);

  if v_end_t <= v_start_t then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  v_start := (p_local_date + v_start_t) at time zone v_timezone;
  v_end   := (p_local_date + v_end_t)   at time zone v_timezone;

  insert into public.training_sessions (
    workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
    start_at, end_at, changing_room, capacity,
    eligibility_mode, birth_year_from, birth_year_to,
    status, public_notes, created_by
  )
  values (
    v_source.workspace_id, v_source.sport_id, v_source.location_id, v_source.facility_id,
    v_source.main_coach_profile_id, v_start, v_end, v_source.changing_room, v_source.capacity,
    v_source.eligibility_mode, v_source.birth_year_from, v_source.birth_year_to,
    p_status, v_source.public_notes, v_actor
  )
  returning id into v_new_id;

  -- The whole coach roster, assistants included.
  insert into public.training_session_coaches (training_session_id, profile_id, role)
  select v_new_id, c.profile_id, c.role
  from public.training_session_coaches c
  where c.training_session_id = p_training_session_id
  on conflict do nothing;

  select n.notes into v_notes
  from public.training_session_internal_notes n
  where n.training_session_id = p_training_session_id;

  if v_notes is not null then
    insert into public.training_session_internal_notes (training_session_id, notes, updated_by)
    values (v_new_id, v_notes, v_actor);
  end if;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, after, metadata)
  values (v_source.workspace_id, v_actor, 'SESSION_DUPLICATED', 'TRAINING_SESSION', v_new_id,
          jsonb_build_object('start_at', v_start, 'end_at', v_end, 'status', p_status),
          jsonb_build_object('source_training_session_id', p_training_session_id));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('training_session_id', v_new_id));
end;
$$;

-- update_training_session, restated from migration 41.
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
     and p_main_coach_profile_id <> v_session.main_coach_profile_id
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

-- set_session_booking_state, restated from migration 41.
create or replace function public.set_session_booking_state(
  p_training_session_id uuid,
  p_open                boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_new     public.session_status;
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

  -- D-07. Reopening a cancelled session is refused here and by trigger.
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  v_new := case when p_open then 'OPEN' else 'CLOSED' end;

  update public.training_sessions s set status = v_new where s.id = p_training_session_id;

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values (v_session.workspace_id, v_actor,
          case when p_open then 'SESSION_BOOKING_REOPENED' else 'SESSION_BOOKING_CLOSED' end,
          'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('status', v_session.status),
          jsonb_build_object('status', v_new));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('status', v_new));
end;
$$;

-- cancel_training_session, restated from migration 41.
create or replace function public.cancel_training_session(
  p_training_session_id uuid,
  p_reason              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_booked  integer;
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

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
  end if;

  select o.confirmed_count into v_booked
  from public.training_session_occupancy o
  where o.training_session_id = p_training_session_id;

  update public.training_sessions s
     set status = 'CANCELLED', cancelled_at = now(), cancelled_by = v_actor
   where s.id = p_training_session_id;

  -- BR-072/073: one event, expanded into one delivery per guardian by the
  -- drain job, each naming that guardian's own affected athletes.
  insert into public.notification_events (workspace_id, training_session_id, event_type, payload)
  values (v_session.workspace_id, p_training_session_id, 'SESSION_CANCELLED',
          jsonb_build_object('start_at', v_session.start_at, 'end_at', v_session.end_at,
                             'facility_id', v_session.facility_id,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  insert into public.audit_log (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
  values (v_session.workspace_id, v_actor, 'SESSION_CANCELLED', 'TRAINING_SESSION', p_training_session_id,
          jsonb_build_object('status', v_session.status),
          jsonb_build_object('status', 'CANCELLED'),
          jsonb_build_object('confirmed_at_cancellation', v_booked,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'training_session_id', p_training_session_id,
    'confirmed_at_cancellation', v_booked
  ));
end;
$$;

-- book_athlete_as_coach, restated from migration 41.
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

  -- Migration 42 (decision 33): an administrator, a coach who may edit every
  -- training, or this training's own main coach.
  if not public.can_edit_session(v_session.workspace_id, v_session.main_coach_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
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

-- cancel_booking_as_coach, restated from migration 41.
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

  -- Migration 42 (decision 33): an administrator, a coach who may edit every
  -- training, or this training's own main coach.
  if not public.can_edit_session(v_session.workspace_id, v_session.main_coach_profile_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  -- Migration 41: a finished training is a record of what happened. Nothing
  -- about it, and nobody on it, changes after it ends.
  if v_session.end_at < now() then
    return jsonb_build_object('ok', false, 'code', 'SESSION_FINISHED');
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

-- set_session_assistants, restated from migration 26.
create or replace function public.set_session_assistants(
  p_training_session_id uuid,
  p_profile_ids         uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_session record;
  v_wanted  uuid[];
  v_before  uuid[];
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

  -- D-07: a cancelled training is terminal. K6b leaves only "Duplikovat".
  if v_session.status = 'CANCELLED' then
    return jsonb_build_object('ok', false, 'code', 'SESSION_CANCELLED');
  end if;

  -- The sheet cannot send a duplicate or a null; something that is not the
  -- sheet can.
  select coalesce(array_agg(distinct id), '{}')
    into v_wanted
  from unnest(coalesce(p_profile_ids, '{}')) as id
  where id is not null;

  -- §K3b shows the main coach disabled with "Hlavní trenér tohoto tréninku".
  -- Accepting them here would mean one person in two roles on one training.
  if v_session.main_coach_profile_id = any(v_wanted) then
    return jsonb_build_object('ok', false, 'code', 'MAIN_COACH_AS_ASSISTANT');
  end if;

  select coalesce(array_agg(c.profile_id order by c.profile_id), '{}')
    into v_before
  from public.training_session_coaches c
  where c.training_session_id = p_training_session_id and c.role = 'ASSISTANT';

  begin
    delete from public.training_session_coaches c
     where c.training_session_id = p_training_session_id
       and c.role = 'ASSISTANT'
       and not (c.profile_id = any(v_wanted));

    insert into public.training_session_coaches (training_session_id, profile_id, role)
    select p_training_session_id, id, 'ASSISTANT'
    from unnest(v_wanted) as id
    on conflict (training_session_id, profile_id) do nothing;
  exception
    -- The exact condition assert_profile_is_workspace_staff raises for anyone
    -- who is not active staff of this workspace. Narrow on purpose: `others`
    -- here would report a genuine fault as a coach who does not work at the
    -- club, and the difference matters to whoever reads the report.
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'COACH_NOT_WORKSPACE_STAFF');
  end;

  -- Silent when nothing moved: a coach who opened the sheet and pressed Hotovo
  -- without ticking anything has not changed who runs the training.
  if v_before is distinct from (
    select coalesce(array_agg(c.profile_id order by c.profile_id), '{}')
    from public.training_session_coaches c
    where c.training_session_id = p_training_session_id and c.role = 'ASSISTANT'
  ) then
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values
      (v_session.workspace_id, v_actor, 'SESSION_ASSISTANTS_CHANGED', 'TRAINING_SESSION',
       p_training_session_id,
       jsonb_build_object('assistant_profile_ids', to_jsonb(v_before)),
       jsonb_build_object('assistant_profile_ids', to_jsonb(v_wanted)));
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('assistant_count',
    coalesce(array_length(v_wanted, 1), 0)));
end;
$$;

-- set_athlete_internal_note, restated from migration 35.
create or replace function public.set_athlete_internal_note(
  p_workspace_id uuid,
  p_athlete_id   uuid,
  p_notes        text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  -- Migration 42 (decision 33): the athlete's note is the club's,
  -- so it takes the permission to edit every training (§K13).
  if not public.can_edit_all_trainings(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN_EDIT');
  end if;

  if not exists (
    select 1 from public.workspace_athlete_memberships m
     where m.workspace_id = p_workspace_id
       and m.athlete_id = p_athlete_id
       and m.is_active
  ) then
    return jsonb_build_object('ok', false, 'code', 'ATHLETE_NOT_IN_WORKSPACE');
  end if;

  -- The form limits this too; a caller that is not the form does not.
  if length(coalesce(v_notes, '')) > 200 then
    return jsonb_build_object('ok', false, 'code', 'NOTE_TOO_LONG');
  end if;

  if v_notes is null then
    delete from public.athlete_internal_notes n
     where n.athlete_id = p_athlete_id and n.workspace_id = p_workspace_id;
    return jsonb_build_object('ok', true, 'data', jsonb_build_object('notes', null));
  end if;

  insert into public.athlete_internal_notes (athlete_id, workspace_id, notes, updated_by)
  values (p_athlete_id, p_workspace_id, v_notes, v_actor)
  on conflict (athlete_id, workspace_id) do update
    set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();

  return jsonb_build_object('ok', true, 'data', jsonb_build_object('notes', v_notes));
end;
$$;
