import Link from 'next/link'
import Image from 'next/image'
import { messages } from '@/lib/i18n'
import { HOCKEY_POSITION_LABELS, STICK_SIDE_LABELS } from '@/lib/enums/hockey'
import { birthYear } from '@/lib/time/workspace-time'
import type { GuardianAthlete } from '@/server/athletes/queries'

export function AthleteCard({ athlete }: { athlete: GuardianAthlete }) {
  const hockey = athlete.sportProfiles.find((p) => p.sportCode === 'HOCKEY')
  const summary = [
    hockey?.position ? HOCKEY_POSITION_LABELS[hockey.position] : null,
    hockey?.stickSide
      ? `${messages.athlete.stickSide}: ${STICK_SIDE_LABELS[hockey.stickSide]}`
      : null,
    hockey?.jerseyNumber ? `#${hockey.jerseyNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <Link
        href={`/moji-sportovci/${athlete.id}`}
        className="flex items-center gap-4 rounded-xl border border-black/10 p-3 dark:border-white/15"
      >
        {athlete.photoUrl ? (
          <Image
            src={athlete.photoUrl}
            alt=""
            width={56}
            height={56}
            // Signed URLs are short-lived and host-specific, so Next's optimizer
            // is bypassed: it would cache a URL that expires in an hour.
            unoptimized
            className="size-14 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-black/5 text-lg dark:bg-white/10"
          >
            {athlete.firstName.slice(0, 1)}
          </span>
        )}

        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">
              {athlete.firstName} {athlete.lastName}
            </span>
            {!athlete.isActive ? (
              <span className="shrink-0 rounded bg-black/10 px-1.5 py-0.5 text-[11px] uppercase dark:bg-white/15">
                {messages.athlete.inactive}
              </span>
            ) : null}
          </span>
          <span className="text-sm opacity-70">
            {messages.athlete.birthYear.replace('{year}', String(birthYear(athlete.dateOfBirth)))}
          </span>
          {summary ? <span className="truncate text-sm opacity-70">{summary}</span> : null}
        </span>
      </Link>
    </li>
  )
}
