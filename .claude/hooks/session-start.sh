#!/bin/bash
#
# Trainlio — makes a fresh Claude Code on the web container able to run the
# suites.
#
# Three things have to be true before a single test can run, and none of them
# survive a container restart:
#
#   * node modules are installed;
#   * a Docker daemon is running, and stays running — it has died mid-suite,
#     which reads as every database call failing with "fetch failed";
#   * the local Supabase stack is up, migrated and seeded, and `.env.local`
#     holds the keys `supabase start` generated for it.
#
# Idempotent: each step checks before it acts, so a resumed session costs
# seconds rather than minutes.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-/home/user/Trainlio}"

log() { echo "[session-start] $*"; }

# --- dependencies ----------------------------------------------------------
corepack enable >/dev/null 2>&1 || true
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  log 'installing node modules'
  pnpm install --prefer-offline || log 'pnpm install failed'
fi

# --- the Docker daemon, and a supervisor that brings it back ---------------
if ! docker info >/dev/null 2>&1; then
  log 'starting dockerd'
  setsid nohup bash -c 'while true; do dockerd; sleep 3; done' \
    >/tmp/dockerd.log 2>&1 </dev/null &

  for _ in $(seq 1 60); do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi

docker info >/dev/null 2>&1 || { log 'no Docker daemon; stopping here'; exit 0; }

# --- the Supabase stack ----------------------------------------------------
api_up() { [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/rest/v1/)" = '200' ]; }
db_up() { pg_isready -h 127.0.0.1 -p 54322 -U postgres >/dev/null 2>&1; }

if ! api_up; then
  log 'starting the Supabase stack'
  pnpm db:start >/tmp/supabase-start.log 2>&1 || log 'supabase start reported an error'
fi

for _ in $(seq 1 90); do
  api_up && db_up && break
  sleep 2
done

if api_up && db_up; then
  log 'Supabase is up'
else
  log 'Supabase did not come up; see /tmp/supabase-start.log'
fi

# --- the things every command in this repository expects -------------------
# Generated from the running stack, and never overwritten: the script refuses
# if a real `.env.local` is already there.
[ -f .env.local ] || pnpm env:local >/dev/null 2>&1 || log 'could not write .env.local'

# The preinstalled Chromium does not match the build Playwright downloads, and
# every browser run needs to be pointed at it.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

log 'ready'
