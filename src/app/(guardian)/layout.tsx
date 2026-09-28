import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BottomNav } from '@/components/ui/bottom-nav'
import { ToastProvider } from '@/components/ui/toast'
import { CalendarIcon, CheckCalendarIcon, PeopleIcon, PersonIcon } from '@/components/ui/nav-icons'
import { messages } from '@/lib/i18n'

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
    // Around the whole group, not around one screen: a toast confirms an action
    // that often navigates, and a provider inside the page it replaces would
    // unmount with it before the message was read.
    <ToastProvider>
      {/* Bottom padding clears the fixed navigation. */}
      <div className="mx-auto min-h-dvh max-w-md px-4 pb-28 pt-6">{children}</div>
      <BottomNav
        // A form is a task, not a tab (§G9, §G10): it ends with `Zrušit` at
        // the top and one button at the bottom, which would otherwise sit
        // under the navigation.
        hideWhen="^/moji-sportovci/novy$|^/ucet/udaje$|/upravit$"
        items={[
          { href: '/treninky', label: messages.nav.sessions, icon: <CalendarIcon /> },
          { href: '/moje-treninky', label: messages.nav.myBookings, icon: <CheckCalendarIcon /> },
          { href: '/moji-sportovci', label: messages.nav.myAthletes, icon: <PeopleIcon /> },
          { href: '/ucet', label: messages.nav.account, icon: <PersonIcon /> },
        ]}
      />
    </ToastProvider>
  )
}
