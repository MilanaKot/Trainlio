/**
 * The tab bar's icons (DESIGN_SYSTEM §6.17: 22px, stroke 1.8).
 *
 * Drawn here rather than pulled from an icon set: five shapes at one size,
 * and a dependency whose whole point is the thousand icons we do not use
 * would ship more than it saves.
 */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[22px]"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Trainings: a calendar. */
export function CalendarIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  )
}

/** My trainings: a calendar with a tick. */
export function CheckCalendarIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
    </Icon>
  )
}

/** Athletes: two people. */
export function PeopleIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M16 6.2a3 3 0 010 5.6M17.5 14.6c2 .6 3.5 2.1 3.5 4.4" />
    </Icon>
  )
}

/** Account: one person. */
export function PersonIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3-5.4 7-5.4s7 2.1 7 5.4" />
    </Icon>
  )
}

/** More: three dots. */
export function MoreIcon() {
  return (
    <Icon>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </Icon>
  )
}
