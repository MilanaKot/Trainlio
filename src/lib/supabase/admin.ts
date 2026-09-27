import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { publicEnv, getServerEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Service-role client. **Bypasses row level security completely.**
 *
 * Legitimate uses are narrow and deliberate:
 *   - the notification drain job, which must read guardian email addresses from
 *     auth.users and write notification_deliveries;
 *   - administrative and support tooling.
 *
 * It is never used to serve a request on behalf of a signed-in user. Doing so
 * would discard the entire authorization model in one line: every policy in
 * supabase/schema/07 exists to stop one family reading another's data, and this
 * client ignores all of them.
 *
 * Three things keep it out of the browser: the 'server-only' import above, the
 * absence of a NEXT_PUBLIC_ prefix on its key, and a lint rule restricting
 * imports to src/server/**.
 */
export function createAdminClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv()

  return createSupabaseClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  )
}
