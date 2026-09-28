-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 26 — assistant coaches
--
-- coach/SPEC.md §K3b and §K3c, guardian/SPEC.md §G6. The schema has held
-- assistants since the first migration — `coach_session_role` is MAIN or
-- ASSISTANT, the association table is keyed on both — and nothing could ever
-- write one. `create_training_session` inserts the MAIN row and
-- `update_training_session` moves it; neither has ever mentioned the other
-- role, so every `Asistenti` row a parent or a coach would read has been empty
-- since the beginning.
--
-- Assistants are deliberately not a notifiable change (coach/SPEC.md §4): the
-- training is at the same time, in the same hall, with the same main coach, and
-- a parent does not need an e-mail because a second adult will be on the ice.
-- The outbox is untouched. The audit log is not — a coach changed who is on a
-- session, and that is exactly what it is for.

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
    -- Not significant enough to e-mail a parent about, and still a change to
    -- who runs a training.
    'SESSION_ASSISTANTS_CHANGED',
    'BOOKING_CREATED_BY_GUARDIAN',
    'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN',
    'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED',
    'ATHLETE_ANONYMIZED',
    'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED',
    'MEMBER_ADDED',
    'MEMBER_ACTIVATED',
    'MEMBER_DEACTIVATED'
  )
);

-- ---------------------------------------------------------------------------
-- Promoting an assistant to main coach.
--
-- A latent break that §K3c walks straight into: it says a coach who is
-- currently an assistant may be chosen as main coach, and shows them with
-- "Nyní asistent — po výběru se z asistentů odebere". `update_training_session`
-- moves the main coach by rewriting the MAIN row's profile_id, and the
-- association table is keyed on (session, profile) — so that write collides
-- with the assistant row the same person already holds. Its exception block
-- catches a check violation and a foreign key violation; a unique violation is
-- neither, so the whole call would have failed with an unhandled error rather
-- than a code the interface could explain.
--
-- Nothing could reach it before this migration, because nothing could create an
-- assistant. Removing the old row first is what makes the promotion the
-- specification describes actually work.
-- ---------------------------------------------------------------------------

create or replace function public.demote_assistant_on_main_coach_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'MAIN' and new.profile_id is distinct from old.profile_id then
    delete from public.training_session_coaches c
     where c.training_session_id = new.training_session_id
       and c.profile_id = new.profile_id
       and c.role = 'ASSISTANT';
  end if;
  return new;
end;
$$;

revoke all on function public.demote_assistant_on_main_coach_change() from public;

create trigger trg_session_coaches_demote_assistant
  before update on public.training_session_coaches
  for each row execute function public.demote_assistant_on_main_coach_change();

-- ---------------------------------------------------------------------------
-- The assistants of one session, as a set.
--
-- Replace rather than add-and-remove, because that is what the sheet does: a
-- coach ticks boxes and presses Hotovo, and the result is the list they see. An
-- add/remove pair would make the outcome depend on what the client believed was
-- there when it opened.
-- ---------------------------------------------------------------------------

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

revoke all on function public.set_session_assistants(uuid, uuid[]) from public;
grant execute on function public.set_session_assistants(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is on a session, for the screens that show it.
--
-- Guardians can already select the association table for a published session,
-- and since migration 23 they can read the names on it. This exists so both
-- sides read the same ordering and the same shape rather than each assembling
-- it, and so the main coach and the assistants arrive together.
-- ---------------------------------------------------------------------------

create or replace function public.session_coaches(p_training_session_id uuid)
returns table (
  profile_id   uuid,
  display_name text,
  role         public.coach_session_role
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, c.role
  from public.training_session_coaches c
  join public.training_sessions s on s.id = c.training_session_id
  join public.app_profiles p on p.id = c.profile_id
  where c.training_session_id = p_training_session_id
    and (public.is_workspace_coach(s.workspace_id)
         or (s.status <> 'DRAFT' and public.guardian_can_see_workspace(s.workspace_id)))
  -- MAIN first, then by name: the order the detail screen renders.
  order by c.role, p.display_name nulls last, p.id;
$$;

revoke all on function public.session_coaches(uuid) from public;
grant execute on function public.session_coaches(uuid) to authenticated;
