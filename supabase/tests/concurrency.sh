#!/usr/bin/env bash
#
# Trainlio — AC-022 and BR-032.
#
# Several guardians reach for the last place at the same instant, on genuinely
# parallel connections. Exactly one booking must succeed, and occupancy must
# never exceed capacity.
#
# Two things are run, and both matter:
#
#   CONTROL  a deliberately unlocked count-then-insert, to prove the harness
#            can actually observe overbooking. A concurrency test that cannot
#            fail proves nothing, and the first draft of this script was
#            exactly that: an advisory lock around each attempt serialised the
#            transactions so completely that the occupancy lock was never
#            contended, and it passed while testing nothing.
#
#   REAL     book_athletes_as_guardian, which takes the occupancy row lock.
set -euo pipefail

cd "$(dirname "$0")/../.."

PSQL="${PSQL:-psql -v ON_ERROR_STOP=1}"
DB="${CONCURRENCY_DB:-trainlio_concurrency}"
ROUNDS="${CONCURRENCY_ROUNDS:-5}"
CONTENDERS="${CONCURRENCY_CONTENDERS:-6}"
STUB="$(mktemp)"
trap 'rm -f "$STUB"' EXIT

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

$PSQL -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
$PSQL -q -d "$DB" -f "$STUB" >/dev/null 2>&1
for f in supabase/migrations/*.sql; do
  $PSQL -q -d "$DB" -f "$f" >/dev/null || { echo "MIGRATION FAILED: $f" >&2; exit 1; }
done
$PSQL -q -d "$DB" -f supabase/tests/fixtures.sql >/dev/null

GUARDIAN='00000000-0000-0000-0000-0000000fa000'

# One guardian with enough athletes to make a real crowd at the door. Created
# directly, because this is fixture setup rather than the behaviour under test.
$PSQL -q -d "$DB" >/dev/null <<SQL
insert into public.athletes (id, first_name, last_name, date_of_birth)
select ('00000000-0000-0000-0000-00000000c0' || lpad(i::text, 2, '0'))::uuid,
       'Závodník' || i, 'Testovací', date '2017-06-01'
from generate_series(1, $CONTENDERS) i;

insert into public.guardian_athlete_access (profile_id, athlete_id)
select '$GUARDIAN', a.id from public.athletes a where a.last_name = 'Testovací';

insert into public.athlete_sport_profiles (athlete_id, sport_id, attributes)
select a.id, s.id, '{"position":"CENTER","stick_side":"LEFT"}'::jsonb
from public.athletes a, public.sports s
where a.last_name = 'Testovací' and s.code = 'HOCKEY';

insert into public.workspace_athlete_memberships (workspace_id, athlete_id, athlete_sport_profile_id, sport_id)
select w.id, p.athlete_id, p.id, p.sport_id
from public.workspaces w, public.athlete_sport_profiles p
join public.athletes a on a.id = p.athlete_id
where a.last_name = 'Testovací' and w.name like 'Příbram%';

-- CONTROL only: count, pause, insert. What a straightforward implementation
-- does, and what the occupancy lock exists to prevent.
create or replace function public.book_unlocked_for_test(p_session uuid, p_athlete uuid)
returns boolean language plpgsql as \$fn\$
declare v_cap int; v_cnt int;
begin
  select capacity into v_cap from public.training_sessions where id = p_session;
  select confirmed_count into v_cnt from public.training_session_occupancy where training_session_id = p_session;
  perform pg_sleep(0.3);
  if v_cnt >= v_cap then return false; end if;
  insert into public.bookings (training_session_id, athlete_id, status, created_by, created_by_role)
  values (p_session, p_athlete, 'CONFIRMED', '$GUARDIAN', 'USER');
  return true;
end \$fn\$;
SQL

athlete_id() { printf '00000000-0000-0000-0000-00000000c0%02d' "$1"; }

new_session() {
  $PSQL -q -d "$DB" -tAc "
    set role authenticated;
    set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c0ac';
    select public.create_training_session(
      (select id from public.workspaces where name like 'Příbram%'),
      (current_date + 40)::date, time '09:00', time '10:00',
      (select f.id from public.facilities f
         join public.locations l on l.id = f.location_id
         join public.workspaces w on w.id = l.workspace_id
        where f.code = 'MH' and w.name like 'Příbram%'),
      1, 'ALL') -> 'data' ->> 'training_session_id';" | grep -Eo '[0-9a-f-]{36}' | head -1
}

confirmed_in() {
  $PSQL -q -d "$DB" -tAc \
    "select count(*) from public.bookings where training_session_id = '$1' and status = 'CONFIRMED'" \
    | tr -d '[:space:]'
}

# Fired with no artificial serialisation: whatever overlap occurs is real.
race() {
  local session="$1" fn="$2" i
  for i in $(seq 1 "$CONTENDERS"); do
    if [ "$fn" = "real" ]; then
      $PSQL -q -d "$DB" -tA -c "
        set role authenticated;
        set request.jwt.claim.sub = '$GUARDIAN';
        select public.book_athletes_as_guardian('$session'::uuid, array['$(athlete_id "$i")'::uuid]) ->> 'ok';" 2>/dev/null &
    else
      $PSQL -q -d "$DB" -tA -c \
        "select public.book_unlocked_for_test('$session'::uuid, '$(athlete_id "$i")'::uuid);" 2>/dev/null &
    fi
  done
  wait
}

echo "── CONTROL: count-then-insert, no lock ─────────────────────────────"
control_session="$(new_session)"
race "$control_session" "unlocked" >/dev/null
control_confirmed="$(confirmed_in "$control_session")"
if [ "$control_confirmed" -gt 1 ]; then
  echo "PASS  overbooked to $control_confirmed/1 — the harness observes the race"
else
  echo "FAIL  only $control_confirmed/1 booked; the harness is not producing a real race,"
  echo "      so the result below would prove nothing"
  exit 1
fi

echo ""
echo "── REAL: book_athletes_as_guardian ─────────────────────────────────"
failures=0
for round in $(seq 1 "$ROUNDS"); do
  session="$(new_session)"
  out="$(race "$session" "real")"
  succeeded="$(echo "$out" | grep -c '^true$' || true)"
  confirmed="$(confirmed_in "$session")"
  projection="$($PSQL -q -d "$DB" -tAc \
    "select confirmed_count from public.training_session_occupancy where training_session_id = '$session'" | tr -d '[:space:]')"

  if [ "$succeeded" = "1" ] && [ "$confirmed" = "1" ] && [ "$projection" = "1" ]; then
    echo "PASS  round $round: $CONTENDERS raced, 1 succeeded, 1/1 booked"
  else
    echo "FAIL  round $round: $succeeded reported success, $confirmed rows, projection $projection (capacity 1)"
    failures=$((failures + 1))
  fi
done

echo ""
if [ "$failures" -ne 0 ]; then
  echo "concurrency: $failures of $ROUNDS rounds failed" >&2
  exit 1
fi
echo "concurrency: $ROUNDS rounds of $CONTENDERS parallel attempts, exactly one booking each (AC-022, BR-032)"
