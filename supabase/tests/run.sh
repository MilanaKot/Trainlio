#!/usr/bin/env bash
#
# Trainlio — schema validation runner.
#
# Applies the schema to throwaway databases and runs both suites. Each suite
# gets its own database: validation.sql cancels a session and deletes an auth
# user on purpose, so it is not idempotent and must never run twice against the
# same data.
#
# Requires psql and a reachable PostgreSQL 16. Set PGHOST/PGUSER/PGPASSWORD, or
# pass a full psql invocation in $PSQL.
set -euo pipefail

cd "$(dirname "$0")/../.."

PSQL="${PSQL:-psql -v ON_ERROR_STOP=1}"
STUB="$(mktemp)"
trap 'rm -f "$STUB"' EXIT

# Supabase-provided objects, stubbed so the schema can be exercised on a plain
# PostgreSQL instance. Roles are cluster-wide, hence the existence checks.
cat > "$STUB" <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable
  as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable
  as $fn$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $fn$;
create publication supabase_realtime;
grant usage on schema public to authenticated, anon, service_role;
SQL

run_suite() {
  local db="$1" suite="$2"
  $PSQL -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1
  $PSQL -q -d "$db" -f "$STUB" >/dev/null 2>&1
  for f in supabase/schema/0*.sql; do
    if ! $PSQL -q -d "$db" -f "$f" >/dev/null; then
      echo "SCHEMA FAILED TO APPLY: $f" >&2
      return 1
    fi
  done
  $PSQL -q -d "$db" -f supabase/tests/fixtures.sql >/dev/null

  local out
  out="$($PSQL -d "$db" -f "$suite" 2>&1)"
  echo "$out" | grep -E '^(──|PASS|FAIL)' || true

  local failed
  failed="$(echo "$out" | grep -c '^FAIL' || true)"
  if [ "$failed" -ne 0 ]; then
    echo "$suite: $failed case(s) failed" >&2
    return 1
  fi
  echo "$suite: $(echo "$out" | grep -c '^PASS') passed"
}

run_suite trainlio_invariants supabase/tests/validation.sql
echo
run_suite trainlio_rls supabase/tests/validation_rls.sql
