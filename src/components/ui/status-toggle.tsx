'use client'

import { useRef } from 'react'
import { messages } from '@/lib/i18n'
import type { AttendanceView } from '@/lib/domain/attendance'
import { cn } from '@/lib/utils'

const t = messages.coach.toggle

/** §6.36: 48 in K2, 44 in K13, 32 static in lists, 20 in legends. */
export type ToggleSize = 'lg' | 'md' | 'sm' | 'xs'

const BOX: Record<ToggleSize, string> = {
  lg: 'size-12 rounded-[14px]',
  md: 'size-11 rounded-[12px]',
  sm: 'size-8 rounded-[9px]',
  xs: 'size-5 rounded-[6px]',
}
const ICON: Record<ToggleSize, string> = {
  lg: 'size-[22px]',
  md: 'size-5',
  sm: 'size-[18px]',
  xs: 'size-3.5',
}

type Look = 'success' | 'danger' | 'empty'

const FILL: Record<Look, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  empty: 'bg-surface text-subtle shadow-[inset_0_0_0_1.5px_var(--color-line)]',
}
// The pressed ring, in the colour of the state the tap is leaving.
const RING: Record<Look, string> = {
  success: 'group-active:shadow-[0_0_0_3px_#a7d9c4]',
  danger: 'group-active:shadow-[0_0_0_3px_var(--color-danger-border)]',
  empty: 'group-active:shadow-[inset_0_0_0_1.5px_var(--color-line),0_0_0_3px_var(--color-line)]',
}

type Props = {
  athlete: string
  size?: ToggleSize
  /** Rendered as a picture rather than a control (§6.36 read-only, K2b). */
  readOnly?: boolean
  /** The hit area around the square; PlayerCard sizes it (§6.37). */
  className?: string
  onToggle?: () => void
} & ({ kind: 'attendance'; state: AttendanceView } | { kind: 'payment'; state: 'paid' | 'unpaid' })

/**
 * Attendance and payment, one square each (DESIGN_SYSTEM §6.36).
 *
 * The button is the whole hit area a caller gives it — on a K2 card that is
 * the full card height by 62 px — and the square inside is only what it
 * looks like. A pointer that travels more than 8 px is a scroll and a press
 * held for half a second is a long-press: neither changes anything (§6.37).
 */
export function StatusToggle(props: Props) {
  const { athlete, size = 'lg', readOnly = false, className, onToggle } = props
  const press = useRef<{ x: number; y: number; at: number } | null>(null)

  const look: Look =
    props.kind === 'payment'
      ? props.state === 'paid'
        ? 'success'
        : 'danger'
      : props.state === 'present'
        ? 'success'
        : props.state === 'absent'
          ? 'danger'
          : 'empty'

  const label =
    props.kind === 'payment'
      ? t.payment.replace('{athlete}', athlete).replace('{state}', t[props.state])
      : t.attendance
          .replace('{athlete}', athlete)
          .replace(
            '{state}',
            props.state === 'present'
              ? t.present
              : props.state === 'absent'
                ? t.absent
                : t.unmarked,
          )

  const square = (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center transition-transform duration-100',
        BOX[size],
        FILL[look],
      )}
    >
      {props.kind === 'payment' ? (
        <DollarIcon className={ICON[size]} />
      ) : (
        <PersonIcon state={props.state} className={ICON[size]} />
      )}
    </span>
  )

  if (readOnly || !onToggle) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('flex items-center justify-center opacity-75', className)}
      >
        {square}
      </span>
    )
  }

  const disabled = props.kind === 'attendance' && props.state === 'locked'

  return (
    <button
      type="button"
      aria-label={label}
      {...(props.kind === 'payment' ? { 'aria-pressed': props.state === 'paid' } : {})}
      disabled={disabled}
      onPointerDown={(event) => {
        press.current = { x: event.clientX, y: event.clientY, at: Date.now() }
      }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation()
        const start = press.current
        press.current = null
        // A keyboard press has no pointer: it always counts.
        if (start && event.detail > 0) {
          const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
          if (moved > 8 || Date.now() - start.at > 500) return
        }
        navigator.vibrate?.(10)
        onToggle()
      }}
      className={cn(
        'group flex touch-manipulation items-center justify-center select-none [-webkit-touch-callout:none]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      <span
        className={cn(
          'flex rounded-[inherit] transition-[transform,box-shadow] duration-100 group-active:scale-90 group-disabled:scale-100',
          BOX[size],
          RING[look],
        )}
      >
        {square}
      </span>
    </button>
  )
}

function PersonIcon({ state, className }: { state: AttendanceView; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M3.5 20c.7-3.6 3.3-5.5 6.5-5.5 1.3 0 2.5.3 3.5.9" />
      {state === 'present' ? <path d="m15.5 18 2 2 4-4.5" /> : null}
      {state === 'absent' ? <path d="m16.5 15.5 4.5 4.5m0-4.5-4.5 4.5" /> : null}
    </svg>
  )
}

export function DollarIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M15 8.6c-.6-.9-1.7-1.4-3-1.4-1.7 0-3 .9-3 2.2 0 3.2 6 1.8 6 5 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3.1-1.6M12 5.2v13.6" />
    </svg>
  )
}

export function PersonCheckIcon({ className }: { className: string }) {
  return <PersonIcon state="present" className={className} />
}
