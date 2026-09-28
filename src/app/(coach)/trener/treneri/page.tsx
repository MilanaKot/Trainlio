import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getWorkspaceStaff } from '@/server/staff/queries'
import { StaffList } from '@/components/staff/staff-list'
import { messages } from '@/lib/i18n'

/**
 * The coaching staff (D-11, DESIGN_BRIEF §34).
 *
 * Every member of the club's staff sees the list; only an administrator is
 * offered the controls, and that offer comes from the database rather than from
 * a role this page decided to trust.
 */
export default async function StaffPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const staff = await getWorkspaceStaff(workspace.id)
  const canAdd = staff.some((member) => member.isEditable)

  return (
    <main className="flex flex-col gap-4">
      <Link href="/trener/vice" className="flex min-h-11 items-center text-row text-muted">
        ‹ {messages.more.title}
      </Link>
      <h1 className="font-display text-form-title font-bold text-ink">{messages.staff.title}</h1>
      <p className="text-sm opacity-70">{messages.staff.intro}</p>
      <StaffList workspaceId={workspace.id} staff={staff} canAdd={canAdd} />
    </main>
  )
}
