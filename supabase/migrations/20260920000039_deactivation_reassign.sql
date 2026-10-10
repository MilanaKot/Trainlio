-- ---------------------------------------------------------------------------
-- Deactivating a coach who leads future trainings (DR-15, D-25).
--
-- The design left this open: a coach may be deactivated while they are still
-- the main coach of trainings that have not happened, and until now the
-- application only warned about it and left the trainings on their name
-- (D-11). The product answer is a question with two answers — take the
-- trainings over, or leave them — and the administrator doing the
-- deactivation is who takes them over. There is no club-level head coach in
-- the schema to hand them to: `main_coach_profile_id` belongs to each
-- training.
--
-- The trainings are moved through `update_training_session`, one call each,
-- rather than with an UPDATE over the table. That function is where D-11
-- lives: a main coach is a significant change, so each training stamps
-- `significant_changed_at`, carries the previous coach's name in
-- `significant_change`, audits `SESSION_MAIN_COACH_CHANGED`, and queues the
-- e-mail the booked families get. An UPDATE here would move the name and tell
-- nobody.
--
-- Stepping down is left exactly as it was. The switch is disabled on your own
-- card (§A3d), and the server still allows it once another administrator
-- exists, because AC-250 decided that an administrator may hand the club over
-- and leave. `LAST_ADMIN` is what protects the club, not the form.
-- ---------------------------------------------------------------------------

-- A defaulted parameter cannot be added in place: the old four-argument
-- signature would stay and every call become ambiguous.
drop function public.set_member_active(uuid, uuid, boolean, boolean);

create function public.set_member_active(
  p_workspace_id uuid,
  p_profile_id   uuid,
  p_is_active    boolean,
  p_confirm      boolean default false,
  p_reassign     boolean default false
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
  v_moved    integer := 0;
  v_session  record;
  v_result   jsonb;
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

  -- D-25: the trainings move before the membership does, while both people are
  -- still active staff — the main coach of a training has to be
  -- (`trg_training_sessions_main_coach_is_staff`), and the one being replaced
  -- is about to stop being so.
  if not p_is_active and p_reassign and coalesce(v_future, 0) > 0 then
    begin
      for v_session in
        select s.id,
               (s.start_at at time zone w.timezone)::date as local_date,
               (s.start_at at time zone w.timezone)::time as local_start,
               (s.end_at   at time zone w.timezone)::time as local_end,
               s.facility_id,
               s.capacity,
               s.eligibility_mode,
               s.birth_year_from,
               s.birth_year_to,
               s.changing_room,
               s.public_notes,
               n.notes as internal_notes
          from public.training_sessions s
          join public.workspaces w on w.id = s.workspace_id
          left join public.training_session_internal_notes n
            on n.training_session_id = s.id
         where s.workspace_id = p_workspace_id
           and s.main_coach_profile_id = p_profile_id
           and s.status <> 'CANCELLED'
           and s.start_at > now()
         order by s.start_at
      loop
        -- Every value but the coach is the one already stored, so the two
        -- confirmations below say "yes" to states that exist rather than to
        -- anything this operation does: a training a coach deliberately
        -- overfilled stays overfilled, and nobody's eligibility narrows.
        v_result := public.update_training_session(
          v_session.id,
          v_session.local_date,
          v_session.local_start,
          v_session.local_end,
          v_session.facility_id,
          v_session.capacity,
          v_session.eligibility_mode,
          v_session.birth_year_from,
          v_session.birth_year_to,
          v_session.changing_room,
          v_session.public_notes,
          v_session.internal_notes,
          v_actor,
          true,
          true);

        if not coalesce((v_result ->> 'ok')::boolean, false) then
          -- Raised rather than returned: this block is a subtransaction, so
          -- the trainings already moved are rolled back with it and the
          -- administrator is not left with half a handover.
          raise exception 'reassignment refused: %', coalesce(v_result ->> 'code', 'UNKNOWN')
            using errcode = 'raise_exception';
        end if;

        v_moved := v_moved + 1;
      end loop;
    exception
      when raise_exception then
        return jsonb_build_object('ok', false, 'code', 'REASSIGN_FAILED');
    end;
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
                        'future_sessions', coalesce(v_future, 0),
                        'reassigned_sessions', v_moved));

  return jsonb_build_object('ok', true, 'is_active', p_is_active,
                            'reassigned_sessions', v_moved);
end;
$$;

comment on function public.set_member_active(uuid, uuid, boolean, boolean, boolean) is
  'Activates or deactivates a member. Deactivation needs p_confirm when they lead future trainings, and takes those trainings over to the acting administrator when p_reassign (DR-15, D-25).';

revoke all on function public.set_member_active(uuid, uuid, boolean, boolean, boolean) from public;
grant execute on function public.set_member_active(uuid, uuid, boolean, boolean, boolean) to authenticated;
