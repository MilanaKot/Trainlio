import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { CoachAccess } from '@/server/staff/queries'

const t = messages.staff

const TONE: Record<CoachAccess, string> = {
  signed_in: 'bg-success-soft text-success',
  invited: 'bg-warning-soft text-warning',
  no_email: 'bg-bg text-muted',
}

function Icon({ access }: { access: CoachAccess }) {
  if (access === 'signed_in') {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="size-5 shrink-0" aria-hidden="true">
        <path
          d="M4.5 10.5l3.5 3.5 7.5-8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (access === 'invited') {
    return (
      <svg viewBox="0 0 20 20" fill="none" className="size-5 shrink-0" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 6v4.3l2.8 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5 shrink-0" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 9V6.5a3 3 0 016 0V9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Whether a coach can get into the application (DESIGN_SYSTEM §6.30, §A3–§A3c).
 *
 * Three states and no fourth: an invitation never expires, because signing in
 * is always a code to an address. An invitation that is never accepted simply
 * stays `Pozván`, which is a fact about the coach and not a deadline.
 */
export function AccessStatus({
  access,
  detail,
  className,
}: {
  access: CoachAccess
  /** The line under the title: when they were last in, or when it was sent. */
  detail?: string | undefined
  className?: string
}) {
  const title =
    access === 'signed_in'
      ? t.accessSignedIn
      : access === 'invited'
        ? t.accessWaiting
        : t.accessNoEmail

  return (
    <div className={cn('flex items-start gap-3 rounded-control-lg p-3', TONE[access], className)}>
      <Icon access={access} />
      <span className="flex min-w-0 flex-col">
        <span className="text-row font-bold">{title}</span>
        {detail ? <span className="text-hint opacity-90">{detail}</span> : null}
      </span>
    </div>
  )
}
