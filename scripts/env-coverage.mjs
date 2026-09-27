#!/usr/bin/env node
/**
 * Environment configuration coverage.
 *
 * `src/lib/env.ts` is the single declaration of what Trainlio needs to run.
 * Three other places have to agree with it, and all three drift silently:
 *
 *   - `.env.example`, which is how a new contributor learns what to set;
 *   - the `env:` block of every CI job that runs a command loading the config;
 *   - the explicit `process.env.KEY` reads inside `env.ts` itself, which Next
 *     requires for `NEXT_PUBLIC_*` because it inlines only statically
 *     analysable member expressions.
 *
 * None of that is visible locally: Next loads `.env.local` automatically, so
 * every command passes on a machine that has one. The gap exists only on a
 * runner that does not — which is exactly how NEXT_PUBLIC_SITE_URL and
 * AUTH_SENDER_EMAIL went missing from the `verify` job until the first CI run
 * on the first pull request.
 *
 * Exits non-zero on a missing variable, and on one declared somewhere that the
 * schema no longer defines — a renamed variable whose old name lingers in CI is
 * the same silent hole in the other direction.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const ENV_TS = join(ROOT, 'src/lib/env.ts')
const ENV_EXAMPLE = join(ROOT, '.env.example')
const WORKFLOW = join(ROOT, '.github/workflows/ci.yml')

/**
 * Commands that load `next.config.ts`, and through it the schemas.
 *
 * `pnpm test` is absent on purpose: Vitest never loads the Next config, so a
 * job that only runs unit tests genuinely needs nothing configured.
 */
const LOADS_CONFIG =
  /\b(next\s+(build|dev|start|typegen)|pnpm\s+(build|typecheck|start|dev|test:e2e)|playwright\s+test)\b/

const problems = []
const fail = (message) => problems.push(message)

// --- what the schemas declare -----------------------------------------------

const envSource = readFileSync(ENV_TS, 'utf8')

/** Keys of one `z.object({ ... })` literal, with whether each has a default. */
function schemaKeys(name) {
  const start = envSource.indexOf(`const ${name} = z.object({`)
  if (start === -1) {
    fail(`src/lib/env.ts no longer declares ${name}. This checker needs updating.`)
    return []
  }

  // Balanced-brace scan from the opening `{` of the object literal.
  const from = envSource.indexOf('{', envSource.indexOf('z.object(', start))
  let depth = 0
  let end = from
  for (; end < envSource.length; end += 1) {
    if (envSource[end] === '{') depth += 1
    else if (envSource[end] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }

  const body = envSource.slice(from + 1, end)
  const lines = body.split('\n')
  const keys = []

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s{2}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(lines[i])
    if (!match) continue

    // A definition may wrap, so take everything up to the next key.
    let definition = match[2]
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s{2}[A-Z][A-Z0-9_]*:/.test(lines[j])) break
      definition += lines[j]
    }

    keys.push({
      name: match[1],
      optional: /\.default\(|\.optional\(/.test(definition),
    })
  }

  return keys
}

const declared = [...schemaKeys('publicSchema'), ...schemaKeys('serverSchema')]
const required = declared.filter((k) => !k.optional).map((k) => k.name)
const all = declared.map((k) => k.name)

if (declared.length === 0) {
  console.error('No environment variables found in src/lib/env.ts. Has it moved?')
  process.exit(1)
}

// --- env.ts reads each of them explicitly -----------------------------------

for (const key of all) {
  if (!envSource.includes(`process.env.${key}`)) {
    fail(
      `src/lib/env.ts declares ${key} but never reads process.env.${key}. ` +
        'Next inlines NEXT_PUBLIC_* only for statically analysable member ' +
        'expressions, so the read has to be written out.',
    )
  }
}

// --- .env.example ------------------------------------------------------------

const example = readFileSync(ENV_EXAMPLE, 'utf8')
const exampleKeys = new Set(
  example
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter(Boolean),
)

for (const key of required) {
  if (!exampleKeys.has(key)) fail(`.env.example is missing ${key}`)
}
for (const key of exampleKeys) {
  if (!all.includes(key)) fail(`.env.example sets ${key}, which no schema declares`)
}

// --- the CI workflow ---------------------------------------------------------

/**
 * Job-level `env:` blocks and the commands each job runs.
 *
 * A narrow reader rather than a YAML parser, because adding a dependency to
 * read one file we control is worse than a reader that knows its own shape:
 * jobs at two spaces, their `env:` at four, its keys at six. A step-level
 * `env:` (eight spaces) is deliberately not collected — those are a step's own
 * names, not the application's configuration.
 */
function readWorkflow() {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n')
  const jobs = []
  let current = null
  let inEnv = false
  let inJobs = false

  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true
      continue
    }
    if (!inJobs) continue

    const jobStart = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobStart) {
      current = { name: jobStart[1], env: new Set(), commands: '' }
      jobs.push(current)
      inEnv = false
      continue
    }
    if (!current) continue

    if (/^ {4}env:\s*$/.test(line)) {
      inEnv = true
      continue
    }
    if (inEnv) {
      const entry = /^ {6}([A-Za-z_][A-Za-z0-9_]*):/.exec(line)
      if (entry) {
        current.env.add(entry[1])
        continue
      }
      // Anything else at four spaces or less ends the block; a comment or a
      // blank line inside it does not.
      if (line.trim() !== '' && !line.trim().startsWith('#') && /^ {0,4}\S/.test(line)) {
        inEnv = false
      }
    }

    // Comments are stripped so a command named in prose is not mistaken for
    // one the job runs.
    const code = line.replace(/#.*$/, '')
    if (/(^|\s)run:/.test(code) || /^\s{8,}\S/.test(code)) current.commands += code + '\n'
  }

  return jobs
}

const jobs = readWorkflow()
if (jobs.length === 0) fail('No jobs found in .github/workflows/ci.yml. Has it moved?')

for (const job of jobs) {
  const needsConfig = LOADS_CONFIG.test(job.commands)
  const missing = required.filter((key) => !job.env.has(key))

  if (needsConfig && missing.length > 0) {
    fail(
      `CI job "${job.name}" runs a command that loads the configuration but ` +
        `does not set: ${missing.join(', ')}`,
    )
  }

  // A job that sets some of them and not others is the specific shape of the
  // original failure, and is wrong whether or not the command detection agrees.
  if (!needsConfig && missing.length > 0 && missing.length < required.length) {
    fail(
      `CI job "${job.name}" sets part of the configuration and not the rest. ` +
        `Missing: ${missing.join(', ')}`,
    )
  }

  for (const key of job.env) {
    if (key.startsWith('NEXT_PUBLIC_') && !all.includes(key)) {
      fail(`CI job "${job.name}" sets ${key}, which no schema declares`)
    }
  }
}

// --- report -------------------------------------------------------------------

const width = Math.max(...all.map((k) => k.length))
for (const { name, optional } of declared) {
  const where = [
    exampleKeys.has(name) ? '.env.example' : null,
    ...jobs.filter((j) => j.env.has(name)).map((j) => `ci:${j.name}`),
  ].filter(Boolean)
  console.log(`${optional ? 'opt ' : 'req '}  ${name.padEnd(width)}  ${where.join(', ') || '—'}`)
}

console.log('')
if (problems.length === 0) {
  console.log(`${declared.length} environment variables declared, and everything agrees.`)
  process.exit(0)
}

console.log('Problems:')
for (const problem of problems) console.log(`  ${problem}`)
process.exit(1)
