import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getAthleteAttendance,
  listGuardianAthletes,
  listJoinableWorkspaces,
} from '@/server/athletes/queries'
import { listGuardianInvitations } from '@/server/club/queries'
import { AttendanceBlock } from '@/components/athlete/attendance-block'
import { GuardiansSection } from '@/components/club/guardians-section'
import { MembershipNotice } from '@/components/club/membership-notice'
import { parsePeriod } from '@/lib/period'
import { Avatar } from '@/components/ui/avatar'
import { DetailList } from '@/components/ui/detail-list'
import { HOCKEY_POSITION_LABELS, STICK_SIDE_LABELS } from '@/lib/enums/hockey'
import { DEFAULT_TIMEZONE, formatBirthDate } from '@/lib/time/workspace-time'
import { messages } from '@/lib/i18n'

const t = messages.athlete

/**
 * One child, as their parent reads them (guardian/SPEC.md §G8).
 *
 * A screen to look at rather than a form to fill in: editing is behind
 * `Upravit`. A parent opens this to check a jersey number before a training,
 * not to change one.
 */
export default async function AthletePage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>
  searchParams: Promise<{ obdobi?: string }>
}) {
  const { athleteId } = await params
  const { obdobi } = await searchParams

  // Returns null for an athlete this guardian does not guard: the row policy
  // filters it out before it reaches here, so a guessed id is a 404, not a leak.
  const family = await listGuardianAthletes()
  const athlete = family.find((a) => a.id === athleteId)
  if (!athlete) notFound()

  const sports = messages.sports as Record<string, string>
  const hockey = athlete.sportProfiles.find((profile) => profile.sportCode === 'HOCKEY')

  const [records, workspaces, invitations] = await Promise.all([
    getAthleteAttendance(athleteId),
    listJoinableWorkspaces(),
    listGuardianInvitations(athleteId),
  ])
  const timezone = workspaces[0]?.timezone ?? DEFAULT_TIMEZONE
  // G8b opens on the season, as the design draws it; `Měsíc` narrows it.
  const period = parsePeriod(obdobi, 'season', new Date(), timezone)

  return (
    <main className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/moji-sportovci" className="flex min-h-11 items-center text-row text-muted">
          ‹ {t.back}
        </Link>
        <Link
          href={{ pathname: `/moji-sportovci/${athlete.id}/upravit` }}
          className="flex min-h-11 items-center text-row font-semibold text-primary"
        >
          {t.edit}
        </Link>
      </div>

      <header className="flex items-center gap-3">
        <Avatar
          firstName={athlete.firstName}
          lastName={athlete.lastName}
          {...(athlete.photoUrl ? { photoUrl: athlete.photoUrl } : {})}
          size={72}
          muted={!athlete.isActive}
        />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-display text-form-title font-bold text-ink">
            {athlete.firstName} {athlete.lastName}
          </h1>
          {/* Masculine for everyone: the product does not collect gender and
              will not guess it from a name (DS §8, decision 17). */}
          <p className="text-meta text-muted">
            {t.born.replace('{date}', formatBirthDate(athlete.dateOfBirth))}
          </p>
        </div>
      </header>

      {athlete.membership ? (
        <MembershipNotice
          membershipId={athlete.membership.id}
          approval={athlete.membership.approval}
        />
      ) : null}

      <section className="flex flex-col gap-2.5">
        <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
          {t.sportsCaption}
        </h2>

        {hockey ? (
          <div className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
            <h3 className="text-date font-bold text-ink">
              {sports[hockey.sportCode] ?? hockey.sportCode}
            </h3>
            <DetailList
              className="px-0"
              items={[
                { term: t.club, value: hockey.clubName },
                { term: t.team, value: hockey.teamOrCategory },
                {
                  term: t.position,
                  value: hockey.position ? HOCKEY_POSITION_LABELS[hockey.position] : null,
                },
                {
                  term: t.stickSide,
                  value: hockey.stickSide ? STICK_SIDE_LABELS[hockey.stickSide] : null,
                },
                { term: t.jerseyNumber, value: hockey.jerseyNumber },
              ]}
            />
          </div>
        ) : null}
      </section>

      {hockey ? (
        <AttendanceBlock
          records={records}
          period={period}
          timezone={timezone}
          sportName={sports[hockey.sportCode] ?? hockey.sportCode}
        />
      ) : null}

      <GuardiansSection
        athleteId={athlete.id}
        athletes={family.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}` }))}
        invitations={invitations}
        timezone={timezone}
      />
    </main>
  )
}
