import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getManagedOrganization } from '@/server/organization/queries'
import { getOwnProfile } from '@/server/athletes/queries'
import { getWorkspaceStaff } from '@/server/staff/queries'
import { Avatar } from '@/components/ui/avatar'
import { OrgLogo } from '@/components/ui/org-logo'
import { SignOutButton } from '@/components/staff/sign-out-button'
import { messages } from '@/lib/i18n'

const t = messages.more

function Chevron() {
  return (
    <span aria-hidden="true" className="text-subtle">
      ›
    </span>
  )
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">{children}</h2>
  )
}

/**
 * The coach's own screen (admin/SPEC.md §A0).
 *
 * `SPRÁVA` appears only for an administrator, and not because this page knows
 * who is one: `canEdit` is `is_workspace_admin`, the same predicate the screens
 * behind these rows redirect on and the same one the domain functions check
 * before they write anything.
 */
export default async function MorePage() {
  const organization = await getManagedOrganization()
  if (!organization) notFound()

  const profile = await getOwnProfile()
  const staff = organization.canEdit ? await getWorkspaceStaff(organization.id) : []

  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')

  return (
    <main className="flex flex-col gap-5">
      <h1 className="font-display text-page font-bold text-ink">{t.title}</h1>

      <section className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
        {/* `||`, not `??`: a profile with no name yet is an empty string, and
            an avatar with no initials at all reads as a broken image. */}
        <Avatar firstName={profile?.firstName || '?'} lastName={profile?.lastName} size={56} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[1.0625rem] font-bold text-ink">
            {name || messages.staff.noName}
          </span>
          <span className="text-meta text-muted">
            {organization.canEdit ? t.roleAdmin : t.roleCoach}
          </span>
        </div>
      </section>

      {organization.canEdit ? (
        <section className="flex flex-col gap-2.5">
          <Caption>{t.manageCaption}</Caption>
          <ul className="flex flex-col rounded-card bg-surface px-4 shadow-card">
            <li className="border-b border-line last:border-0">
              <Link
                href="/trener/vice/organizace"
                className="flex min-h-14 items-center gap-3 py-2 text-row font-semibold text-ink"
              >
                <OrgLogo org={organization} size={28} />
                <span className="flex-1">{t.organization}</span>
                <span className="text-meta font-normal text-muted">{t.organizationValue}</span>
                <Chevron />
              </Link>
            </li>
            <li>
              <Link
                href="/trener/vice/treneri"
                className="flex min-h-14 items-center gap-3 py-2 text-row font-semibold text-ink"
              >
                <span className="flex size-7 items-center justify-center rounded-chip bg-primary-100 text-hint font-bold text-primary">
                  {staff.length}
                </span>
                <span className="flex-1">{t.coaches}</span>
                <Chevron />
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <Caption>{t.accountCaption}</Caption>
        <ul className="flex flex-col rounded-card bg-surface px-4 shadow-card">
          <li>
            <Link
              href="/ucet"
              className="flex min-h-14 items-center gap-3 py-2 text-row font-semibold text-ink"
            >
              <span className="flex-1">{t.personalDetails}</span>
              <Chevron />
            </Link>
          </li>
        </ul>
      </section>

      <SignOutButton />
    </main>
  )
}
