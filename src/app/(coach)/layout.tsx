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
      {/* Every target here is thumb-sized. A coach reads this header at the
          rink, on a phone, often with gloves half off — a 20px text link is
          reachable with a mouse and not with a thumb. */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            href="/trener"
            className="flex min-h-11 items-center text-sm font-semibold"
          >
            {workspace.name}
          </Link>
          <Link
            href="/trener/serie"
            className="flex min-h-11 items-center px-2 text-sm opacity-70"
          >
            {messages.coach.series}
          </Link>
        </div>
        <form
          action={async () => {
            'use server'
            await signOut()
          }}
        >
          <button
            type="submit"
            className="flex min-h-11 items-center px-2 text-sm underline opacity-70"
          >
            {messages.auth.signOut}
          </button>
        </form>
      </header>
      {children}
    </div>
  )
}
