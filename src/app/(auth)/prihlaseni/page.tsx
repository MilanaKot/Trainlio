import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPublicOrganization } from '@/server/organization/queries'
import { OrgLogo } from '@/components/ui/org-logo'
import { Wordmark } from '@/components/ui/wordmark'
import { messages } from '@/lib/i18n'
import { SignInForm } from './sign-in-form'

const t = messages.auth

/**
 * Sign in (guardian/SPEC.md §G11).
 *
 * The club is at the top, above everything else: a parent arriving from a link
 * their coach sent should recognise where they are before they are asked for
 * anything. It is read through `organization_identity()`, which answers without
 * a session — and answers with nothing when more than one club is active,
 * because from an anonymous request there is no way to tell which one the
 * visitor came for. Then this falls back to the product's own mark rather than
 * showing the wrong crest.
 */
export default async function SignInPage() {
  const supabase = await createClient()

  // getUser() revalidates against the auth server. getSession() only reads the
  // cookie, so it must never gate a redirect.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/')

  const organization = await getPublicOrganization()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8">
      <div className="flex flex-1 flex-col gap-7">
        <header className="flex items-center gap-3">
          {organization ? (
            <>
              <OrgLogo org={organization} size={72} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[1.25rem]/[1.625rem] font-bold text-ink">
                  {organization.name}
                </span>
                <span className="text-meta text-muted">{t.signInPurpose}</span>
              </div>
            </>
          ) : (
            <Wordmark className="text-[1.75rem] text-ink" />
          )}
        </header>

        <SignInForm />
      </div>

      <footer className="flex items-center justify-center gap-1.5 pt-8 text-hint font-normal text-muted">
        {t.poweredBy} <Wordmark className="text-[1rem] text-ink" />
      </footer>
    </main>
  )
}
