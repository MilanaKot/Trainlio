-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 14 — recurring series
--
-- Contract: docs/DOMAIN_OPERATIONS.md.
--
-- The whole point of this function is step 3 below. Occurrences are generated
-- as LOCAL CALENDAR DATES and each one is converted to an instant on its own.
-- Adding a fixed seven-day interval to a timestamptz instead would shift a
-- series by an hour the moment it crosses a daylight-saving boundary — which
-- the PRD's own example does: Sundays 09:00, 4 October to 29 November 2026,
-- where Czech DST ends on 25 October, itself an occurrence date.

-- ---------------------------------------------------------------------------
-- Occurrence dates for a weekly pattern, as local calendar dates.
--
-- Exposed separately so the coach's preview and the generator cannot drift:
-- the dates a coach approves are the dates that get created.
-- ---------------------------------------------------------------------------

create or replace function public.weekly_occurrence_dates(
  p_local_date_from date,
  p_local_date_to   date,
  p_by_weekday      integer          -- ISO-8601: 1 = Monday .. 7 = Sunday
)
returns setof date
language sql
immutable
set search_path = ''
as $$
  select d::date
  from generate_series(
    -- The first matching weekday on or after the start date.
    (p_local_date_from
      + ((p_by_weekday - extract(isodow from p_local_date_from)::int + 7) % 7))::timestamp,
    p_local_date_to::timestamp,
    interval '7 day'
  ) d
  where p_by_weekday between 1 and 7
    and p_local_date_to >= p_local_date_from;
$$;

comment on function public.weekly_occurrence_dates(date, date, integer) is
  'Local calendar dates only. generate_series steps over timestamps without a time zone, so no daylight-saving rule can apply and the weekday never drifts.';

revoke all on function public.weekly_occurrence_dates(date, date, integer) from public;
grant execute on function public.weekly_occurrence_dates(date, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Create a series and all of its occurrences, in one transaction.
--
-- All or nothing (S-C4, AC-080b): a partially generated series is worse than
-- none, because the coach cannot tell from the list which occurrences exist and
-- which were lost.
--
-- Generated sessions are independent from this moment (BR-081). The series row
-- is provenance — the pattern and the timezone it was generated under — not a
-- live template. Editing or cancelling one occurrence never touches a sibling,
-- and there is no "this and all following" editing in MVP.
-- ---------------------------------------------------------------------------

create or replace function public.create_session_series(
  p_workspace_id          uuid,
  p_by_weekday            integer,
  p_local_date_from       date,
  p_local_date_to         date,
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
  v_series_id   uuid;
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

  if p_by_weekday is null or p_by_weekday not between 1 and 7 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WEEKDAY');
  end if;

  if p_local_date_to < p_local_date_from then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DATE_RANGE');
  end if;

  if p_local_end_time <= p_local_start_time then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  v_location_id := public.facility_location_for_workspace(p_facility_id, p_workspace_id);
  if v_location_id is null then
    return jsonb_build_object('ok', false, 'code', 'FACILITY_NOT_IN_WORKSPACE');
  end if;

  select array_agg(d order by d) into v_dates
  from public.weekly_occurrence_dates(p_local_date_from, p_local_date_to, p_by_weekday) d;

  if v_dates is null or array_length(v_dates, 1) = 0 then
    return jsonb_build_object('ok', false, 'code', 'SERIES_EMPTY');
  end if;

  v_coach := coalesce(p_main_coach_profile_id, v_actor);

  begin
    insert into public.session_series (
      workspace_id, sport_id, location_id, facility_id, main_coach_profile_id,
      frequency, by_weekday, local_date_from, local_date_to,
      local_start_time, local_end_time,
      -- Snapshotted, not referenced: this records how the existing sessions
      -- were produced, so a later workspace timezone change cannot rewrite it.
      generated_in_timezone, generated_count, generated_at,
      capacity, eligibility_mode, birth_year_from, birth_year_to,
      changing_room, public_notes, internal_notes, created_by
    )
    select p_workspace_id, w.primary_sport_id, v_location_id, p_facility_id, v_coach,
           'WEEKLY', p_by_weekday, p_local_date_from, p_local_date_to,
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
             -- Converted per occurrence. This is the line the whole migration
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
          jsonb_build_object('by_weekday', p_by_weekday,
                             'local_date_from', p_local_date_from,
                             'local_date_to', p_local_date_to,
                             'local_start_time', p_local_start_time,
                             'local_end_time', p_local_end_time,
                             'generated_in_timezone', v_timezone),
          jsonb_build_object('generated_count', array_length(v_dates, 1),
                             'training_session_ids', to_jsonb(v_ids)));

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'session_series_id', v_series_id,
    'generated_count', array_length(v_dates, 1),
    'training_session_ids', to_jsonb(v_ids)
  ));
end;
$$;

revoke all on function public.create_session_series(uuid, integer, date, date, time, time, uuid, integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status) from public;
grant execute on function public.create_session_series(uuid, integer, date, date, time, time, uuid, integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status) to authenticated;
