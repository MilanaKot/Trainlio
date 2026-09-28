import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getManagedOrganization } from '@/server/organization/queries'
import { OrganizationForm } from '@/components/organization/organization-form'
import { messages } from '@/lib/i18n'

const t = messages.organization

/**
 * The club's name and mark (admin/SPEC.md §A4).
 *
 * A coach who is not an administrator is sent away here rather than shown a
 * read-only screen: `canEdit` is `is_workspace_admin`, the same predicate the
 * storage policy and both domain functions use, so the redirect and the
 * refusal cannot disagree.
 */
export default async function OrganizationPage() {
  const organization = await getManagedOrganization()
  if (!organization) notFound()
  if (!organization.canEdit) redirect('/trener')

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/trener" className="flex min-h-11 items-center text-row text-muted">
          ‹ {t.back}
        </Link>
        <h1 className="font-display text-form-title font-bold text-ink">{t.title}</h1>
      </div>

      <OrganizationForm
        workspaceId={organization.id}
        organization={organization}
        canEdit={organization.canEdit}
      />
    </main>
  )
}
