#!/usr/bin/env node
/**
 * Acceptance-criterion coverage.
 *
 * Phase 8's exit criterion is that every acceptance criterion maps to a named
 * test. This checks that claim mechanically rather than by reading, because a
 * hand-maintained traceability table is wrong the first time a test is renamed
 * and nobody notices.
 *
 * An AC is covered when its identifier appears in a test file. That is a
 * deliberately weak proof — it says a test claims the criterion, not that the
 * test is correct — so it is a floor, not a ceiling. Its value is the opposite
 * direction: an AC that appears nowhere is definitely untested, and the exit
 * criterion is about finding those.
 *
 * Exits non-zero when any criterion is uncovered, or when a test cites an
 * identifier the specification does not define — a renamed or deleted AC whose
 * test still claims it is a silent hole.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SPEC = join(ROOT, 'docs/ACCEPTANCE_CRITERIA.md')

// Where a criterion may be claimed. Documentation is excluded on purpose: a
// plan or a contract citing an AC is a statement of intent, not coverage.
const TEST_DIRS = ['supabase/tests', 'tests/unit', 'tests/e2e']

const AC = /AC-\d{3}[a-z]?/g

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

// A criterion is declared by a line that starts with its identifier. Some
// carry a decision annotation on the same line ("AC-042a **(D-06)**"), which is
// why this is not an exact-line match.
const declared = new Set(
  readFileSync(SPEC, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = /^(AC-\d{3}[a-z]?)(\s|$)/.exec(line.trim())
      return match ? [match[1]] : []
    }),
)

if (declared.size === 0) {
  console.error('No acceptance criteria found. Has the specification moved?')
  process.exit(1)
}

/** @type {Map<string, Set<string>>} */
const coverage = new Map()
const cited = new Set()

for (const dir of TEST_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (/\.(md|snap)$/.test(file)) continue
    const contents = readFileSync(file, 'utf8')
    for (const id of contents.match(AC) ?? []) {
      cited.add(id)
      if (!coverage.has(id)) coverage.set(id, new Set())
      coverage.get(id).add(relative(ROOT, file))
    }
  }
}

const uncovered = [...declared].filter((id) => !coverage.has(id)).sort()
const unknown = [...cited].filter((id) => !declared.has(id)).sort()

const width = Math.max(...[...declared].map((id) => id.length))
for (const id of [...declared].sort()) {
  const files = coverage.get(id)
  const mark = files ? 'ok  ' : 'MISS'
  const where = files ? [...files].sort().join(', ') : '—'
  console.log(`${mark}  ${id.padEnd(width)}  ${where}`)
}

console.log('')
console.log(
  `${declared.size - uncovered.length} of ${declared.size} acceptance criteria are covered.`,
)

if (unknown.length > 0) {
  console.log('')
  console.log('Tests cite identifiers the specification does not define:')
  for (const id of unknown) console.log(`  ${id}  (${[...coverage.get(id)].sort().join(', ')})`)
}

if (uncovered.length > 0) {
  console.log('')
  console.log('Uncovered:')
  for (const id of uncovered) console.log(`  ${id}`)
}

process.exit(uncovered.length === 0 && unknown.length === 0 ? 0 : 1)
