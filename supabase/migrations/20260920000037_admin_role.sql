-- Trainlio — Sports Training Booking Platform
-- Layer: DOMAIN OPERATIONS
-- 37 — the administrator's role, in the interface (handoff v3, DR-08: §A3, §A3d, §A3e)
--
-- `workspace_role` has been COACH or WORKSPACE_ADMIN since migration 1, and
-- nothing in the application ever read or wrote it: admin/SPEC.md left it as an
-- open question answered "assume DB-only". With one club and one administrator
-- that holds; it stops holding the moment a second club arrives, or the one
-- administrator leaves.
--
-- Three rules, and the UI explains them rather than enforcing them:
--
--   * any administrator may grant or revoke the role, including to a coach who
--     has not signed in yet — the grant is on the membership, so it is simply
--     true when they arrive;
--   * the last active administrator cannot lose it, by any path: not by having
--     it revoked, not by revoking it themselves, and not by being deactivated
--     (migration 21 already refuses that one);
--   * revoking your own is a decision with a confirmation, because the screen
--     that let you do it disappears afterwards (§A3e).

alter table public.audit_log drop constraint audit_log_action_known;
alter table public.audit_log add constraint audit_log_action_known check (
  action in (
    'SESSION_CREATED', 'SESSION_UPDATED', 'SESSION_CAPACITY_CHANGED',
    'SESSION_MAIN_COACH_CHANGED', 'SESSION_ELIGIBILITY_NARROWED',
    'SESSION_BOOKING_CLOSED', 'SESSION_BOOKING_REOPENED', 'SESSION_CANCELLED',
    'SESSION_SERIES_CREATED', 'SESSION_DUPLICATED', 'SESSION_ASSISTANTS_CHANGED',
    'BOOKING_CREATED_BY_GUARDIAN', 'BOOKING_CREATED_BY_COACH',
    'BOOKING_CAPACITY_OVERRIDDEN', 'BOOKING_CANCELLED_BY_GUARDIAN',
    'BOOKING_CANCELLED_BY_COACH',
    'PROFILE_ANONYMIZED', 'ATHLETE_ANONYMIZED', 'OCCUPANCY_REPAIRED',
    'MEMBER_NAME_CHANGED', 'MEMBER_ADDED', 'MEMBER_ACTIVATED', 'MEMBER_DEACTIVATED',
    'MEMBER_CONTACT_CHANGED', 'MEMBER_ACCESS_CHANGED', 'MEMBER_INVITED',
    -- Who may administer the club, and who decided it.
    'MEMBER_ROLE_CHANGED',
    'WORKSPACE_LOGO_CHANGED', 'WORKSPACE_IDENTITY_CHANGED'
  )
);

create or replace function public.set_member_role(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_is_admin     boolean,
  p_confirm_self boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.current_profile_id();
  v_was    boolean;
  v_others integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if not exists (
    select 1
      from public.workspace_members m
      join public.app_profiles p on p.id = m.profile_id
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.is_active
       and p.anonymized_at is null
  ) then
    -- Including a deactivated coach: there is no such thing as an inactive
    -- administrator, and granting the role to one would be a surprise waiting
    -- for the day they come back.
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  v_was := exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.role         = 'WORKSPACE_ADMIN'
       and m.is_active
  );

  if v_was = p_is_admin then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if p_is_admin then
    insert into public.workspace_members (workspace_id, profile_id, role, is_active)
    values (p_workspace_id, p_profile_id, 'WORKSPACE_ADMIN', true)
    on conflict (workspace_id, profile_id, role) do update set is_active = true;
  else
    select count(*)::int into v_others
      from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
       and m.profile_id <> p_profile_id;

    if v_others = 0 then
      return jsonb_build_object('ok', false, 'code', 'LAST_ADMIN');
    end if;

    -- §A3e. The screen that offers this is the screen it takes away, so the
    -- confirmation is a server-side gate rather than a dialog the client may
    -- or may not have shown.
    if p_profile_id = v_actor and not p_confirm_self then
      return jsonb_build_object('ok', false, 'code', 'CONFIRM_SELF',
        'details', jsonb_build_object('other_admins', v_others));
    end if;

    -- A coach row first: a person who held only the administrator role must
    -- not fall off the staff when it goes.
    insert into public.workspace_members (workspace_id, profile_id, role, is_active)
    values (p_workspace_id, p_profile_id, 'COACH', true)
    on conflict (workspace_id, profile_id, role) do update set is_active = true;

    delete from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.role         = 'WORKSPACE_ADMIN';
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor, 'MEMBER_ROLE_CHANGED', 'PROFILE', p_profile_id,
     jsonb_build_object('is_admin', v_was),
     jsonb_build_object('is_admin', p_is_admin, 'self', p_profile_id = v_actor));

  return jsonb_build_object('ok', true, 'is_admin', p_is_admin);
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, boolean, boolean) from public;
grant execute on function public.set_member_role(uuid, uuid, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Deactivation takes the role with it (§A3).
--
-- Restated from migration 21 with one block added; everything above it — the
-- last-administrator guard, the future-sessions confirmation, the audit entry —
-- is as it was.
-- ---------------------------------------------------------------------------

create or replace function public.set_member_active(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_is_active    boolean,
  p_confirm      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := public.current_profile_id();
  v_was      boolean;
  v_future   integer;
  v_admins   integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  if not public.is_workspace_admin(p_workspace_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select bool_or(m.is_active) into v_was
    from public.workspace_members m
    join public.app_profiles p on p.id = m.profile_id
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id
     and p.anonymized_at is null;

  if v_was is null then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_NOT_FOUND');
  end if;

  if v_was = p_is_active then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  if not p_is_active then
    select count(*) into v_admins
      from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.role = 'WORKSPACE_ADMIN'
       and m.is_active
       and m.profile_id <> p_profile_id;

    if v_admins = 0 and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = p_workspace_id
         and m.profile_id = p_profile_id
         and m.role = 'WORKSPACE_ADMIN'
         and m.is_active
    ) then
      return jsonb_build_object('ok', false, 'code', 'LAST_ADMIN');
    end if;

    select count(*)::int into v_future
      from public.training_sessions s
     where s.workspace_id = p_workspace_id
       and s.main_coach_profile_id = p_profile_id
       and s.status <> 'CANCELLED'
       and s.start_at > now();

    if v_future > 0 and not p_confirm then
      return jsonb_build_object('ok', false, 'code', 'LEADS_FUTURE_SESSIONS',
        'details', jsonb_build_object('future_sessions', v_future));
    end if;
  end if;

  update public.workspace_members m
     set is_active = p_is_active
   where m.workspace_id = p_workspace_id
     and m.profile_id   = p_profile_id;

  -- §A3 (v3, DR-08): deactivation takes the administrator's role with it.
  -- Keeping the row and merely deactivating it would hand the rights back
  -- silently the day somebody is reactivated, which is not what an
  -- administrator deactivating a colleague is deciding.
  --
  -- The coach membership is ensured first, so a person who held only the
  -- administrator role keeps a place on the staff and their trainings keep a
  -- coach.
  if not p_is_active then
    insert into public.workspace_members (workspace_id, profile_id, role, is_active)
    values (p_workspace_id, p_profile_id, 'COACH', false)
    on conflict (workspace_id, profile_id, role) do update set is_active = false;

    delete from public.workspace_members m
     where m.workspace_id = p_workspace_id
       and m.profile_id   = p_profile_id
       and m.role         = 'WORKSPACE_ADMIN';
  end if;

  insert into public.audit_log
    (workspace_id, actor_profile_id, action, entity_type, entity_id, before, after)
  values
    (p_workspace_id, v_actor,
     case when p_is_active then 'MEMBER_ACTIVATED' else 'MEMBER_DEACTIVATED' end,
     'PROFILE', p_profile_id,
     jsonb_build_object('is_active', v_was),
     jsonb_build_object('is_active', p_is_active,
                        'future_sessions', coalesce(v_future, 0)));

  return jsonb_build_object('ok', true, 'is_active', p_is_active);
end;
$$;

revoke all on function public.set_member_active(uuid, uuid, boolean, boolean) from public;
grant execute on function public.set_member_active(uuid, uuid, boolean, boolean) to authenticated;
