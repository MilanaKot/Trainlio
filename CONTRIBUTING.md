# Development

Trainlio — Sports Training Booking Platform

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill in the values
pnpm dev
```

Configuration is validated at config load, so `pnpm dev` and `pnpm build` both
refuse to start with a missing or malformed value and name the offending key.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm lint` | ESLint, including the architectural guard rules below |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright |
| `pnpm build` | Production build |
| `pnpm db:types` | Regenerate database types from the local Supabase stack |
| `pnpm db:validate` | Apply every migration to a throwaway database, lint it, run all three suites |

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` overrides the browser binary, for environments
that ship a preinstalled Chromium of a different build.

## Architectural guard rules

Three ESLint rules enforce decisions that are easy to break by accident and
expensive to discover later. Each fails the build, not a review.

**The service-role client never reaches the browser.** It bypasses row level
security entirely, so one import from a Client Component would ship a key that
reads every family's data. `@/lib/supabase/admin` may only be imported from
`src/server/**`; the module also imports `server-only`, and its key is
deliberately not `NEXT_PUBLIC_`.

**No raw `process.env` outside `@/lib/env`.** Scattered reads are how a missing
secret becomes a production 500 instead of a failed build.

**No device-local date formatting.** Every date shown to any user is in the
workspace timezone, never the browser's — a guardian travelling abroad must see
the same training time as the coach. `toLocaleDateString`, `toLocaleTimeString`,
`toLocaleString` and bare `Intl.DateTimeFormat` are blocked outside
`@/lib/time`.

## Layout

```
src/
  app/
    (auth)/       OTP sign-in
                  (guardian) and (coach) groups arrive in Phase 2
  lib/
    env.ts        validated configuration, the only reader of process.env
    supabase/     browser, request-scoped server, service-role admin clients
    time/         workspace-timezone formatting and recurrence dates
    i18n/         Czech messages with plural categories
    enums/        stable codes mapped to Czech labels
    domain/       pure business logic, mirrors the SQL rules (Phase 5)
  server/         server actions; the only place the admin client may be used
  types/          database.generated.ts, generated from the migrations
supabase/
  migrations/     applied in filename order
  tests/          lint plus invariant, authorization and auth suites
tests/
  unit/           Vitest
  e2e/            Playwright
```

## Conventions

UI text is Czech; code, schema, comments and documentation are English.

Enum values are stable internal codes. Czech labels live in `src/lib/enums`, so
no translated string is ever stored as business data.

Czech plural agreement is a real constraint, not a formatting detail: use
`plural()` from `@/lib/i18n` rather than concatenating a count into a sentence.

Mutations go through Server Actions calling the database domain functions.
Guardians hold no write grant on `bookings` and coaches none on
`training_sessions`, so a direct table write is refused — see
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Running the real stack

Docker is required. `supabase start` brings up Postgres, Auth, Storage,
Realtime, PostgREST, Studio and Mailpit, applies every migration and seeds
`supabase/tests/fixtures.sql`.

```bash
pnpm db:start           # prints the local keys; copy them into .env.local
pnpm db:types           # regenerate types from the running stack
pnpm db:integration     # ANON=<anon key> pnpm db:integration
pnpm db:reset           # reapply migrations and fixtures from scratch
pnpm db:stop
```

OTP codes are not emailed anywhere locally: Mailpit catches them at
http://127.0.0.1:54324.

`pnpm db:validate` needs only `psql` and a PostgreSQL 16+ instance, so it runs
in CI without Docker.

### Two kinds of database test

`supabase/tests/*.sql` reach RLS through `set role authenticated` plus a JWT
claim, which is what PostgREST does internally. They are fast and need no
containers.

`supabase/tests/integration.mjs` exercises what SQL cannot: real OTP delivery,
real Storage policies, and RLS as PostgREST applies it over HTTP.
