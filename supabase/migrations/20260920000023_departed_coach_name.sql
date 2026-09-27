-- Trainlio — Sports Training Booking Platform
-- Layer: RLS AUTHORIZATION
-- 23 — the name of a coach who has left
--
-- admin/SPEC.md §2 and its acceptance test 2: deactivating a coach must leave
-- them "visibly assigned" on the sessions they already lead, and renaming one
-- must change the name a guardian reads. The predicate that decides this said
-- otherwise.
--
-- `is_visible_staff_profile` required an ACTIVE workspace membership, so the
-- moment an administrator deactivated a coach, every guardian on every one of
-- that coach's trainings — the ones last winter and the ones next month — read
-- "Hlavní trenér —". That is the exact defect migration 21 was written to fix,
-- reappearing through the other door: there, the name had never been set; here,
-- it disappears on an administrative act that has nothing to do with the
-- guardian.
--
-- The widening is deliberately the narrower of the two available. It does not
-- drop `is_active`; it adds a second way to qualify: this profile is named on a
-- training in a workspace the viewer can already see. A former coach who was
-- never assigned to anything stays invisible, which is right — there is no
-- training on which a parent would ask who led it.
--
-- D-11 unchanged in substance: the coach is the product, and a guardian may
-- read the name of whoever leads their child's training. Nothing else about
-- the profile becomes readable, and the table still holds no email.

create or replace function public.is_visible_staff_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    -- Active staff of a workspace the viewer can see. Unchanged.
    select 1
    from public.workspace_members wm
    where wm.profile_id = p_profile_id
      and wm.is_active
      and (public.is_workspace_member(wm.workspace_id)
           or public.guardian_can_see_workspace(wm.workspace_id))

    union all

    -- Or: named on a training there, whether or not they are still on the
    -- staff. Both the coach table and the session's own mirror column are
    -- consulted, so the answer does not depend on which of the two a given
    -- write path touched first.
    select 1
    from public.training_session_coaches tsc
    join public.training_sessions s on s.id = tsc.training_session_id
    where tsc.profile_id = p_profile_id
      and (public.is_workspace_member(s.workspace_id)
           or public.guardian_can_see_workspace(s.workspace_id))

    union all

    select 1
    from public.training_sessions s
    where s.main_coach_profile_id = p_profile_id
      and (public.is_workspace_member(s.workspace_id)
           or public.guardian_can_see_workspace(s.workspace_id))
  );
$$;

comment on function public.is_visible_staff_profile(uuid) is
  'D-11: a guardian may read the name of active staff in a workspace they can see, and of anyone named on a training there — including a coach who has since left, whose name must not vanish from the trainings they led (admin/SPEC.md §2).';
