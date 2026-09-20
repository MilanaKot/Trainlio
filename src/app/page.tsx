import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * The root sends people where they belong: signed-in guardians to their
 * athletes, everyone else to sign-in. The coach area arrives in Phase 3 and
 * branches here on workspace membership.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  redirect(user ? '/moji-sportovci' : '/prihlaseni')
}
