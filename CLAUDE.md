# Claude Code Project Instructions

## Project
Build Trainlio — Sports Training Booking Platform, a mobile-first booking
platform for sports training sessions.

The first production use case is a single hockey coach in Příbram, Czech Republic. The architecture must support multiple sports, multiple independent coaches/workspaces, and one athlete participating in several sports.

## Required reading before implementation
Read all files in `/docs` and all files in `/supabase/migrations`.

Start with `/docs/ARCHITECTURE.md`, which defines the five layers, and
`/docs/OPEN_DECISIONS.md`, which lists decisions that are still provisional.

Do not implement features that are explicitly marked out of MVP scope.

## Technical stack
- Next.js
- TypeScript
- Supabase PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Realtime
- Tailwind CSS
- shadcn/ui
- Resend (transactional email, and Supabase Auth OTP via custom SMTP)
- Vercel
- Vitest
- Playwright

## Engineering principles
1. Mobile-first.
2. Simple UI over feature density.
3. Database-enforced invariants.
4. Row Level Security must be enabled for all user-facing tables.
5. Never rely on client-side checks for authorization or capacity control.
6. Avoid hockey-specific database naming for generic concepts.
7. Hockey-specific profile attributes belong in sport profiles, not the athlete core record.
8. Audit important booking/session changes in an append-only audit log, which is
   separate from the notification outbox.
9. Preserve cancelled bookings and cancelled sessions; do not hard-delete
   operational history.
10. Use transactions / RPC functions for booking operations that can race.
    Guardians have no direct insert or update permission on bookings, and
    coaches have none on sessions: RLS is defence in depth, the domain functions
    enforce business invariants.
11. Existing functionality must remain compatible with future multi-workspace SaaS expansion.
12. Prefer explicit, maintainable domain logic over generic over-engineered frameworks.

## MVP language
UI text: Czech.
Code, schema, comments, docs: English.

## MVP product assumptions
- One active workspace.
- Sport = ice hockey.
- Venue = Příbram.
- Facilities:
  - MH = Malá hala
  - VH = Velká hala
- Default capacity = 10.
- Workspace timezone = Europe/Prague. All wall-clock reasoning uses it, never the
  device timezone.
- Guardian cancellation deadline = 12 hours before session start, stored as a
  workspace setting rather than a hardcoded constant.
- Users may book until the session starts while booking is open and capacity allows.
- Multi-athlete guardian booking is atomic: all selected athletes or none.
- An athlete removed by a coach cannot be re-booked by a guardian.
- Coach may manually exceed capacity.
- Coach may reduce capacity below current confirmed bookings after explicit warning.
- No waiting list.
- No payments.
- No attendance tracking.
- No calendar UI.
- No push notifications.
- Critical session changes and cancellations send email.
