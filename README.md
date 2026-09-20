# Trainlio — Sports Training Booking Platform

Mobile-first booking platform for sports training sessions.

The MVP is configured for one hockey coach in Příbram, Czech Republic, but the
domain model is intentionally designed for:
- multiple sports;
- multiple coaches;
- multiple workspaces;
- one athlete practicing multiple sports;
- one athlete linked to multiple guardians;
- later commercialization as a multi-tenant SaaS product.

## Status

Phases 0 to 3 complete.

The database and its authorization model, email one-time-code sign-in, athlete
management and coach session management are in place. Thirteen migrations apply
clean, the database lint reports no error-level finding, and 171 validation
cases pass — see [`supabase/VALIDATION.md`](supabase/VALIDATION.md).

Next: Phase 4 — recurring series.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to run it.

## MVP stack
- Next.js
- TypeScript
- Supabase (PostgreSQL, Auth, Storage, Realtime)
- Tailwind CSS
- shadcn/ui
- Resend (transactional email and Auth OTP via custom SMTP)
- Vercel
- Vitest
- Playwright

## Current MVP language
Czech.

The codebase must be internationalization-ready so English can be added later
without redesigning the domain model.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Product requirements |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The five layers and why they stay separate |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Entities and their relationships |
| [`docs/DOMAIN_OPERATIONS.md`](docs/DOMAIN_OPERATIONS.md) | Server-side operation contracts |
| [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) | Numbered business rules |
| [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) | Permissions and row level security |
| [`docs/USER_FLOWS.md`](docs/USER_FLOWS.md) | End-to-end flows |
| [`docs/UI_SPEC.md`](docs/UI_SPEC.md) | Screens and Czech UI text |
| [`docs/ACCEPTANCE_CRITERIA.md`](docs/ACCEPTANCE_CRITERIA.md) | Testable criteria |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phases and exit criteria |
| [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md) | Decisions still needed |
| [`supabase/README.md`](supabase/README.md) | Migrations, types, validation |
| [`supabase/VALIDATION.md`](supabase/VALIDATION.md) | What the schema was proven to do |
| [`docs/ARCHITECTURE_REVIEW.md`](docs/ARCHITECTURE_REVIEW.md) | The review these decisions came from |

Schema: [`supabase/migrations/`](supabase/migrations/).

## Important product principle

The user-facing MVP is intentionally simple and hockey-specific where helpful,
while the underlying architecture remains sport-agnostic.
