import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Runs before every matched request (the `proxy` convention, which replaced
 * `middleware` in Next 16).
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and images. Auth session refresh must run
     * on real navigations, not on every icon fetch.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
