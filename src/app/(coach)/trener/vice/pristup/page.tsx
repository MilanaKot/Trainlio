import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getManagedOrganization } from '@/server/organization/queries'
import { getJoinLink } from '@/server/club/queries'
import { JoinLinkPanel } from '@/components/club/join-link-panel'
import { DEFAULT_TIMEZONE, formatDateAtTime } from '@/lib/time/workspace-time'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { messages } from '@/lib/i18n'

const t = messages.access

/**
 * `Přístup do klubu` (migration 50, D-39): the club's link and its QR code,
 * for the rink's door or the parents' chat, and a way to replace it when it
 * has gone further than it should. The administrator's only. Built without a
 * design (DESIGN_REQUESTS DR-19).
 */
export default async function AccessPage() {
  const organization = await getManagedOrganization()
  if (!organization) notFound()
  if (!organization.canEdit) redirect('/trener')

  const [link, workspace] = await Promise.all([getJoinLink(organization.id), getCoachWorkspace()])
  if (!link) redirect('/trener')
  const timezone = workspace?.timezone ?? DEFAULT_TIMEZONE

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/trener/vice" className="flex min-h-11 items-center text-row text-muted">
          ‹ {messages.more.title}
        </Link>
        <h1 className="font-display text-form-title font-bold text-ink">{t.title}</h1>
        <p className="text-meta text-muted">{t.intro}</p>
      </div>

      <JoinLinkPanel
        workspaceId={organization.id}
        url={link.url}
        qrSvg={link.qrSvg}
        clubName={organization.name}
        rotatedLabel={
          link.rotatedAt
            ? t.rotatedAt.replace('{when}', formatDateAtTime(new Date(link.rotatedAt), timezone))
            : null
        }
      />
    </main>
  )
}
