/**
 * Generate src/types/database.generated.ts from a live database.
 *
 * `supabase gen types --local` is the canonical command and stays in
 * package.json. This script exists as a fallback for environments without
 * Docker: it calls the same two libraries the CLI runs in its container —
 * @supabase/postgres-meta to introspect and @supabase/postgrest-typegen to
 * render — so the output is the generator's own, not a lookalike.
 *
 * Verified against the CLI: the only difference is that these package versions
 * render a NOT NULL jsonb column as `NonNullable<Json>` where the CLI's bundled
 * version renders `Json`. Prefer `pnpm db:types` when Docker is available.
 *
 *   node scripts/gen-types.mjs "postgresql://postgres@127.0.0.1:54322/postgres"
 */
import { writeFileSync } from 'node:fs'
import { PostgresMeta } from '@supabase/postgres-meta'
import { generateTypescript } from '@supabase/postgrest-typegen'
import { getGeneratorMetadata } from '@supabase/postgres-meta/dist/lib/generators.js'

const connectionString = process.argv[2]
const out = process.argv[3] ?? 'src/types/database.generated.ts'

if (!connectionString) {
  console.error('usage: node scripts/gen-types.mjs <connection-string> [outfile]')
  process.exit(1)
}

const pgMeta = new PostgresMeta({ connectionString, max: 1 })
const { data, error } = await getGeneratorMetadata(pgMeta, { includedSchemas: ['public'] })

if (error) {
  console.error(`introspection failed: ${error.message}`)
  process.exit(1)
}

const types = await generateTypescript(data, {
  schemas: ['public'],
  detectOneToOneRelationships: true,
})

writeFileSync(out, types)
console.log(`wrote ${out}`)
