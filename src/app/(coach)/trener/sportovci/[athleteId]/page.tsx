import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import { currentWithdrawals } from '@/lib/domain/guardian-response'
import {
  getAthleteGuardians,
  getAthleteInternalNote,
  listAthleteSessions,
  listCoachAthletes,
} from '@/server/roster/queries'
import { signAthletePhoto } from '@/server/athletes/queries'
import { getCoachRights } from '@/server/staff/queries'
import { AthleteNote } from '@/components/roster/athlete-note'
import { BackLink } from '@/components/player/back-link'
import { CardTabs } from '@/components/player/card-tabs'
import { CARD_TABS, type CardTab } from '@/components/player/card-tab'
import { MessagesTab } from '@/components/player/messages-tab'
import { TrainingsTab, type CardSession } from '@/components/player/trainings-tab'
import { Avatar } from '@/components/ui/avatar'
import { ContactActions, PhoneIcon } from '@/components/ui/contact-actions'
import { DetailList } from '@/components/ui/detail-list'
import { canEditSession } from '@/lib/domain/coach-rights'
import { parsePeriod } from '@/lib/period'
import { formatPhone } from '@/lib/domain/phone'
import {
  HOCKEY_POSITION_LABELS,
  STICK_SIDE_LABELS,
  type HockeyPosition,
  type StickSide,
} from '@/lib/enums/hockey'
import { formatBirthDate } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach.card

/**
 * The player card (coach/SPEC.md K13, handoff v3.4, decision 43).
 *
 * One athlete across four tabs: their trainings with attendance and payment,
 * the profile and the staff's general note, the family, and the per-training
 * notes and messages. Opened from a K2 card and from K12.
 *
 * Whether a training's toggles, note and message can be changed is
 * canEdit(session), training by training (decision 33): an assistant may
 * read every row and change only the trainings they lead.
 */
export default async function PlayerCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>
  searchParams: Promise<{ tab?: string; obdobi?: string }>
}) {
  const { athleteId } = await params
  const query = await searchParams
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const athletes = await listCoachAthletes(workspace.id)
  const athlete = athletes.find((a) => a.id === athleteId)
  // Not found rather than forbidden: the function answers only for the staff of
  // this club, so "not ours" and "no such athlete" are the same answer.
  if (!athlete) notFound()

  const tab: CardTab = CARD_TABS.includes(query.tab as CardTab)
    ? (query.tab as CardTab)
    : 'treninky'
  const period = parsePeriod(query.obdobi, 'month', new Date(), workspace.timezone)

  const [guardians, sessions, note, photoUrl, rights] = await Promise.all([
    getAthleteGuardians(athleteId),
    listAthleteSessions(workspace.id, athleteId),
    getAthleteInternalNote(workspace.id, athleteId),
    signAthletePhoto(athlete.photoPath),
    getCoachRights(),
  ])

  // A booking that was withdrawn or removed, or a training that was called
  // off, is not attendance and not a payment (decision 40).
  const active: CardSession[] = sessions
    .filter((s) => s.bookingStatus === 'CONFIRMED' && s.status !== 'CANCELLED')
    .map((s) => ({ ...s, editable: canEditSession(rights, { mainCoachId: s.mainCoachId }) }))
  // v3.7: a withdrawal (`Nepůjde`) is the family's answer, shown with its
  // reason and counted as Nebyl (decision 54).
  const withdrawals = currentWithdrawals(sessions)

  const name = `${athlete.firstName} ${athlete.lastName}`
  const position = athlete.positionCode
    ? HOCKEY_POSITION_LABELS[athlete.positionCode as HockeyPosition]
    : null

  return (
    <main className="flex flex-col gap-4 pb-8">
      <BackLink />

      <header className="flex items-center gap-3">
        <Avatar
          firstName={athlete.firstName}
          lastName={athlete.lastName}
          {...(photoUrl ? { photoUrl } : {})}
          size={56}
          muted={!athlete.isActive}
        />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-[2rem]/[2.25rem] font-bold text-ink">{name}</h1>
          <p className="truncate text-meta text-muted">
            {[
              t.meta.replace('{year}', String(athlete.birthYear)),
              position,
              athlete.jerseyNumber ? `#${athlete.jerseyNumber}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      <CardTabs value={tab} />

      {tab === 'treninky' ? (
        <TrainingsTab
          athleteName={name}
          sessions={active}
          withdrawals={withdrawals}
          period={period}
          timezone={workspace.timezone}
        />
      ) : null}

      {tab === 'hrac' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <DetailList
              items={[
                { term: t.born, value: formatBirthDate(athlete.dateOfBirth) },
                { term: messages.athlete.position, value: position },
                {
                  term: messages.athlete.stickSide,
                  value: athlete.stickSideCode
                    ? STICK_SIDE_LABELS[athlete.stickSideCode as StickSide]
                    : null,
                },
                { term: messages.athlete.jerseyNumber, value: athlete.jerseyNumber },
                { term: messages.athlete.team, value: athlete.teamName },
              ]}
            />
            <p className="px-1 text-hint text-muted">{t.filledByParent}</p>
          </div>
          {/* Never reaches a guardian: its own table, staff-only (D-13). */}
          <AthleteNote
            workspaceId={workspace.id}
            athleteId={athleteId}
            note={note}
            editable={rights.canEditAll}
            caption={t.playerNote}
          />
        </div>
      ) : null}

      {tab === 'rodice' ? (
        guardians.length === 0 ? (
          <p className="text-meta text-muted">{t.noGuardians}</p>
        ) : (
          // Every active guardian, not "the parent" (BR-002).
          <ul className="flex flex-col gap-2">
            {guardians.map((guardian) => (
              <li
                key={guardian.profileId}
                className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card"
              >
                <div className="flex items-start gap-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[1rem]/[1.3125rem] font-bold text-ink">
                      {guardian.displayName ?? messages.staff.noName}
                    </span>
                    <span className="text-meta text-muted">
                      {guardian.books ? `${t.parentRole} · ${t.books}` : t.parentRole}
                    </span>
                  </span>
                  <ContactActions
                    phone={guardian.phone}
                    name={guardian.displayName ?? ''}
                    layout="icons"
                  />
                </div>
                <span className="flex items-center gap-2 text-meta">
                  <PhoneIcon className="size-4 text-muted" />
                  {guardian.phone ? (
                    <span className="text-ink">{formatPhone(guardian.phone)}</span>
                  ) : (
                    <span className="text-muted">{t.noPhone}</span>
                  )}
                </span>
                {guardian.email ? (
                  <span className="flex min-w-0 items-center gap-2 text-meta text-ink">
                    <MailIcon />
                    <span className="truncate">{guardian.email}</span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'zpravy' ? (
        <MessagesTab sessions={active} withdrawals={withdrawals} timezone={workspace.timezone} />
      ) : null}
    </main>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0 text-muted" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
