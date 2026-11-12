-- ---------------------------------------------------------------------------
-- Statistics (handoff v3.5, decision 48; coach/SPEC.md K20, K20b).
--
-- One function, aggregated here rather than in the application: a season of
-- a club is thousands of bookings, and the screen needs a handful of numbers.
--
-- What counts (decided with the product, 12 November 2026):
--   * a training is *held* once it has started and was not cancelled — the
--     rest of this month is not yet anything;
--   * attendance is Byl / (Byl + Nebyl), an unmarked booking of a training
--     that has ended counting as Nebyl (decision 40), one under way and
--     unmarked counting as neither;
--   * occupancy is Σ confirmed bookings / Σ capacity of the held trainings;
--   * payment is paid / confirmed bookings of the held trainings;
--   * the year filter keeps the children born that year: their bookings, and
--     the trainings at least one of them was booked on (occupancy of those
--     trainings stays the whole training's);
--   * the coach filter keeps the trainings the coach led or assisted on, or —
--     `p_main_only` — led;
--   * `Trenéři` counts a coach's trainings as main coach and assistant.
--
-- Who may read it: the club's coaches, K20 with any filter. Another coach's
-- own statistics (K20b, `p_personal`) and the `Trenéři` block are the
-- administrators'; a coach asking for a colleague's K20b is refused
-- (`NOT_AUTHORIZED`, the screen's 403). A guardian is not a coach and gets the
-- same refusal.
-- ---------------------------------------------------------------------------

create or replace function public.workspace_statistics(
  p_workspace_id uuid,
  p_from         timestamptz,
  p_to           timestamptz,
  p_birth_year   integer default null,
  p_coach_id     uuid default null,
  p_main_only    boolean default false,
  -- K20b's chart: 'week' buckets the month by 1.–7., 8.–14., 15.–21. and
  -- 22.–end; 'month' buckets the season by calendar month.
  p_bucket       text default null,
  -- K20b: one coach's own statistics, rather than K20 filtered by a coach.
  p_personal     boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me       uuid := public.current_profile_id();
  v_admin    boolean;
  v_timezone text;
  v_result   jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_coach(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  v_admin := public.is_workspace_admin(p_workspace_id);

  -- K20b of somebody else is the administrators' (coach test 28). K20's
  -- coach filter is everybody's: it narrows the club's numbers, it does not
  -- open a colleague's page.
  if p_personal and (p_coach_id is null or (p_coach_id <> v_me and not v_admin)) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_bucket is not null and p_bucket not in ('week', 'month') then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION');
  end if;

  select w.timezone into v_timezone from public.workspaces w where w.id = p_workspace_id;

  with held as (
    select s.id, s.capacity, s.start_at, s.end_at, s.main_coach_profile_id,
           s.facility_id, s.changing_room,
           (s.start_at at time zone v_timezone) as local_start
      from public.training_sessions s
     where s.workspace_id = p_workspace_id
       and s.status <> 'CANCELLED'
       and s.start_at >= p_from
       and s.start_at < p_to
       and s.start_at <= now()
       and (p_coach_id is null
            or s.main_coach_profile_id = p_coach_id
            or (not p_main_only and exists (
                  select 1 from public.training_session_coaches c
                   where c.training_session_id = s.id and c.profile_id = p_coach_id)))
  ),
  -- Every confirmed booking of a held training, with what it says.
  booking as (
    select b.id, b.training_session_id, b.athlete_id,
           b.paid_at is not null as paid,
           case when b.attendance = 'PRESENT' then 1
                when b.attendance = 'ABSENT' then 0
                when b.attendance is null and h.end_at <= now() then 0
           end as came,
           extract(year from a.date_of_birth)::int as birth_year
      from public.bookings b
      join held h on h.id = b.training_session_id
      join public.athletes a on a.id = b.athlete_id
     where b.status = 'CONFIRMED'
  ),
  -- The bookings the year filter keeps.
  counted as (
    select * from booking
     where p_birth_year is null or birth_year = p_birth_year
  ),
  -- The trainings the year filter keeps.
  sessions as (
    select h.* from held h
     where p_birth_year is null
        or exists (select 1 from counted c where c.training_session_id = h.id)
  ),
  per_athlete as (
    select c.athlete_id,
           count(*)::int                                  as bookings,
           count(*) filter (where not c.paid)::int        as unpaid,
           count(*) filter (where c.came = 1)::int        as present,
           count(*) filter (where c.came is not null)::int as marked
      from counted c
     group by c.athlete_id
  ),
  -- Main coach and assistants of each kept training, for `Trenéři`.
  staffing as (
    select s.id as session_id, s.main_coach_profile_id as profile_id from sessions s
     where s.main_coach_profile_id is not null
    union
    select c.training_session_id, c.profile_id
      from public.training_session_coaches c
      join sessions s on s.id = c.training_session_id
  )
  select jsonb_build_object(
    'sessions', (select count(*) from sessions),
    'sessions_as_main', (select count(*) from sessions s
                          where p_coach_id is not null and s.main_coach_profile_id = p_coach_id),
    'booked', (select count(*) from booking b join sessions s on s.id = b.training_session_id),
    'capacity', (select coalesce(sum(s.capacity), 0) from sessions s),
    'present', (select count(*) from counted where came = 1),
    'marked', (select count(*) from counted where came is not null),
    'paid', (select count(*) from counted where paid),
    'bookings', (select count(*) from counted),
    'unpaid', coalesce((
      select jsonb_agg(jsonb_build_object(
               'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
               'birth_year', extract(year from a.date_of_birth)::int, 'count', p.unpaid)
             order by p.unpaid desc, a.last_name, a.first_name)
        from per_athlete p join public.athletes a on a.id = p.athlete_id
       where p.unpaid > 0), '[]'::jsonb),
    -- Everyone with at least three trainings, lowest first; the screen takes
    -- the top three and shows the rest behind `Všichni hráči`.
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
               'birth_year', extract(year from a.date_of_birth)::int,
               'present', p.present, 'marked', p.marked, 'bookings', p.bookings)
             order by (p.present::numeric / nullif(p.marked, 0)) asc nulls last,
                      a.last_name, a.first_name)
        from per_athlete p join public.athletes a on a.id = p.athlete_id
       where p.bookings >= 3 and p.marked > 0), '[]'::jsonb),
    'coaches', case when v_admin and not p_personal then coalesce((
      select jsonb_agg(row order by (row ->> 'sessions')::int desc, row ->> 'name')
        from (
          select jsonb_build_object(
                   'profile_id', st.profile_id,
                   'name', pr.display_name,
                   'sessions', count(distinct st.session_id),
                   'present', (select count(*) from counted c
                                join staffing x on x.session_id = c.training_session_id
                               where x.profile_id = st.profile_id and c.came = 1),
                   'marked', (select count(*) from counted c
                               join staffing x on x.session_id = c.training_session_id
                              where x.profile_id = st.profile_id and c.came is not null)) as row
            from staffing st
            join public.app_profiles pr on pr.id = st.profile_id
           group by st.profile_id, pr.display_name
        ) per_coach), '[]'::jsonb) end,
    'buckets', case when p_bucket is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', bucket, 'present', present, 'marked', marked) order by bucket)
        from (
          select case when p_bucket = 'month'
                      then to_char(s.local_start, 'YYYY-MM')
                      else least(4, ((extract(day from s.local_start)::int - 1) / 7) + 1)::text
                 end as bucket,
                 count(*) filter (where c.came = 1)::int         as present,
                 count(*) filter (where c.came is not null)::int as marked
            from counted c join sessions s on s.id = c.training_session_id
           group by 1
        ) per_bucket), '[]'::jsonb) end,
    -- K20b's list: the trainings this coach led, newest first.
    'led', case when not p_personal then null else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'start_at', s.start_at, 'end_at', s.end_at,
               'facility_code', f.code, 'capacity', s.capacity,
               'booked', (select count(*) from booking b where b.training_session_id = s.id),
               'present', (select count(*) from booking b
                            where b.training_session_id = s.id and b.came = 1))
             order by s.start_at desc)
        from sessions s
        left join public.facilities f on f.id = s.facility_id
       where s.main_coach_profile_id = p_coach_id), '[]'::jsonb) end,
    'is_admin', v_admin
  ) into v_result;

  return jsonb_build_object('ok', true, 'data', v_result);
end;
$$;

revoke all on function public.workspace_statistics(uuid, timestamptz, timestamptz, integer, uuid, boolean, text, boolean) from public;
grant execute on function public.workspace_statistics(uuid, timestamptz, timestamptz, integer, uuid, boolean, text, boolean) to authenticated;
