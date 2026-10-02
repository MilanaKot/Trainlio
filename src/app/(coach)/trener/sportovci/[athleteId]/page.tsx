import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCoachWorkspace } from '@/server/sessions/queries'
import {
  getAthleteGuardians,
  getAthleteInternalNote,
  listAthleteSessions,
  listCoachAthletes,
} from '@/server/roster/queries'
import { signAthletePhoto } from '@/server/athletes/queries'
import { AthleteNote } from '@/components/roster/athlete-note'
import { Avatar } from '@/components/ui/avatar'
import { ContactActions } from '@/components/ui/contact-actions'
import { DetailList } from '@/components/ui/detail-list'
import { formatPhone } from '@/lib/domain/phone'
import {
  HOCKEY_POSITION_LABELS,
  STICK_SIDE_LABELS,
  type HockeyPosition,
  type StickSide,
} from '@/lib/enums/hockey'
import { formatBirthDate, formatDateShort, formatTimeRange } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.coach

/**
 * One athlete, as a coach reads them (coach/SPEC.md §K13).
 *
 * Read-only but for the note, and deliberately: the profile is the parent's
 * record of their own child, kept in their own app. What the club owns is what
 * the club wrote down — the internal note — and the way to reach the family.
 */
export default async function CoachAthletePage({
  params,
}: {
  params: Promise<{ athleteId: string }>
}) {
  const { athleteId } = await params
  const workspace = await getCoachWorkspace()
  if (!workspace) notFound()

  const athletes = await listCoachAthletes(workspace.id)
  const athlete = athletes.find((a) => a.id === athleteId)
  // Not found rather than forbidden: the function answers only for the staff of
  // this club, so "not ours" and "no such athlete" are the same answer.
  if (!athlete) notFound()

  const [guardians, sessions, note, photoUrl] = await Promise.all([
    getAthleteGuardians(athleteId),
    listAthleteSessions(workspace.id, athleteId),
    getAthleteInternalNote(workspace.id, athleteId),
    signAthletePhoto(athlete.photoPath),
  ])

  // The function returns newest first, which is what the past wants; what is
  // still to come reads forwards, so it is sorted rather than reversed in place.
  const now = new Date().getTime()
  const upcoming = sessions
    .filter((s) => new Date(s.endAt).getTime() >= now && s.bookingStatus === 'CONFIRMED')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
  const past = sessions.filter((s) => new Date(s.endAt).getTime() < now)

  return (
    <main className="flex flex-col gap-5 pb-8">
      <Link
        href="/trener/sportovci"
        className="flex min-h-11 items-center gap-1 text-row text-muted"
      >
        <span aria-hidden="true">‹</span> {t.athletesTitle}
      </Link>

      <header className="flex items-center gap-3">
        <Avatar
          firstName={athlete.firstName}
          lastName={athlete.lastName}
          {...(photoUrl ? { photoUrl } : {})}
          size={72}
          muted={!athlete.isActive}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-page font-bold text-ink">
            {athlete.firstName} {athlete.lastName}
          </h1>
          <p className="text-meta text-muted">
            {t.athleteBorn
              .replace('{year}', String(athlete.birthYear))
              .replace('{date}', formatBirthDate(athlete.dateOfBirth))}
          </p>
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {messages.sports.HOCKEY}
        </h2>
        <DetailList
          items={[
            {
              term: messages.athlete.position,
              value: athlete.positionCode
                ? HOCKEY_POSITION_LABELS[athlete.positionCode as HockeyPosition]
                : null,
            },
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
      </section>

      {/* §K13: every active guardian, not "the parent" — BR-002 has allowed
          several since the first migration, and a coach trying to reach the
          family should not have one of them hidden. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.athleteGuardians}
        </h2>
        <ul className="flex flex-col gap-2">
          {guardians.map((guardian) => (
            <li
              key={guardian.profileId}
              className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-row font-bold text-ink">
                  {guardian.displayName ?? messages.staff.noName}
                </span>
                <span className="text-meta text-muted">
                  {t.athleteGuardianRole} ·{' '}
                  {guardian.phone ? formatPhone(guardian.phone) : t.athleteNoPhone}
                </span>
              </span>
              <span className="ml-auto">
                <ContactActions
                  phone={guardian.phone}
                  name={guardian.displayName ?? ''}
                  layout="icons"
                />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <AthleteNote workspaceId={workspace.id} athleteId={athleteId} note={note} />

      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
          {t.athleteUpcomingCaption.replace('{count}', String(upcoming.length))}
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-row text-muted">{t.athleteNoUpcoming}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.map((session) => (
              <li key={session.sessionId}>
                <Link
                  href={`/trener/${session.sessionId}`}
                  className="flex min-h-14 items-center gap-3 rounded-card bg-surface p-3 shadow-card"
                >
                  <span className="nums font-display text-row font-bold text-ink">
                    {formatTimeRange(
                      new Date(session.startAt),
                      new Date(session.endAt),
                      workspace.timezone,
                    )}
                  </span>
                  <span className="text-meta text-muted">
                    {[
                      formatDateShort(new Date(session.startAt), workspace.timezone),
                      session.facilityCode,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="ml-auto text-subtle" aria-hidden="true">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {past.length > 0 ? (
          <p className="text-meta text-muted">
            {t.athletePastLink.replace('{count}', String(past.length))}
          </p>
        ) : null}
      </section>
    </main>
  )
}
