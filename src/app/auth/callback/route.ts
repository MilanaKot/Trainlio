import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/safe-next'

/**
 * Where Google sends a parent or a coach back (`signInWithGoogle`).
 *
 * The code is exchanged for a session here, on the server, with the PKCE
 * verifier the sign-in action left in a cookie — so a code that leaks from the
 * URL is worth nothing on another device. The first sign-in creates the
 * profile through the same trigger as a code by e-mail (migration 10), and an
 * invited coach is attached by their address exactly as then (migration 36);
 * `ensure_current_profile` covers the case the trigger did not fire.
 *
 * Any failure — the person cancelled at Google, the code expired — goes back
 * to the sign-in screen with `?chyba=google`, which says so and offers the
 * e-mail code instead.
 */
export async function GET(request: NextRequest) {
  // Back to the host that served this request: Google returned the browser
  // here, so that is the site it is on. `next` is a path, never a host.
  const site = request.nextUrl.origin
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))

  if (!code) return NextResponse.redirect(`${site}/prihlaseni?chyba=google`)

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return NextResponse.redirect(`${site}/prihlaseni?chyba=google`)

  await supabase.rpc('ensure_current_profile')
  // Google proved the address too: a pending invitation to it is accepted.
  await supabase.rpc('accept_guardian_invitations')

  return NextResponse.redirect(`${site}${next}`)
}
