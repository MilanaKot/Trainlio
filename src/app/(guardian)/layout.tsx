import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/layout/bottom-nav'

/**
 * Everything in this group requires a signed-in guardian.
 *
 * The redirect is a convenience, not the protection: row level security is what
 * stops an unauthenticated request reading anything, and it applies whether or
 * not this check runs.
 */
export default async function GuardianLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/prihlaseni')

  return (
    <>
      {/* Bottom padding clears the fixed navigation. */}
      <div className="mx-auto min-h-dvh max-w-md px-4 pb-24 pt-6">{children}</div>
      <BottomNav />
    </>
  )
}
