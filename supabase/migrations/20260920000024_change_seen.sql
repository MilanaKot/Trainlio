-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS + DOMAIN OPERATIONS
-- 24 — "Změněno", until the parent has looked
--
-- guardian/SPEC.md §G4 and §G6: a booking whose training moved carries a
-- warning badge, and opening the booking clears it. The session already
-- records *that* it moved — `significant_changed_at`, set only by a change to
-- the date, the times, the place, the hall or the main coach (D-11). What was
-- missing is the other half: whether this particular parent has seen it.
--
-- It has to be per booking, not per session. Two children in the same training
-- are two bookings, and a parent who opened one has not thereby been told
-- about the other. It also cannot be per session for a plainer reason: a
-- session is not the parent's row to write.
--
-- Which is the second half of this migration. Guardians hold no UPDATE grant
-- on `bookings` at all — that is principle 10, and it is what stops a client
-- cancelling by writing a status — so the specification's
-- `update bookings set change_seen_at = now()` cannot be what happens. The
-- stamp goes through a function that can only ever reach the caller's own
-- bookings.
--
-- The badge, and nothing else. §G6 is explicit that the notice inside the
-- booking keeps explaining what moved until the training starts, whether or
-- not it has been seen. Only the marker in the list goes quiet.

alter table public.bookings add column change_seen_at timestamptz;

comment on column public.bookings.change_seen_at is
  'When this guardian last opened the booking after a significant session change. The "Změněno" badge shows while significant_changed_at is newer than both created_at and this (guardian/SPEC.md §G4).';

-- ---------------------------------------------------------------------------
-- The parent has looked.
--
-- Stamps only when there is something unseen, so opening a booking twice
-- writes once, and opening one that never changed writes nothing at all. That
-- is not an optimisation: `updated_at` is a trigger on this table, and a
-- no-op write would move it on every page view and make the column useless for
-- anyone trying to work out when a booking last really changed.
-- ---------------------------------------------------------------------------

create or replace function public.mark_booking_change_seen(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := public.current_profile_id();
  v_athlete uuid;
  v_seen    timestamptz;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select b.athlete_id into v_athlete
    from public.bookings b
   where b.id = p_booking_id;

  if v_athlete is null then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  -- The same predicate the row policies use. A coach has no business marking a
  -- parent's badge read, and another family has no business reaching this row.
  if not public.has_athlete_access(v_athlete) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED_FOR_ATHLETE');
  end if;

  update public.bookings b
     set change_seen_at = now()
    from public.training_sessions s
   where b.id = p_booking_id
     and s.id = b.training_session_id
     and s.significant_changed_at is not null
     and s.significant_changed_at > b.created_at
     and (b.change_seen_at is null or s.significant_changed_at > b.change_seen_at)
  returning b.change_seen_at into v_seen;

  return jsonb_build_object('ok', true, 'seen_at', v_seen, 'unchanged', v_seen is null);
end;
$$;

revoke all on function public.mark_booking_change_seen(uuid) from public;
grant execute on function public.mark_booking_change_seen(uuid) to authenticated;
