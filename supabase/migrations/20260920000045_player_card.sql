-- ---------------------------------------------------------------------------
-- The player card K13 with its four tabs (handoff v3.4, decision 43).
--
-- `Tréninky` toggles attendance and payment per training and `Zprávy` keeps the
-- coach's note and the message to the parents per training, so the list of an
-- athlete's trainings now carries what K2 carries for one training. `Rodiče`
-- adds each guardian's e-mail and whether they are the one who books.
--
-- Both functions change their return type, so they are dropped and created.
-- They stay gated exactly as before: the athlete's trainings to the club's
-- staff (the coach note is in them, decision 35), the family to staff of a
-- club the child trains at.
-- ---------------------------------------------------------------------------

drop function public.coach_athlete_sessions(uuid, uuid);

create function public.coach_athlete_sessions(
  p_workspace_id uuid,
  p_athlete_id   uuid
)
returns table (
  training_session_id    uuid,
  start_at               timestamptz,
  end_at                 timestamptz,
  status                 public.session_status,
  facility_code          text,
  changing_room          text,
  main_coach_profile_id  uuid,
  booking_id             uuid,
  booking_status         public.booking_status,
  attendance             public.attendance_status,
  paid_at                timestamptz,
  coach_note             text,
  parent_message         text,
  parent_message_sent_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.start_at, s.end_at, s.status, f.code, s.changing_room,
         s.main_coach_profile_id, b.id, b.status, b.attendance, b.paid_at,
         n.note, b.parent_message, b.parent_message_sent_at
  from public.bookings b
  join public.training_sessions s on s.id = b.training_session_id
  left join public.facilities f on f.id = s.facility_id
  left join public.booking_coach_notes n on n.booking_id = b.id
  where b.athlete_id = p_athlete_id
    and s.workspace_id = p_workspace_id
    and public.is_workspace_coach(p_workspace_id)
  order by s.start_at desc;
$$;

revoke all on function public.coach_athlete_sessions(uuid, uuid) from public;
grant execute on function public.coach_athlete_sessions(uuid, uuid) to authenticated;

-- K13r: the address a coach writes to, and `přihlašuje na tréninky` for a
-- guardian who has booked this child — what the design means by the one who
-- books, since every guardian may.
drop function public.athlete_guardians(uuid);

create function public.athlete_guardians(p_athlete_id uuid)
returns table (
  profile_id        uuid,
  display_name      text,
  relationship_code text,
  phone             text,
  email             text,
  books             boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, g.relationship_code, p.phone, u.email::text,
         exists (select 1 from public.bookings b
                  where b.athlete_id = p_athlete_id
                    and b.created_by = p.id
                    and b.created_by_role = 'USER')
  from public.guardian_athlete_access g
  join public.app_profiles p on p.id = g.profile_id
  left join auth.users u on u.id = p.auth_user_id
  where g.athlete_id = p_athlete_id
    and g.status = 'ACTIVE'
    and p.anonymized_at is null
    and public.coach_can_see_athlete(p_athlete_id)
  order by p.display_name nulls last, p.id;
$$;

revoke all on function public.athlete_guardians(uuid) from public;
grant execute on function public.athlete_guardians(uuid) to authenticated;
