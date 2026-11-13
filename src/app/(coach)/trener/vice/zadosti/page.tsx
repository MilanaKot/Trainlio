import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getManagedOrganization } from '@/server/organization/queries'
import { listJoinRequests } from '@/server/club/queries'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { JoinRequestList } from '@/components/club/join-request-list'
import { DEFAULT_TIMEZONE } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.access

/**
 * `Žádosti o přijetí` (migration 50, D-40): the children who came by the
 * club's link and wait, with the family to ring, and those turned away. The
 * administrator's only — the function behind it answers nobody else.
 */
export default async function JoinRequestsPage() {
  const organization = await getManagedOrganization()
  if (!organization) notFound()
  if (!organization.canEdit) redirect('/trener')

  const [requests, workspace] = await Promise.all([
    listJoinRequests(organization.id),
    getCoachWorkspace(),
  ])

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/trener/vice" className="flex min-h-11 items-center text-row text-muted">
          ‹ {messages.more.title}
        </Link>
        <h1 className="font-display text-form-title font-bold text-ink">{t.requestsTitle}</h1>
        <p className="text-meta text-muted">{t.requestsIntro}</p>
      </div>

      <JoinRequestList requests={requests} timezone={workspace?.timezone ?? DEFAULT_TIMEZONE} />
    </main>
  )
}
