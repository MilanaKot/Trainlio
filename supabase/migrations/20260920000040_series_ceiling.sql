-- ---------------------------------------------------------------------------
-- A series may hold up to 200 trainings, not 52.
--
-- 52 was set when a series repeated on one weekday, where it is a year of
-- weeks. Migration 27 made the pattern several weekdays and kept the number,
-- which turned it into the binding limit for any real season: three trainings
-- a week from September to March is around 90, and a coach creating that saw
-- `Vytvořit 133 tréninků` greyed out.
--
-- 200 covers a season at almost any frequency. What keeps a series from being
-- absurd is still the 366-day span guard, checked before anything is expanded.
-- The ceiling is enforced in the same three places as before: this function
-- (SERIES_TOO_LONG), the check constraint on generated_count, and the client's
-- MAX_SERIES_OCCURRENCES, which only labels the preview.
--
-- The function is restated whole from migration 27 with the ceiling and the
-- span-guard comment changed and nothing else.
-- ---------------------------------------------------------------------------

alter table public.session_series
  drop constraint session_series_generated_count_range;

alter table public.session_series
  add constraint session_series_generated_count_range check (
    generated_count between 0 and 200
  );

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

revoke all on function public.create_session_series(uuid, integer[], date, date, time, time, uuid, date[], integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status) from public;
grant execute on function public.create_session_series(uuid, integer[], date, date, time, time, uuid, date[], integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status) to authenticated;
