-- ---------------------------------------------------------------------------
-- A training planned without a main coach (product request, 12 November
-- 2026, on top of decision 46).
--
-- Since migration 44 a training may have no main coach once its coach was
-- deactivated (K2e). The club also wants to plan one that way from the start
-- — the ice is booked, who runs it is decided later — for one training and for
-- a series. `p_without_main_coach` asks for that explicitly: a null
-- `p_main_coach_profile_id` still means "me", as it always has, so no existing
-- caller changes meaning.
--
-- Parents read `Trenér bude upřesněn`; assigning a coach later is the
-- ordinary main-coach change of update_training_session, so the booked
-- families get E05 (migration 44). Creating still needs `Může upravovat
-- všechny tréninky` (decision 33), and only those may edit such a training.
--
-- Both functions gain a defaulted parameter, so the old signatures are dropped
-- first: otherwise every call would be ambiguous between the two.
-- ---------------------------------------------------------------------------

alter table public.session_series alter column main_coach_profile_id drop not null;

drop function public.create_training_session(uuid, date, time, time, uuid, integer,
  public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status);
drop function public.create_session_series(uuid, integer[], date, date, time, time, uuid, date[],
  integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status);

create function public.create_training_session(
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
  p_status                public.session_status default 'OPEN',
  -- Migration 46: plan it now, name the coach later (K2e).
  p_without_main_coach    boolean default false
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

  v_coach := case when p_without_main_coach then null
                  else coalesce(p_main_coach_profile_id, v_actor) end;

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

    if v_coach is not null then
      insert into public.training_session_coaches (training_session_id, profile_id, role)
      values (v_session_id, v_coach, 'MAIN');
    end if;

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

create function public.create_session_series(
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
  p_status                public.session_status default 'OPEN',
  -- Migration 46: plan it now, name the coach later (K2e).
  p_without_main_coach    boolean default false
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

  v_coach := case when p_without_main_coach then null
                  else coalesce(p_main_coach_profile_id, v_actor) end;

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

      if v_coach is not null then
        insert into public.training_session_coaches (training_session_id, profile_id, role)
        values (v_session_id, v_coach, 'MAIN');
      end if;

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

revoke all on function public.create_training_session(uuid, date, time, time, uuid, integer,
  public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status, boolean) from public;
grant execute on function public.create_training_session(uuid, date, time, time, uuid, integer,
  public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status, boolean) to authenticated;
revoke all on function public.create_session_series(uuid, integer[], date, date, time, time, uuid, date[],
  integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status, boolean) from public;
grant execute on function public.create_session_series(uuid, integer[], date, date, time, time, uuid, date[],
  integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status, boolean) to authenticated;
