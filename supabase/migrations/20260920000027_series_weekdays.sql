-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 27 — series over several weekdays, with per-date opt-out and a hard ceiling
--
-- Contract: docs/DOMAIN_OPERATIONS.md. Design: docs/design/coach/SPEC.md §K4b, §K11.
--
-- Migration 14 generated a series from a single weekday and created every date
-- the pattern produced. The coach's panel is a multi-select ("Po Út St Čt Pá So
-- Ne") over a checklist the coach may uncheck date by date, capped at 52
-- occurrences.
--
-- The division of labour does not change (principle 5, S-C4): the client sends
-- the PATTERN plus the dates it wants SUPPRESSED, and the server generates.
-- A list of dates to create would let a stale or edited client decide what
-- exists; a list of dates to skip cannot — anything the server does not
-- generate is not created no matter what the client sends.

-- ---------------------------------------------------------------------------
-- Canonical weekday set: sorted, de-duplicated, null-free.
--
-- Exists so the stored pattern has exactly one representation. {7,1,1} and
-- {1,7} are the same series, and two rows that mean the same thing should not
-- compare unequal.
-- ---------------------------------------------------------------------------

create or replace function public.canonical_weekdays(p_weekdays integer[])
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select array_agg(distinct v order by v) from unnest(p_weekdays) v where v is not null),
    '{}'::integer[]
  );
$$;

comment on function public.canonical_weekdays(integer[]) is
  'Sorted, de-duplicated, null-free copy of an ISO weekday array. Immutable, so a check constraint may use it.';

-- ---------------------------------------------------------------------------
-- session_series: one weekday becomes a set, and the dates the coach unchecked
-- are recorded alongside it.
--
-- excluded_dates is provenance, not input: the function stores the dates the
-- pattern produced and the coach suppressed, so the row explains the gaps in
-- the generated sessions without a reader having to re-derive them.
-- ---------------------------------------------------------------------------

alter table public.session_series
  add column if not exists by_weekdays    integer[],
  add column if not exists excluded_dates date[] not null default '{}';

update public.session_series
   set by_weekdays = array[by_weekday]
 where by_weekdays is null;

alter table public.session_series
  alter column by_weekdays set not null;

alter table public.session_series
  drop constraint if exists session_series_weekday_range;

alter table public.session_series
  drop column if exists by_weekday;

alter table public.session_series
  add constraint session_series_weekdays_valid check (
    array_length(by_weekdays, 1) between 1 and 7
    and by_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]
    and by_weekdays = public.canonical_weekdays(by_weekdays)
  ),
  add constraint session_series_excluded_dates_valid check (
    array_position(excluded_dates, null) is null
  ),
  -- coach/SPEC.md §K4b: "Limit: max 52 occurrences". Mirrored in
  -- create_session_series, which refuses with SERIES_TOO_LONG before it
  -- reaches this constraint, and in MAX_SERIES_OCCURRENCES on the client.
  add constraint session_series_generated_count_range check (
    generated_count between 0 and 52
  );

comment on column public.session_series.by_weekdays is
  'ISO-8601 weekdays the pattern repeats on: 1 = Monday .. 7 = Sunday. Canonical (sorted, distinct).';
comment on column public.session_series.excluded_dates is
  'Pattern dates the coach unchecked before creating. Provenance: these are the gaps in the generated sessions.';

-- ---------------------------------------------------------------------------
-- Occurrence dates for a weekly pattern over one or more weekdays.
--
-- Replaces the single-weekday version from migration 14. Still local calendar
-- dates only: generate_series steps over timestamps WITHOUT a time zone, so no
-- daylight-saving rule can apply and a weekday never drifts. The conversion to
-- an instant still happens per occurrence, in create_session_series.
-- ---------------------------------------------------------------------------

drop function if exists public.create_session_series(uuid, integer, date, date, time, time, uuid, integer, public.eligibility_mode, integer, integer, text, text, text, uuid, public.session_status);
drop function if exists public.weekly_occurrence_dates(date, date, integer);

create or replace function public.weekly_occurrence_dates(
  p_local_date_from date,
  p_local_date_to   date,
  p_by_weekdays     integer[],       -- ISO-8601: 1 = Monday .. 7 = Sunday
  p_excluded_dates  date[] default null
)
returns setof date
language sql
immutable
set search_path = ''
as $$
  -- A day-by-day walk rather than a seven-day step: with several weekdays the
  -- gaps are uneven, and the range is bounded by the 52-occurrence ceiling.
  select d::date
  from generate_series(p_local_date_from::timestamp, p_local_date_to::timestamp, interval '1 day') d
  where p_local_date_to >= p_local_date_from
    and extract(isodow from d)::int = any (public.canonical_weekdays(p_by_weekdays))
    -- array_remove, not a bare coalesce: `x = any (array[..., null])` is null
    -- for a non-match, so a single null element would negate to null and
    -- silently suppress every date instead of none.
    and not (d::date = any (array_remove(coalesce(p_excluded_dates, '{}'::date[]), null)))
  order by d;
$$;

comment on function public.weekly_occurrence_dates(date, date, integer[], date[]) is
  'Local calendar dates matching a weekly multi-weekday pattern, minus the excluded dates. No time zone is involved, so the weekday never drifts across a daylight-saving boundary.';

revoke all on function public.weekly_occurrence_dates(date, date, integer[], date[]) from public;
grant execute on function public.weekly_occurrence_dates(date, date, integer[], date[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Create a series and all of its occurrences, in one transaction.
--
-- All or nothing (S-C4, AC-080b). Generated sessions are independent from this
-- moment (BR-081): the series row is provenance, not a live template.
-- ---------------------------------------------------------------------------

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
  -- expanded. 52 weekly occurrences of a single weekday span 357 days, so no
  -- series the ceiling allows can reach this bound.
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
  if array_length(v_dates, 1) > 52 then
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
