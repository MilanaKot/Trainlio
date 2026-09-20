-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS (repair)
-- 20 — repairing occupancy drift
--
-- Migration 18 added the assert that finds drift. This adds the supported way
-- to fix it, which the assert on its own left missing.
--
-- Writing the runbook is what exposed the gap. The procedure it first carried
-- was to touch a booking row and let the projection trigger recompute — and
-- that does not work: the trigger fires on `update of status`, not on any
-- write, so touching `updated_at` changes nothing. The only thing that repaired
-- drift was a real booking or cancellation, which means an operator's choices
-- were to wait for a parent, or to fake a status change and put a false entry
-- in the audit log.
--
-- Neither is acceptable for the one projection the whole booking design rests
-- on, so the repair is a function, it says what it changed, and it records that
-- it happened.

alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    'SESSION_CREATED',
    'SESSION_UPDATED',
    'SESSION_CAPACITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED',
    'SESSION_ELIGIBILITY_NARROWED',
    'SESSION_BOOKING_CLOSED',
    'SESSION_BOOKING_REOPENED',
    'SESSION_CANCELLED',
    'SESSION_SERIES_CREATED',
    'SESSION_DUPLICATED',
    'BOOKING_CREATED_BY_GUARDIAN',
    'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN',
    'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED',
    'ATHLETE_ANONYMIZED',
    -- An operator corrected the projection. Recorded because a count that
    -- changed without a booking changing is exactly the thing someone will
    -- later need explained.
    'OCCUPANCY_REPAIRED'
  )
);

-- ---------------------------------------------------------------------------
-- Recompute the projection from the bookings.
--
-- With no argument, every drifting session; with one, that session alone. The
-- occupancy row is locked first, for the same reason every booking path locks
-- it: a repair running while a parent books would otherwise write a count that
-- was true a moment ago.
--
-- A session with no projection row is NOT created here. That case means a
-- trigger did not fire when the session was created, and silently conjuring the
-- row would destroy the evidence of a fault that can let two parents take the
-- same last place. sessions_without_occupancy() reports it; a person decides.
-- ---------------------------------------------------------------------------

create or replace function public.repair_occupancy(p_training_session_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repairs jsonb := '[]'::jsonb;
  v_row     record;
begin
  for v_row in
    select o.training_session_id, o.confirmed_count as projected,
           (select count(*) from public.bookings b
             where b.training_session_id = o.training_session_id
               and b.status = 'CONFIRMED') as actual,
           s.workspace_id
    from public.training_session_occupancy o
    join public.training_sessions s on s.id = o.training_session_id
    where (p_training_session_id is null or o.training_session_id = p_training_session_id)
    for update of o
  loop
    if v_row.projected = v_row.actual then
      continue;
    end if;

    update public.training_session_occupancy o
       set confirmed_count = v_row.actual,
           updated_at = now()
     where o.training_session_id = v_row.training_session_id;

    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
    values
      (v_row.workspace_id, null, 'OCCUPANCY_REPAIRED', 'TRAINING_SESSION',
       v_row.training_session_id,
       jsonb_build_object('confirmed_count', v_row.projected),
       jsonb_build_object('confirmed_count', v_row.actual));

    v_repairs := v_repairs || jsonb_build_object(
      'training_session_id', v_row.training_session_id,
      'was', v_row.projected,
      'now', v_row.actual);
  end loop;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'repaired', jsonb_array_length(v_repairs),
    'sessions', v_repairs,
    -- Surfaced alongside, because an operator reaching for a repair is exactly
    -- the person who needs to know a session has no row to repair.
    'sessions_without_occupancy',
      (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.sessions_without_occupancy() id)
  ));
end;
$$;

revoke all on function public.repair_occupancy(uuid) from public, anon, authenticated;
grant execute on function public.repair_occupancy(uuid) to service_role;
