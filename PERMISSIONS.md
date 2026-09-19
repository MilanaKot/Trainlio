# Permissions and RLS

## General rule
All application tables must have Row Level Security enabled.

Do not trust client-side role checks.

## Guardian

May:
- read own app profile;
- read athletes with ACTIVE guardian access;
- create an athlete and automatically receive guardian access;
- update athletes with ACTIVE guardian access;
- read sport profiles for athletes they can access;
- create/update sport profiles for athletes they can access;
- read sessions visible in relevant workspace;
- read own athletes' bookings;
- create normal bookings for own linked athletes;
- cancel own athletes' bookings only when server-side cancellation rule allows.

May not:
- read other families' athlete identities;
- read other families' bookings;
- read another user's email;
- exceed session capacity;
- modify sessions;
- bypass age eligibility;
- cancel inside 12 hours.

## Coach

May:
- read sessions in workspace;
- create/update/cancel sessions in workspace;
- read athlete profiles for athletes active in workspace;
- read sport profile relevant to workspace sport;
- read session roster;
- manually book workspace athletes;
- intentionally override capacity;
- cancel bookings at any time;
- see created_by user for bookings.

May not:
- edit athlete core profile;
- edit guardian relationships except through explicit admin/support features.

## Admin

May:
- manage workspace configuration;
- manage roles;
- investigate/fix operational records;
- perform explicitly authorized administration.

Admin and coach are separate permissions.

## Private athlete photos

Use a private Supabase Storage bucket.

Signed URLs or authenticated access only.

Access:
- active guardian of athlete
- coach in athlete's active workspace
- authorized admin

## Booking RPC

Normal booking must occur through a SECURITY DEFINER Postgres function or equivalent transactional server-side operation that:
1. locks or otherwise serializes the relevant session booking capacity check;
2. checks session OPEN;
3. checks session has not started;
4. checks athlete access;
5. checks workspace membership;
6. checks sport profile;
7. checks birth-year eligibility;
8. checks duplicate booking;
9. counts confirmed bookings;
10. rejects if count >= capacity;
11. inserts booking.

Coach manual booking must use a separate privileged RPC that records override status.

## Cancellation RPC

Guardian cancellation must calculate the 12-hour rule on the server using session start_at.

Never accept a client-provided `can_cancel=true`.

## Session update RPC/server action

If capacity is reduced below occupancy:
- require explicit confirmation flag from coach;
- verify coach permission;
- preserve bookings.

## Email privacy

Guardian emails are not exposed to other guardians.

Application should use auth identity/email server-side for notifications rather than copying email into public domain tables unnecessarily.
