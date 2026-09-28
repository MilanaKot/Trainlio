import Link from 'next/link'
import { messages } from '@/lib/i18n'
import { HOCKEY_POSITION_LABELS } from '@/lib/enums/hockey'
import { formatBirthDate } from '@/lib/time/workspace-time'
import { Avatar } from '@/components/ui/avatar'
import type { GuardianAthlete } from '@/server/athletes/queries'

const t = messages.athlete

/**
 * One child on the parent's list (guardian/SPEC.md §G7).
 *
 * The chip carries the sport and, when it is set, the position: a parent with
 * one child in hockey and one in football should be able to tell them apart
 * without opening either.
 */
export function AthleteCard({ athlete }: { athlete: GuardianAthlete }) {
  const sports = messages.sports as Record<string, string>

  return (
    <li>
      <Link
        href={{ pathname: `/moji-sportovci/${athlete.id}` }}
        className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-card"
      >
        <Avatar
          firstName={athlete.firstName}
          lastName={athlete.lastName}
          {...(athlete.photoUrl ? { photoUrl: athlete.photoUrl } : {})}
          size={56}
          muted={!athlete.isActive}
        />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[1.0625rem] font-bold text-ink">
              {athlete.firstName} {athlete.lastName}
            </span>
            {athlete.isActive ? null : (
              <span className="shrink-0 rounded-badge bg-neutral-50 px-1.5 text-badge font-bold uppercase text-muted">
                {t.inactive}
              </span>
            )}
          </span>

          <span className="text-meta text-muted">{formatBirthDate(athlete.dateOfBirth)}</span>

          {athlete.sportProfiles.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {athlete.sportProfiles.map((profile) => (
                <span
                  key={profile.id}
                  className="rounded-chip bg-neutral-50 px-2 py-0.5 text-hint font-semibold text-muted"
                >
                  {[
                    sports[profile.sportCode] ?? profile.sportCode,
                    profile.position ? HOCKEY_POSITION_LABELS[profile.position] : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              ))}
            </span>
          ) : null}
        </span>

        <span aria-hidden="true" className="text-subtle">
          ›
        </span>
      </Link>
    </li>
  )
}
