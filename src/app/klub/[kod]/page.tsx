import Link from 'next/link'
import type { Route } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getJoinPreview } from '@/server/club/queries'
import { JoinButton } from '@/components/club/join-button'
import { OrgLogo } from '@/components/ui/org-logo'
import { Wordmark } from '@/components/ui/wordmark'
import { buttonVariants } from '@/components/ui/button'
import { messages } from '@/lib/i18n'

const t = messages.club

/**
 * The club's link (migration 50, D-39). What a parent scans at the rink or
 * opens from the coach's message: the club, what happens next, and one
 * button. Signed out, it goes through sign-in and comes back here; signed in,
 * it records that this person came by the club's link and opens the child
 * form. Built without a design (DESIGN_REQUESTS DR-19).
 */
export default async function JoinClubPage({ params }: { params: Promise<{ kod: string }> }) {
  const { kod } = await params
  const code = kod.toUpperCase()
  const [club, supabase] = await Promise.all([getJoinPreview(code), createClient()])
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8">
      <div className="flex flex-1 flex-col gap-7">
        {club ? (
          <>
            <header className="flex items-center gap-3">
              <OrgLogo org={club} size={72} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[1.25rem]/[1.625rem] font-bold text-ink">
                  {club.name}
                </span>
                <span className="text-meta text-muted">{messages.auth.signInPurpose}</span>
              </div>
            </header>
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-page font-bold text-ink">{t.landingTitle}</h1>
              <p className="text-body text-muted">{t.landingBody}</p>
            </div>
            {user ? (
              <JoinButton code={code} />
            ) : (
              <Link
                href={`/prihlaseni?dalsi=${encodeURIComponent(`/klub/${code}`)}` as Route}
                className={buttonVariants({ size: 'lg' })}
              >
                {t.landingSignIn}
              </Link>
            )}
          </>
        ) : (
          <>
            <Wordmark className="text-[1.75rem] text-ink" />
            <div className="flex flex-col gap-2">
              <h1 className="font-display text-page font-bold text-ink">{t.landingInvalidTitle}</h1>
              <p className="text-body text-muted">{t.landingInvalidBody}</p>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
