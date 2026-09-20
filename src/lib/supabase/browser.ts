'use client'

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Browser client, carrying the signed-in user's JWT.
 *
 * Every read through this client is filtered by row level security, and every
 * mutation that matters is refused: guardians hold no write grant on bookings
 * and coaches none on sessions (PERMISSIONS). Mutations go through Server
 * Actions that call the domain functions.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
