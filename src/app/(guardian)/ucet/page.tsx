import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getOwnProfile } from '@/server/athletes/queries'
import { formatPhone } from '@/lib/domain/phone'
import { Avatar } from '@/components/ui/avatar'
import { SignOutButton } from '@/components/staff/sign-out-button'
import { messages } from '@/lib/i18n'

const t = messages.account

/**
 * The parent's own account (guardian/SPEC.md §G13).
 *
 * The e-mail is read from the authentication record, never from a domain
 * table — `app_profiles` deliberately has no e-mail column, so there is one
 * copy of it and it is the one you sign in with.
 *
 * `Jazyk` is not here: the design hides that row until a second language
 * exists, and a settings row with one option is a question with one answer.
 */
export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Through the query, which filters by the profile the session belongs to.
  // An unfiltered read here returned several rows once staff profiles became
  // visible to guardians, and the failure rendered as an empty form.
  const profile = await getOwnProfile()
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-display text-page font-bold text-ink">{t.title}</h1>

      <section className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
        <Avatar
          firstName={profile?.firstName || '?'}
          {...(profile?.lastName ? { lastName: profile.lastName } : {})}
          size={56}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[1.0625rem] font-bold text-ink">
            {name || messages.staff.noName}
          </span>
          <span className="text-meta text-muted">{t.role}</span>
        </div>
        <Link
          href="/ucet/udaje"
          className="flex min-h-11 items-center text-row font-semibold text-primary"
        >
          {t.edit}
        </Link>
      </section>

      <ul className="flex flex-col divide-y divide-line rounded-card bg-surface px-4 shadow-card">
        <li className="flex min-h-14 items-center justify-between gap-3 py-2">
          <span className="text-row font-semibold text-ink">{t.emailRow}</span>
          <span className="truncate text-meta text-muted">{user?.email}</span>
        </li>
        <li>
          <Link
            href="/ucet/udaje"
            className="flex min-h-14 items-center justify-between gap-3 py-2"
          >
            <span className="text-row font-semibold text-ink">{t.phoneRow}</span>
            <span className="flex items-center gap-2">
              <span
                className={
                  profile?.phone ? 'text-meta text-muted' : 'text-meta font-semibold text-primary'
                }
              >
                {/* Grouped as somebody would write it down, not as it is
                    stored: a run of twelve digits is unreadable. */}
                {profile?.phone ? formatPhone(profile.phone) : t.phoneEmpty}
              </span>
              <span aria-hidden="true" className="text-subtle">
                ›
              </span>
            </span>
          </Link>
        </li>
      </ul>

      <SignOutButton />
    </main>
  )
}
