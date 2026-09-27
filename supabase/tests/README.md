# Schema validation

Trainlio — Sports Training Booking Platform

`fixtures.sql` seeds a two-family, three-athlete, multi-role workspace used to
exercise the invariants, the authorization model and the concurrency design.
Profiles are created by the signup trigger, exactly as a real OTP signup creates
them; the fixtures only name them. Results are recorded in
[`../VALIDATION.md`](../VALIDATION.md).

It runs against a plain PostgreSQL 16 cluster with the Supabase-provided objects
stubbed (`auth.users`, `auth.uid()`, `storage.objects`, `storage.foldername`,
the `supabase_realtime` publication, and the `anon`, `authenticated` and
`service_role` roles).

Phase 8 replaces this with the Supabase CLI local stack and a committed Vitest
suite. The cases here become the seed of that suite.

## Running

Each suite mutates state on purpose — `validation.sql` cancels a session and
deletes an auth user to prove terminality and anonymisation survivability — so
each runs against its **own freshly created database**, never twice against the
same one and never one after the other.

```
create database → stubs → schema/01..09 → fixtures.sql → one suite
```

| Suite | Cases |
|---|---|
| `lint.sql` | the Supabase database linter's rules, split into ERROR (must be zero) and INFO |
| `validation.sql` | database invariants, D-02, D-07, D-08, D-09, D-11, D-18 |
| `validation_rls.sql` | family isolation, occupancy, D-01, D-12, D-13, D-17, RPC-only mutations |
| `validation_auth.sql` | signup creating the actor record, and that a client cannot forge or move one |

`bash supabase/tests/run.sh` runs all four. It needs `psql` and a reachable
PostgreSQL 16; set `PGHOST`/`PGUSER`/`PGPASSWORD`, or pass a full invocation in
`$PSQL`.

Concurrency and daylight-saving cases are run separately because they need two
parallel connections and a date-generation comparison; both are recorded in
`../VALIDATION.md`.


## Acceptance-criterion coverage

`pnpm qa:coverage` parses `docs/ACCEPTANCE_CRITERIA.md` and greps every test
file for each identifier. It fails on a criterion nothing cites, and on a test
citing an identifier the specification no longer defines.

A citation is a weak proof — it says a test *claims* the criterion, not that the
test is right — so it is a floor, not a ceiling. Its value runs the other way:
a criterion that appears nowhere is definitely untested, and that is the hole
worth finding automatically. Documentation is excluded from the search on
purpose: a plan or a contract citing an AC is intent, not coverage.

## A note on the Realtime checks

The Realtime section of `integration.mjs` verifies that a guardian subscribed to
`training_session_occupancy` receives the count change when someone books
(D-01, S-P2). Against a **freshly reset** local stack it does not route changes
to an RLS-scoped subscriber, and the suite reports:

```
SKIP  Realtime checks — the local stack is not routing changes yet.
```

Run the suite a second time and they execute normally. The cause is in the
Supabase CLI's container lifecycle around `supabase db reset`, not in Trainlio:
a service-role subscriber on the same table routes immediately after a restart,
and restarting the Realtime container by hand does not change the outcome —
only having run the suite once does.

The suite skips rather than fails so a red line here always means a real
regression — **unless `REALTIME_REQUIRED=1` is set**, which turns the skip into
a failure. CI sets it on a second run of the suite, after a first run that is
allowed to skip:

```bash
pnpm db:integration                       # warm-up, may skip
REALTIME_REQUIRED=1 pnpm db:integration   # the run that counts
```

Running twice without the flag would prove nothing, because a skip leaves the
exit code at zero and two skips look exactly like coverage. That is precisely
what CI was doing until the first pull request: a fresh stack every run, so
every run was the first one, so these checks never ran at all while CI stayed
green.

They are the only coverage of live occupancy, and a guardian who never sees the
count move is a guardian who books into a session that filled while they were
reading it. See [`../VALIDATION.md`](../VALIDATION.md) for what is and is not
understood about the cause.
