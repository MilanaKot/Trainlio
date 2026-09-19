# Schema validation

Trainlio — Sports Training Booking Platform

`fixtures.sql` seeds a two-family, three-athlete, multi-role workspace used to
exercise the invariants, the authorization model and the concurrency design
before any application code exists. Results are recorded in
[`../schema/VALIDATION.md`](../schema/VALIDATION.md).

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
| `validation.sql` | database invariants, D-02, D-07, D-08, D-09, D-11, D-18 |
| `validation_rls.sql` | family isolation, occupancy, D-01, D-12, D-13, D-17, RPC-only mutations |

Concurrency and daylight-saving cases are run separately because they need two
parallel connections and a date-generation comparison; both are recorded in
`../schema/VALIDATION.md`.
