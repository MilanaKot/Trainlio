import { redirect } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { BottomNav } from '@/components/ui/bottom-nav'
import { ToastProvider } from '@/components/ui/toast'
import { CalendarIcon, MoreIcon, PeopleIcon } from '@/components/ui/nav-icons'
import { messages } from '@/lib/i18n'

/**
 * Coach area (coach/SPEC.md §K1, admin/SPEC.md §A0).
 *
 * Membership is checked with the same predicate the row policies and every
 * session RPC use, so a guardian who types the URL gets sent away — and would
 * be refused by the database even if they were not.
 *
 * Three tabs, like the parent's four: a coach works from a phone at the rink,
 * and everything that is not a training or a person lives behind `Více`.
 */
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getCoachWorkspace()
  if (!workspace) redirect('/moji-sportovci')

  return (
    // Around the whole group: a coach confirming a removal or a closure is
    // told by a toast, and every screen here raises one.
    <ToastProvider>
      <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-28 pt-6">{children}</div>
      <BottomNav
        // The forms are tasks, not tabs (§K3, §K11, §A4).
        hideWhen="^/trener/(novy|serie/nova)$|^/trener/vice/(organizace|treneri/[^/]+)$|/upravit$"
        items={[
          { href: '/trener', label: messages.coachNav.sessions, icon: <CalendarIcon /> },
          { href: '/trener/sportovci', label: messages.coachNav.athletes, icon: <PeopleIcon /> },
          { href: '/trener/vice', label: messages.coachNav.more, icon: <MoreIcon /> },
        ]}
      />
    </ToastProvider>
  )
}
