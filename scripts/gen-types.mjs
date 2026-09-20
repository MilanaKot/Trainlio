/**
 * Generate src/types/database.generated.ts from a live database.
 *
 * `supabase gen types` is the canonical command and stays in package.json, but
 * it launches pg-meta in a container. This script calls the same two libraries
 * that container runs — @supabase/postgres-meta to introspect and
 * @supabase/postgrest-typegen to render — so the output is the generator's own,
 * not a lookalike, and it works wherever Postgres is reachable.
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
