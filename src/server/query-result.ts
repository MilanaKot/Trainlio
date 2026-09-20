import 'server-only'

import { redirect } from 'next/navigation'
import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Reading a query result without hiding its failure.
 *
 * `const { data } = await supabase...` is the shape the Supabase docs show, and
 * it is a trap in a read path: a failed query gives `data === null`, and every
 * caller here treats null as "nothing found". A parent whose session list
 * failed to load is then told "Zatím nejsou vypsané žádné tréninky" — the same
 * words they would see if the coach had genuinely published nothing.
 *
 * That is exactly what happened: an ambiguous PostgREST embed made every
 * guardian's session list render empty, silently, and no test caught it until
 * one drove the browser. So a query error is thrown. Next.js turns it into an
 * error boundary, which is a worse-looking page and a far better one: it says
 * something is broken instead of quietly lying about the data.
 *
 * `rows` and `maybeRow` are for reads. Nothing here belongs in a write path,
 * where the domain functions return a typed result the caller must branch on.
 */

function fail(where: string, error: PostgrestError): never {
  // 42501 on a read path means the request is not running as `authenticated`:
  // the session expired, or it was signed out between the navigation and the
  // render. Every table these functions touch is granted to `authenticated`,
  // and row level security answers with an empty result rather than a denial,
  // so this is never "you may not see these rows" — it is "there is nobody
  // here". An error page would be a lie about what happened; the truthful
  // response is the sign-in screen.
  if (error.code === '42501') redirect('/prihlaseni')

  // The message carries the PostgREST code, which is what makes a failure like
  // PGRST201 diagnosable from a server log rather than from a bisect.
  throw new Error(`${where} failed: ${error.code ?? 'unknown'} ${error.message}`)
}

export function rows<T>(
  where: string,
  result: { data: T[] | null; error: PostgrestError | null },
): T[] {
  if (result.error) fail(where, result.error)
  return result.data ?? []
}

export function maybeRow<T>(
  where: string,
  result: { data: T | null; error: PostgrestError | null },
): T | null {
  if (result.error) fail(where, result.error)
  return result.data
}
