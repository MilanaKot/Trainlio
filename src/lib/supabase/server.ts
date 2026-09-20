import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Request-scoped server client, carrying the caller's JWT.
 *
 * This is the default for all server-side data access. It uses the anon key, so
 * row level security applies exactly as it does in the browser — server code
 * gets no ambient authority. Use the admin client only where a job genuinely
 * acts as the system.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by the middleware instead.
          }
        },
      },
    },
  )
}
