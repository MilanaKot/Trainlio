# Recommended Implementation Plan for Claude Code

## Phase 0 — foundation
- Initialize Next.js + TypeScript
- Tailwind
- shadcn/ui
- Supabase clients
- environment handling
- lint/test setup
- i18n-ready Czech message structure

## Phase 1 — database and auth
- Apply schema
- Seed HOCKEY sport
- Seed initial workspace
- Seed Příbram location
- Seed MH/VH facilities
- Supabase Auth OTP
- app_profiles
- roles
- RLS

## Phase 2 — athlete management
- Athlete CRUD for guardians
- Hockey sport profile
- Private photo upload
- Guardian access
- multi-child support

## Phase 3 — coach session management
- Create session
- Edit session
- Close/open booking
- Cancel session
- Duplicate session
- Capacity warning

## Phase 4 — recurring series
- Recurrence form
- Preview occurrences
- Transactional bulk creation

## Phase 5 — booking engine
- Transaction-safe normal booking RPC
- Multi-athlete booking UI
- eligibility validation
- 12-hour cancellation RPC
- realtime occupancy updates

## Phase 6 — coach roster
- roster
- booked-by visibility
- manual booking
- over-capacity override
- coach cancellation

## Phase 7 — notifications
- notification event table
- email provider integration
- significant-update notification
- cancelled-session notification
- guardian deduplication

## Phase 8 — QA
- unit tests
- RLS tests
- booking concurrency tests
- Playwright guardian flows
- Playwright coach flows
- mobile layout review

## Phase 9 — deployment
- Vercel
- Supabase production project
- production SMTP/email provider
- environment secrets
- backup/recovery notes
