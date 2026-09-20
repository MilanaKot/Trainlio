import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { signOut } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'

/**
 * Coach area.
 *
 * Membership is checked with the same predicate the row policies and every
 * session RPC use, so a guardian who types the URL gets sent away — and would
 * be refused by the database even if they were not.
 *
 * Responsive rather than bottom-navigated: coaches work on a phone at the rink
 * and on a laptop when planning (UI_SPEC).
 */
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getCoachWorkspace()
  if (!workspace) redirect('/moji-sportovci')

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/trener" className="text-sm font-semibold">
            {workspace.name}
          </Link>
          <Link href="/trener/serie" className="text-sm opacity-70">
            {messages.coach.series}
          </Link>
        </div>
        <form
          action={async () => {
            'use server'
            await signOut()
          }}
        >
          <button type="submit" className="text-sm underline opacity-70">
            {messages.auth.signOut}
          </button>
        </form>
      </header>
      {children}
    </div>
  )
}
