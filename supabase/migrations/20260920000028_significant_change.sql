-- Trainlio — Sports Training Booking Platform
-- Layer: OPERATIONAL DATA
-- 28 — what changed, not only that something did
--
-- Design: docs/design/guardian/SPEC.md §G4, §G6.
--
-- `significant_changed_at` records *that* a training moved (D-11). The parent's
-- screens have to say what moved and what it was before: the card's meta line
-- starts `Původně …`, and the booking detail reads
-- `Trenér změnil čas tréninku / Původně 17:00–18:00, nově 17:30–18:30.`
--
-- The previous values exist in `audit_log`, but that table is staff-only by
-- design and its `before` payload is whatever the operation happened to record.
-- Opening it to guardians would mean filtering columns in a definer function
-- and getting that filter right for every future action. This stores exactly
-- the guardian-visible values instead, beside the row they describe.

alter table public.training_sessions
  add column if not exists significant_change jsonb;

comment on column public.training_sessions.significant_change is
  'The most recent significant change, as a guardian reads it: {changed_at, fields[], previous{}}. Names and codes are snapshotted, not referenced, so a renamed or deleted facility cannot rewrite what a parent was told.';

alter table public.training_sessions
  add constraint training_sessions_significant_change_shape check (
    significant_change is null
    or (
      jsonb_typeof(significant_change -> 'fields') = 'array'
      and jsonb_array_length(significant_change -> 'fields') > 0
      and jsonb_typeof(significant_change -> 'previous') = 'object'
      and significant_change ? 'changed_at'
    )
  );

-- ---------------------------------------------------------------------------
-- Record the difference whenever a session is updated.
--
-- A trigger rather than a branch inside update_training_session, for one
-- practical reason: that function changes the main coach through
-- `training_session_coaches`, and the mirror column on this table follows by
-- its own trigger in a *second* statement. Detection inside the function would
-- compare a mirror that has not moved yet and miss every coach change.
--
-- Two statements of one change therefore have to merge, while a genuinely
-- later change has to replace. `changed_at` is the discriminator: it is the
-- `significant_changed_at` the record was written under, so the mirror update —
-- which does not re-stamp it — merges, and the next real change does not.
--
-- Only the latest change is kept, which is what both screens draw. A parent
-- who booked before two changes is told about the second; the first reached
-- them by e-mail when it happened, and `significant_changed_at > created_at`
-- already hides a change that predates their booking.
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

  if old.main_coach_profile_id is distinct from new.main_coach_profile_id then
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

comment on function public.record_significant_change() is
  'Keeps training_sessions.significant_change in step with significant_changed_at (D-11, guardian/SPEC.md §G4).';

drop trigger if exists trg_training_sessions_significant_change on public.training_sessions;

create trigger trg_training_sessions_significant_change
  before update on public.training_sessions
  for each row
  execute function public.record_significant_change();
