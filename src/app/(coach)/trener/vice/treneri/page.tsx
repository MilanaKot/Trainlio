import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { getWorkspaceStaff, type StaffMember } from '@/server/staff/queries'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { messages } from '@/lib/i18n'

const t = messages.staff

/** Surname first, then given name, in Czech (§A1). */
const byName = new Intl.Collator('cs')

function sortStaff(staff: StaffMember[]): StaffMember[] {
  return [...staff].sort((a, b) =>
    byName.compare(
      `${a.lastName ?? ''} ${a.firstName ?? ''}`.trim(),
      `${b.lastName ?? ''} ${b.firstName ?? ''}`.trim(),
    ),
  )
}

function Row({ member, canEdit }: { member: StaffMember; canEdit: boolean }) {
  const name = member.displayName ?? t.noName
  const meta = member.isActive
    ? member.roles.includes('WORKSPACE_ADMIN')
      ? t.roleWORKSPACE_ADMIN
      : member.hasLogin
        ? null
        : t.neverSignedIn
    : t.inactiveMeta

  const inside = (
    <>
      <Avatar
        firstName={member.firstName ?? name}
        {...(member.lastName ? { lastName: member.lastName } : {})}
        size={40}
        muted={!member.isActive}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`truncate text-body font-semibold ${member.isActive ? 'text-ink' : 'text-muted'}`}
        >
          {name}
        </span>
        {meta ? <span className="truncate text-hint text-muted">{meta}</span> : null}
      </span>
      {member.isActive ? null : <Badge variant="neutral">{t.inactive}</Badge>}
      {canEdit ? (
        <span aria-hidden="true" className="text-subtle">
          ›
        </span>
      ) : null}
    </>
  )

  // A coach who is not an administrator reads the list and cannot open a row:
  // the screen behind it would redirect them, and a link that goes nowhere is
  // worse than no link.
  return canEdit ? (
    <Link
      href={{ pathname: `/trener/vice/treneri/${member.profileId}` }}
      className="flex min-h-16 items-center gap-3 px-4 py-2"
    >
      {inside}
    </Link>
  ) : (
    <span className="flex min-h-16 items-center gap-3 px-4 py-2">{inside}</span>
  )
}

/**
 * The coaching staff (admin/SPEC.md §A1, D-11).
 *
 * Active and inactive are two sections rather than one list with a badge,
 * because they answer different questions: who can be put on a training today,
 * and who is still on last winter's. Nobody is ever deleted (AC-249).
 */
export default async function StaffPage() {
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const staff = await getWorkspaceStaff(workspace.id)
  // The database's own answer to "may this person administer the club", not a
  // role this page decided to trust.
  const canEdit = staff.some((member) => member.isEditable)

  const active = sortStaff(staff.filter((member) => member.isActive))
  const inactive = sortStaff(staff.filter((member) => !member.isActive))

  return (
    <main className="flex flex-col gap-5">
      <Link href="/trener/vice" className="flex min-h-11 items-center text-row text-muted">
        ‹ {messages.more.title}
      </Link>

      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-form-title font-bold text-ink">{t.title}</h1>
        {canEdit ? (
          <Link href="/trener/vice/treneri/novy" className={buttonVariants({ size: 'md' })}>
            {t.addCoach}
          </Link>
        ) : null}
      </div>

      {staff.length === 0 ? (
        <EmptyState
          action={
            canEdit ? (
              <Link href="/trener/vice/treneri/novy" className={buttonVariants({ size: 'md' })}>
                {t.addCoach}
              </Link>
            ) : undefined
          }
        >
          {t.empty}
        </EmptyState>
      ) : null}

      {active.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
            {t.activeCaption.replace('{count}', String(active.length))}
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-card bg-surface shadow-card">
            {active.map((member) => (
              <li key={member.profileId}>
                <Row member={member} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inactive.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
            {t.inactiveCaption.replace('{count}', String(inactive.length))}
          </h2>
          <ul className="flex flex-col divide-y divide-line rounded-card bg-surface shadow-card">
            {inactive.map((member) => (
              <li key={member.profileId}>
                <Row member={member} canEdit={canEdit} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}
