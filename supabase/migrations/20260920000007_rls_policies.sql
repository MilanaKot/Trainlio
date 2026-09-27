-- Trainlio — Sports Training Booking Platform
-- Layer: RLS AUTHORIZATION (policies and grants)
-- 07 — row level security
--
-- Position of this layer (approved finding 5):
--   RLS is defence in depth. It answers "may this identity see or touch this
--   row at all?". It does NOT enforce business invariants — capacity, the
--   cancellation deadline, eligibility and notification/audit side effects are
--   enforced by the domain functions in DOMAIN_OPERATIONS.md.
--
-- Two deliberate absences:
--   * No DELETE policy exists on any table. With RLS enabled and no DELETE
--     policy, deletion is impossible for anon and authenticated. That is the
--     enforcement mechanism for the no-hard-delete rule (S-R3), not an omission.
--   * Guardians have no INSERT or UPDATE policy on bookings, and coaches have
--     none on training_sessions. Those mutations exist only as RPCs, so
--     capacity, deadlines, the audit trail and the notification outbox cannot
--     be bypassed by a direct table write (S-R4, S-R5).
--
-- service_role bypasses RLS entirely and is used only by the notification drain
-- job and administrative tooling. It is never present in the browser bundle.

alter table public.app_profiles                    enable row level security;
alter table public.platform_admins                 enable row level security;
alter table public.sports                          enable row level security;
alter table public.workspaces                      enable row level security;
alter table public.workspace_members               enable row level security;
alter table public.athletes                        enable row level security;
alter table public.guardian_athlete_access         enable row level security;
alter table public.athlete_sport_profiles          enable row level security;
alter table public.workspace_athlete_memberships   enable row level security;
alter table public.locations                       enable row level security;
alter table public.facilities                      enable row level security;
alter table public.session_series                  enable row level security;
alter table public.training_sessions               enable row level security;
alter table public.training_session_internal_notes enable row level security;
alter table public.training_session_coaches        enable row level security;
alter table public.bookings                        enable row level security;
alter table public.training_session_occupancy      enable row level security;
alter table public.notification_events             enable row level security;
alter table public.notification_deliveries         enable row level security;
alter table public.audit_log                       enable row level security;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy app_profiles_select_own on public.app_profiles
  for select to authenticated using (id = public.current_profile_id());

create policy app_profiles_update_own on public.app_profiles
  for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

-- D-11 clarification: the coach is the product, so guardians must be able to
-- see who is leading a session. This exposes the display name of active staff
-- in a workspace the viewer can see — and nothing else. Email is not in this
-- table at all, and no policy exposes an arbitrary user's profile.
create policy app_profiles_select_visible_staff on public.app_profiles
  for select to authenticated
  using (public.is_visible_staff_profile(id));

-- platform_admins: no policy at all (D-17). Readable only through
-- public.is_platform_admin(), which is SECURITY DEFINER. Platform
-- administration is never discoverable or inferable from workspace data.

-- ---------------------------------------------------------------------------
-- A note on inline subqueries in policies.
--
-- A subquery inside a policy runs as the calling role, so RLS on the inner
-- table applies too. Several policies below deliberately rely on this: a
-- guardian reaching facilities through locations, or the occupancy projection
-- through training_sessions, is filtered twice by design and the two filters
-- agree.
--
-- It becomes a bug when the inner table's policy is NARROWER than the outer
-- one needs. That is why staff visibility on app_profiles goes through
-- is_visible_staff_profile(): guardians cannot select from workspace_members,
-- so an inline EXISTS silently evaluated to false and hid the coach's name.
-- Any new policy that must see rows the caller cannot select directly belongs
-- in a SECURITY DEFINER predicate in file 06.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Reference data. Readable by any authenticated user; writable only by
-- service_role / platform tooling.
-- ---------------------------------------------------------------------------

create policy sports_select_all on public.sports
  for select to authenticated using (true);

-- The timezone and cancellation deadline are needed client-side to render
-- deadlines correctly, so the row itself must be readable — it contains no
-- personal data.
create policy workspaces_select_related on public.workspaces
  for select to authenticated
  using (
    public.is_workspace_member(id)
    or public.guardian_can_see_workspace(id)
    or public.is_platform_admin()
  );

create policy locations_select_related on public.locations
  for select to authenticated
  using (
    public.is_workspace_member(workspace_id)
    or public.guardian_can_see_workspace(workspace_id)
  );

create policy facilities_select_related on public.facilities
  for select to authenticated
  using (
    exists (
      select 1 from public.locations l
      where l.id = facilities.location_id
        and (public.is_workspace_member(l.workspace_id)
             or public.guardian_can_see_workspace(l.workspace_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Workspace staff
-- ---------------------------------------------------------------------------

-- Note the shape: the predicate calls a SECURITY DEFINER function instead of
-- selecting from workspace_members, which would recurse (S-R1).
create policy workspace_members_select_own_workspaces on public.workspace_members
  for select to authenticated
  using (
    profile_id = public.current_profile_id()
    or public.is_workspace_coach(workspace_id)
  );

-- ---------------------------------------------------------------------------
-- Athletes and guardian access
--
-- D-17: no clause here consults a workspace staff role for the guardian side.
-- Guardian authorization is athlete access plus workspace athlete membership.
-- ---------------------------------------------------------------------------

-- AC-091: the single most security-sensitive policy in the system.
create policy athletes_select_guardian_or_coach on public.athletes
  for select to authenticated
  using (
    public.has_athlete_access(id)
    or public.coach_can_see_athlete(id)
  );

-- BR-005. Guardians edit; coaches explicitly cannot (BR-006, AC-015) — there is
-- no coach branch in this policy.
-- D-09: this policy has no is_active clause, so a guardian can reactivate an
-- athlete they deactivated.
create policy athletes_update_guardian on public.athletes
  for update to authenticated
  using (public.has_athlete_manage_access(id))
  with check (public.has_athlete_manage_access(id));

-- No INSERT policy: athletes are created only by create_athlete_with_guardian(),
-- which also creates guardian access, the sport profile and the workspace
-- membership in one transaction. A bare INSERT would strand an athlete row that
-- no policy can ever select again (M-08).

create policy guardian_access_select_own on public.guardian_athlete_access
  for select to authenticated
  using (
    profile_id = public.current_profile_id()
    or public.coach_can_see_athlete(athlete_id)
  );

-- No INSERT/UPDATE policy: guardian links are granted by RPC only. This is what
-- stops a user from attaching themselves to an arbitrary athlete id.

create policy sport_profiles_select_related on public.athlete_sport_profiles
  for select to authenticated
  using (
    public.has_athlete_access(athlete_id)
    or public.coach_can_see_athlete(athlete_id)
  );

create policy sport_profiles_insert_guardian on public.athlete_sport_profiles
  for insert to authenticated
  with check (public.has_athlete_manage_access(athlete_id));

create policy sport_profiles_update_guardian on public.athlete_sport_profiles
  for update to authenticated
  using (public.has_athlete_manage_access(athlete_id))
  with check (public.has_athlete_manage_access(athlete_id));

create policy wam_select_related on public.workspace_athlete_memberships
  for select to authenticated
  using (
    public.has_athlete_access(athlete_id)
    or public.is_workspace_coach(workspace_id)
  );

-- No INSERT/UPDATE policy: memberships are a tenancy decision made by RPC.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

-- D-01 (approved): guardians see non-DRAFT sessions in workspaces where they
-- have an active athlete membership. DRAFT is staff-only.
--
-- D-12: changing_room is on this row and is therefore guardian-visible, shown
-- as "Příbram · MH · Šatna 4".
-- D-13: internal notes are NOT on this row. They live in
-- training_session_internal_notes, which no guardian policy grants.
create policy training_sessions_select_staff on public.training_sessions
  for select to authenticated
  using (public.is_workspace_coach(workspace_id));

create policy training_sessions_select_guardian on public.training_sessions
  for select to authenticated
  using (
    status <> 'DRAFT'
    and public.guardian_can_see_workspace(workspace_id)
  );

-- No INSERT/UPDATE policy for coaches. Session writes go through the coach
-- domain operations so that the significant-change marker, the notification
-- outbox row and the audit row are produced in the same transaction as the
-- change (approved finding 5). A direct UPDATE would let a coach move a session
-- or change its main coach without the email that D-11 requires.

-- D-13: staff only. A guardian's select returns no rows, not a null column.
create policy session_internal_notes_select_staff on public.training_session_internal_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.training_sessions ts
      where ts.id = training_session_internal_notes.training_session_id
        and public.is_workspace_coach(ts.workspace_id)
    )
  );

create policy session_series_select_staff on public.session_series
  for select to authenticated
  using (public.is_workspace_coach(workspace_id));

create policy session_coaches_select_related on public.training_session_coaches
  for select to authenticated
  using (
    exists (
      select 1 from public.training_sessions ts
      where ts.id = training_session_coaches.training_session_id
        and (public.is_workspace_coach(ts.workspace_id)
             or (ts.status <> 'DRAFT' and public.guardian_can_see_workspace(ts.workspace_id)))
    )
  );

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

-- BR-090 / AC-090: a guardian reads only their own athletes' bookings. A coach
-- reads the full roster of their workspace's sessions, including created_by
-- (BR-092).
--
-- D-09: no is_active clause on the athlete. A deactivated athlete's bookings
-- stay visible in My Bookings and on the coach roster.
create policy bookings_select_own_athletes on public.bookings
  for select to authenticated
  using (public.has_athlete_access(athlete_id));

create policy bookings_select_coach_roster on public.bookings
  for select to authenticated
  using (
    exists (
      select 1 from public.training_sessions ts
      where ts.id = bookings.training_session_id
        and public.is_workspace_coach(ts.workspace_id)
    )
  );

-- No INSERT/UPDATE policy for anyone (approved finding 5). Creating or
-- cancelling a booking is exclusively an RPC operation. Without this, a client
-- could insert a row that ignores capacity, eligibility and the 12-hour rule.

-- ---------------------------------------------------------------------------
-- Occupancy projection
--
-- Visible to anyone who can see the session. Exposes a count and nothing else:
-- no athlete ids, no booker ids, no per-booking timestamps (S-P1). This is the
-- only booking-derived object a guardian may read, and the only one added to
-- the Realtime publication for guardian channels (S-P2).
-- ---------------------------------------------------------------------------

create policy occupancy_select_visible_sessions on public.training_session_occupancy
  for select to authenticated
  using (
    exists (
      select 1 from public.training_sessions ts
      where ts.id = training_session_occupancy.training_session_id
        and (public.is_workspace_coach(ts.workspace_id)
             or (ts.status <> 'DRAFT' and public.guardian_can_see_workspace(ts.workspace_id)))
    )
  );

-- No INSERT/UPDATE policy: written only by trigger (BR-050 as amended).

-- ---------------------------------------------------------------------------
-- Outbox and audit: service_role only. No policies are defined, so RLS denies
-- every authenticated access. notification_deliveries in particular holds
-- guardian email addresses (M-09). Audit review is an administrative task
-- performed through server-side tooling.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Realtime publication (S-P2). bookings is deliberately absent.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.training_session_occupancy;
alter publication supabase_realtime add table public.training_sessions;

-- ---------------------------------------------------------------------------
-- Explicit table privileges.
--
-- Supabase grants new public-schema tables to anon and authenticated through
-- default privileges. Relying on that would silently expose every future table,
-- so grants are stated here instead: RLS then narrows an intentional grant
-- rather than rescuing an accidental one.
--
-- Two layers must both permit an access. A table absent from these grants is
-- unreachable by clients no matter what policies exist.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;

-- Read-only reference data.
grant select on public.sports, public.workspaces, public.locations, public.facilities
  to authenticated;

-- Guardian and coach read paths.
grant select on
  public.app_profiles,
  public.workspace_members,
  public.guardian_athlete_access,
  public.workspace_athlete_memberships,
  public.session_series,
  public.training_sessions,
  public.training_session_internal_notes,
  public.training_session_coaches,
  public.bookings,
  public.training_session_occupancy
  to authenticated;

-- Rows a guardian may edit directly. Everything else is an RPC.
--
-- Column-level on app_profiles: display_name only. id, auth_user_id and
-- anonymized_at are the actor identity that all history points at, so a client
-- must not be able to move a profile to another login or mark itself
-- anonymised. The service role is unaffected and can still do both when the
-- deferred D-18 workflow is built.
grant update (display_name) on public.app_profiles    to authenticated;
grant update on public.athletes                       to authenticated;
grant select on public.athletes                       to authenticated;
grant insert, update on public.athlete_sport_profiles to authenticated;
grant select on public.athlete_sport_profiles         to authenticated;

-- Never granted to any client role, at either layer:
--   platform_admins, notification_events, notification_deliveries, audit_log.
-- No table grants DELETE to any client role.

-- anon holds nothing. Every screen requires an authenticated session.
