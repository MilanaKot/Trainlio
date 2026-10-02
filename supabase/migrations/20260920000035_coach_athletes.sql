-- Trainlio — Sports Training Booking Platform
-- Layer: OPERATIONAL DATA + DOMAIN OPERATIONS
-- 35 — the coach's athletes (handoff v3, DR-01: coach/SPEC.md §K12, §K13)
--
-- The `Sportovci` tab shipped as a flat list of names, because the first
-- handoff did not design it. v3 does, and asks for three things this schema
-- could not answer:
--
--   1. **How many trainings each athlete has coming.** A coach scanning the
--      list wants to know who is not signed up for anything.
--   2. **The family, on the athlete's own screen** — every active guardian with
--      their number, and the search on the list matching their names. A coach
--      could reach a number through `booking_guardians()` for one booking
--      (migration 22); an athlete who is booked into nothing had no door at all,
--      which is exactly the athlete a coach needs to ring about.
--   3. **A note about the athlete**, for the staff only — the same thing
--      `training_session_internal_notes` is for a session (D-13), and built the
--      same way: its own table, so no guardian-facing read path can return it
--      by mistake.
--
-- What this does NOT add is any way for a coach to change an athlete. §K13 is
-- read-only but for the note: the profile belongs to the parent, who edits it
-- in their own app, and a coach who could edit it would be editing somebody
-- else's record of their own child.

-- ---------------------------------------------------------------------------
-- The note. One per athlete per workspace: the same child may train at two
-- clubs, and what one club's staff writes down is not the other's business.
-- ---------------------------------------------------------------------------

create table public.athlete_internal_notes (
  athlete_id   uuid not null references public.athletes(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  notes        text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.app_profiles(id) on delete restrict,
  primary key (athlete_id, workspace_id),
  constraint athlete_internal_notes_length check (notes is null or length(notes) <= 200)
);

alter table public.athlete_internal_notes enable row level security;

comment on table public.athlete_internal_notes is
  'D-13, §K13: what the staff of one workspace note about an athlete. Never guardian-readable — a separate table rather than a column, so no guardian-facing select can return it by accident.';

-- D-13 again: staff only, and only of the workspace the note belongs to. A
-- guardian's select returns no rows, not a null column.
create policy athlete_internal_notes_select_staff on public.athlete_internal_notes
  for select to authenticated
  using (public.is_workspace_coach(workspace_id));

grant select on public.athlete_internal_notes to authenticated;
-- Writing goes through the function below, which checks that the athlete is
-- actually a member of that workspace. A grant would not.

-- ---------------------------------------------------------------------------
-- The list (§K12).
--
-- One row per athlete of the workspace, with the two things the design shows
-- that a table query cannot reach: how many trainings they still have, and the
-- names of their guardians — which the search matches, because a coach looking
-- for a child often remembers the parent.
--
-- Numbers are not here. §K12 says the row carries no telephone, and a list of
-- sixty families' numbers is not what a coach reading a list needs; K13 returns
-- one family's when the coach opens one.
-- ---------------------------------------------------------------------------

create or replace function public.coach_athletes(p_workspace_id uuid)
returns table (
  athlete_id      uuid,
  first_name      text,
  last_name       text,
  date_of_birth   date,
  is_active       boolean,
  attributes      jsonb,
  photo_path      text,
  upcoming_count  integer,
  guardian_names  text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.first_name,
    a.last_name,
    a.date_of_birth,
    a.is_active,
    (select sp.attributes
       from public.athlete_sport_profiles sp
       join public.workspaces w on w.id = p_workspace_id
      where sp.athlete_id = a.id and sp.sport_id = w.primary_sport_id),
    a.photo_path,
    (select count(*)::int
       from public.bookings b
       join public.training_sessions s on s.id = b.training_session_id
      where b.athlete_id = a.id
        and b.status = 'CONFIRMED'
        and s.workspace_id = p_workspace_id
        and s.status <> 'CANCELLED'
        and s.start_at > now()),
    (select coalesce(array_agg(p.display_name order by p.display_name), '{}')
       from public.guardian_athlete_access g
       join public.app_profiles p on p.id = g.profile_id
      where g.athlete_id = a.id
        and g.status = 'ACTIVE'
        and p.display_name is not null)
  from public.athletes a
  join public.workspace_athlete_memberships m on m.athlete_id = a.id
  where m.workspace_id = p_workspace_id
    and m.is_active
    and public.is_workspace_coach(p_workspace_id)
  order by a.last_name, a.first_name;
$$;

revoke all on function public.coach_athletes(uuid) from public;
grant execute on function public.coach_athletes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The family of one athlete (§K13).
--
-- `booking_guardians()` answers the same question per booking, and deliberately
-- so: a roster of twenty children must not put twenty families' numbers on the
-- wire to answer a question about one. This is the other half of that rule —
-- one athlete at a time, opened on purpose, and only by the staff of a club the
-- child actually trains at.
--
-- Every active guardian, not "the parent": BR-002 has allowed several since the
-- first migration, and a second parent should not be hidden from a coach trying
-- to reach the family.
-- ---------------------------------------------------------------------------

create or replace function public.athlete_guardians(p_athlete_id uuid)
returns table (
  profile_id        uuid,
  display_name      text,
  relationship_code text,
  phone             text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, g.relationship_code, p.phone
  from public.guardian_athlete_access g
  join public.app_profiles p on p.id = g.profile_id
  where g.athlete_id = p_athlete_id
    and g.status = 'ACTIVE'
    and p.anonymized_at is null
    and public.coach_can_see_athlete(p_athlete_id)
  order by p.display_name nulls last, p.id;
$$;

revoke all on function public.athlete_guardians(uuid) from public;
grant execute on function public.athlete_guardians(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The athlete's trainings at this club (§K13), past and future.
--
-- Scoped to the workspace: a coach reads what this child does here, not their
-- week at another club.
-- ---------------------------------------------------------------------------

create or replace function public.coach_athlete_sessions(
  p_workspace_id uuid,
  p_athlete_id   uuid
)
returns table (
  training_session_id uuid,
  start_at            timestamptz,
  end_at              timestamptz,
  status              public.session_status,
  facility_code       text,
  booking_status      public.booking_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.start_at, s.end_at, s.status, f.code, b.status
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  left join public.facilities f on f.id = s.facility_id
  where b.athlete_id = p_athlete_id
    and s.workspace_id = p_workspace_id
    and public.is_workspace_coach(p_workspace_id)
  order by s.start_at desc;
$$;

revoke all on function public.coach_athlete_sessions(uuid, uuid) from public;
grant execute on function public.coach_athlete_sessions(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Writing the note (§K13).
--
-- A function rather than a grant, for the same reason `set_member_name` is one:
-- the check is not "this row" but "this athlete trains here and I am staff
-- here", which no row policy on an empty table can express for an insert.
--
-- Not audited. The audit log records changes to bookings and sessions — what
-- the club owes an account of — and a coach's note about a child is a working
-- memo whose own table carries who last touched it and when.
-- ---------------------------------------------------------------------------

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

revoke all on function public.set_athlete_internal_note(uuid, uuid, text) from public;
grant execute on function public.set_athlete_internal_note(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- D-18: the note goes when the child is forgotten.
--
-- `anonymize_profile` is restated with one statement added. An athlete is
-- anonymised by being renamed, not by a stamp, so there is nothing for a
-- trigger to watch — and a trigger matching the sentinel name would break the
-- day the sentinel changes.
-- ---------------------------------------------------------------------------

create or replace function public.anonymize_profile(
  p_profile_id         uuid,
  p_reason             text default null,
  p_anonymize_athletes boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile   record;
  v_preview   jsonb;
  v_scrubbed  integer := 0;
  v_revoked   integer := 0;
  v_athletes  integer := 0;
  v_workspace uuid;
begin
  select * into v_profile from public.app_profiles p where p.id = p_profile_id;
  if v_profile.id is null then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;

  if v_profile.anonymized_at is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_ANONYMIZED',
      'details', jsonb_build_object('anonymized_at', v_profile.anonymized_at));
  end if;

  -- Taken before anything changes: afterwards there is nothing left to count.
  v_preview := public.anonymization_preview(p_profile_id);

  -- The audit entries come first, while the display name still says who this
  -- was. After the update the log holds an opaque id, which is correct for the
  -- retained record and useless for the entry that explains it.
  for v_workspace in
    select distinct s.workspace_id
    from public.bookings b
    join public.training_sessions s on s.id = b.training_session_id
    where b.created_by = p_profile_id or b.cancelled_by = p_profile_id
    union
    select distinct m.workspace_id from public.workspace_members m where m.profile_id = p_profile_id
    union
    select distinct a.workspace_id from public.audit_log a where a.actor_profile_id = p_profile_id
  loop
    insert into public.audit_log
      (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after, metadata)
    values
      (v_workspace, null, 'PROFILE_ANONYMIZED', 'PROFILE', p_profile_id,
       jsonb_build_object('display_name', v_profile.display_name,
                          'had_login', v_profile.auth_user_id is not null),
       jsonb_build_object('display_name', null, 'had_login', false),
       jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''),
                          'preview', v_preview));
  end loop;

  -- actor_profile_id is null above on purpose: the erasure is performed by an
  -- administrator outside any user session, and naming the subject as their own
  -- actor would be wrong.

  update public.notification_deliveries d
     set recipient_email = null
   where d.recipient_profile_id = p_profile_id
     and d.recipient_email is not null;
  get diagnostics v_scrubbed = row_count;

  update public.guardian_athlete_access g
     set status = 'REVOKED'
   where g.profile_id = p_profile_id and g.status = 'ACTIVE';
  get diagnostics v_revoked = row_count;

  update public.workspace_members m
     set is_active = false
   where m.profile_id = p_profile_id and m.is_active;

  if p_anonymize_athletes then
    update public.athletes a
       set first_name = 'Anonymizováno',
           last_name  = '—',
           is_active  = false,
           photo_path = null
     where a.id in (
       select (value ->> 'athlete_id')::uuid
       from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));
    get diagnostics v_athletes = row_count;

    -- Migration 35. A coach's note about a child is text about a person, and
    -- the person has asked to be forgotten. Here rather than in a trigger on
    -- `athletes`, because an athlete is anonymised by being renamed rather than
    -- stamped — there is no column for a trigger to watch, and a trigger
    -- matching the sentinel name would be the kind of thing that breaks the
    -- day the sentinel changes.
    delete from public.athlete_internal_notes n
     where n.athlete_id in (
       select (value ->> 'athlete_id')::uuid
       from jsonb_array_elements(v_preview -> 'athletes_left_without_guardian'));
  end if;

  update public.app_profiles p
     set display_name  = null,
         anonymized_at = now(),
         auth_user_id  = null
   where p.id = p_profile_id;

  -- Last, and only after the profile is detached: the ON DELETE SET NULL would
  -- have done this anyway, but doing it explicitly first means the erasure does
  -- not depend on a cascade to have severed the link.
  if v_profile.auth_user_id is not null then
    delete from auth.users u where u.id = v_profile.auth_user_id;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'profile_id', p_profile_id,
    'emails_scrubbed', v_scrubbed,
    'guardian_links_revoked', v_revoked,
    'athletes_anonymized', v_athletes,
    'preview', v_preview
  ));
end;
$$;

revoke all on function public.anonymize_profile(uuid, text, boolean) from public;
revoke all on function public.anonymize_profile(uuid, text, boolean) from authenticated;
grant execute on function public.anonymize_profile(uuid, text, boolean) to service_role;
