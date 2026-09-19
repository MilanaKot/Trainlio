# Sports Training Booking Platform

Mobile-first booking platform for sports training sessions.

The MVP is configured for one hockey coach in Příbram, Czech Republic, but the domain model is intentionally designed for:
- multiple sports;
- multiple coaches;
- multiple workspaces;
- one athlete practicing multiple sports;
- one athlete linked to multiple guardians;
- later commercialization as a multi-tenant SaaS product.

## MVP stack
- Next.js
- TypeScript
- Supabase (PostgreSQL, Auth, Storage, Realtime)
- Tailwind CSS
- shadcn/ui
- Vercel
- Vitest
- Playwright

## Current MVP language
Czech.

The codebase must be internationalization-ready so English can be added later without redesigning the domain model.

## Main documentation
See `/docs`.

## Important product principle
The user-facing MVP is intentionally simple and hockey-specific where helpful, while the underlying architecture remains sport-agnostic.
