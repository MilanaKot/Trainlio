# Claude Code Project Instructions

## Project
Build a mobile-first sports training booking platform.

The first production use case is a single hockey coach in Příbram, Czech Republic. The architecture must support multiple sports, multiple independent coaches/workspaces, and one athlete participating in several sports.

## Required reading before implementation
Read all files in `/docs` and `supabase_schema.sql`.

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
8. Audit important booking/session changes.
9. Preserve cancelled bookings and cancelled sessions; do not hard-delete operational history.
10. Use transactions / RPC functions for booking operations that can race.
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
- Guardian cancellation deadline = 12 hours before session start.
- Users may book until the session starts while booking is open and capacity allows.
- Coach may manually exceed capacity.
- Coach may reduce capacity below current confirmed bookings after explicit warning.
- No waiting list.
- No payments.
- No attendance tracking.
- No calendar UI.
- No push notifications.
- Critical session changes and cancellations send email.
