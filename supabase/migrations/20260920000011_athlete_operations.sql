-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 11 — athlete creation and sport profiles
--
-- Contract: docs/DOMAIN_OPERATIONS.md.
--
-- Both functions return jsonb rather than raising, so the UI can render a
-- specific Czech message:
--
--   { "ok": true,  "data": { … } }
--   { "ok": false, "code": "…", "details": { … } }
--
-- Neither returns a database error message. The codes are the contract; raw
-- messages would leak schema detail to a client and are not translatable.

-- ---------------------------------------------------------------------------
-- Athlete, guardian access, sport profile and workspace membership, in one
-- transaction (approved; M-08).
--
-- Why this cannot be four client statements: RLS grants no INSERT on athletes,
-- and for good reason. A bare insert that succeeded and then failed before the
-- guardian_athlete_access row would strand an athlete that no policy can ever
-- select again — invisible to the parent who created it, and undeletable
-- because nothing may be hard-deleted.
--
-- D-10: the workspace membership is created here. Creating a hockey profile is
-- what makes the child visible to that workspace's coaches, and that is what
-- makes booking possible. There is no separate join step in MVP, and the UI
-- says so before the parent submits.
-- ---------------------------------------------------------------------------

create or replace function public.create_athlete_with_guardian(
  p_first_name       text,
  p_last_name        text,
  p_date_of_birth    date,
  p_workspace_id     uuid,
  p_sport_code       text,
  p_attributes       jsonb default '{}'::jsonb,
  p_club_name        text default null,
  p_team_or_category text default null,
  p_jersey_number    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id    uuid := public.current_profile_id();
  v_sport_id      uuid;
  v_workspace     record;
  v_athlete_id    uuid;
  v_profile_row   uuid;
  v_membership_id uuid;
begin
  if v_profile_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  -- Validated here as well as by constraint, so the parent gets a field-level
  -- message instead of a constraint violation.
  if p_first_name is null or length(btrim(p_first_name)) = 0
     or p_last_name is null or length(btrim(p_last_name)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
  end if;

  if p_date_of_birth is null
     or p_date_of_birth <= date '1900-01-01'
     or p_date_of_birth > current_date then
    return jsonb_build_object('ok', false, 'code', 'INVALID_DATE_OF_BIRTH');
  end if;

  select s.id into v_sport_id from public.sports s where s.code = p_sport_code;
  if v_sport_id is null then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_FOUND');
  end if;

  select w.id, w.primary_sport_id, w.is_active into v_workspace
  from public.workspaces w where w.id = p_workspace_id;

  if v_workspace.id is null or not v_workspace.is_active then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
  end if;

  -- Caught before the insert so the composite foreign key never has to: the
  -- membership is what ties an athlete to a workspace, and it may only carry
  -- that workspace's own sport.
  if v_workspace.primary_sport_id <> v_sport_id then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end if;

  -- The four inserts share this block's implicit savepoint, so a failure in any
  -- of them rolls back all of them and the function still returns a structured
  -- error rather than raising. That is what makes "all or nothing" true without
  -- relying on the caller to manage a transaction.
  begin
    insert into public.athletes (first_name, last_name, date_of_birth)
    values (btrim(p_first_name), btrim(p_last_name), p_date_of_birth)
    returning id into v_athlete_id;

    insert into public.guardian_athlete_access
      (profile_id, athlete_id, permission_level, status)
    values (v_profile_id, v_athlete_id, 'MANAGE', 'ACTIVE');

    insert into public.athlete_sport_profiles
      (athlete_id, sport_id, club_name, team_or_category, jersey_number, attributes)
    values (
      v_athlete_id,
      v_sport_id,
      nullif(btrim(coalesce(p_club_name, '')), ''),
      nullif(btrim(coalesce(p_team_or_category, '')), ''),
      nullif(btrim(coalesce(p_jersey_number, '')), ''),
      coalesce(p_attributes, '{}'::jsonb)
    )
    returning id into v_profile_row;

    insert into public.workspace_athlete_memberships
      (workspace_id, athlete_id, athlete_sport_profile_id, sport_id)
    values (p_workspace_id, v_athlete_id, v_profile_row, v_sport_id)
    returning id into v_membership_id;
  exception
    when invalid_parameter_value then
      -- Raised by the per-sport attribute trigger: an unknown position, stick
      -- side, or an attribute key that is not part of this sport.
      return jsonb_build_object('ok', false, 'code', 'INVALID_SPORT_ATTRIBUTES');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ATHLETE_DATA');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_PROFILE_EXISTS');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'athlete_id', v_athlete_id,
      'athlete_sport_profile_id', v_profile_row,
      'workspace_athlete_membership_id', v_membership_id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Add or update one sport profile on an existing athlete.
--
-- Also ensures the workspace membership, which is why this exists rather than
-- letting the client insert through the row policy: an athlete_sport_profiles
-- row without a matching membership is a profile the coach cannot see and the
-- athlete cannot be booked with — broken in a way nothing reports.
--
-- AC-101: writes exactly one (athlete, sport) row, so editing a hockey profile
-- cannot touch a swimming one.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_athlete_sport_profile(
  p_athlete_id       uuid,
  p_sport_code       text,
  p_attributes       jsonb default '{}'::jsonb,
  p_club_name        text default null,
  p_team_or_category text default null,
  p_jersey_number    text default null,
  p_workspace_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sport_id      uuid;
  v_workspace     record;
  v_profile_row   uuid;
  v_membership_id uuid;
begin
  if public.current_profile_id() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.has_athlete_manage_access(p_athlete_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  select s.id into v_sport_id from public.sports s where s.code = p_sport_code;
  if v_sport_id is null then
    return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_FOUND');
  end if;

  if p_workspace_id is not null then
    select w.id, w.primary_sport_id, w.is_active into v_workspace
    from public.workspaces w where w.id = p_workspace_id;

    if v_workspace.id is null or not v_workspace.is_active then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_NOT_FOUND');
    end if;

    if v_workspace.primary_sport_id <> v_sport_id then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
    end if;
  end if;

  begin
    insert into public.athlete_sport_profiles
      (athlete_id, sport_id, club_name, team_or_category, jersey_number, attributes)
    values (
      p_athlete_id,
      v_sport_id,
      nullif(btrim(coalesce(p_club_name, '')), ''),
      nullif(btrim(coalesce(p_team_or_category, '')), ''),
      nullif(btrim(coalesce(p_jersey_number, '')), ''),
      coalesce(p_attributes, '{}'::jsonb)
    )
    on conflict (athlete_id, sport_id) do update
      set club_name        = excluded.club_name,
          team_or_category = excluded.team_or_category,
          jersey_number    = excluded.jersey_number,
          attributes       = excluded.attributes,
          is_active        = true
    returning id into v_profile_row;

    if p_workspace_id is not null then
      insert into public.workspace_athlete_memberships
        (workspace_id, athlete_id, athlete_sport_profile_id, sport_id)
      values (p_workspace_id, p_athlete_id, v_profile_row, v_sport_id)
      on conflict (workspace_id, athlete_id, athlete_sport_profile_id) do update
        set is_active = true
      returning id into v_membership_id;
    end if;
  exception
    when invalid_parameter_value then
      return jsonb_build_object('ok', false, 'code', 'INVALID_SPORT_ATTRIBUTES');
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ATHLETE_DATA');
    when foreign_key_violation then
      return jsonb_build_object('ok', false, 'code', 'SPORT_NOT_IN_WORKSPACE');
  end;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'athlete_sport_profile_id', v_profile_row,
      'workspace_athlete_membership_id', v_membership_id
    )
  );
end;
$$;

revoke all on function public.create_athlete_with_guardian(text, text, date, uuid, text, jsonb, text, text, text) from public;
grant execute on function public.create_athlete_with_guardian(text, text, date, uuid, text, jsonb, text, text, text) to authenticated;

revoke all on function public.upsert_athlete_sport_profile(uuid, text, jsonb, text, text, text, uuid) from public;
grant execute on function public.upsert_athlete_sport_profile(uuid, text, jsonb, text, text, text, uuid) to authenticated;
