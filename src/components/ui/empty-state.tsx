import { cn } from '@/lib/utils'

/**
 * Nothing here, and what to do about it (DESIGN_SYSTEM §6.21).
 *
 * Compact on purpose — no illustration. An empty training list is a normal
 * Tuesday, not an event, and a full-screen graphic would make it feel like a
 * fault in the app.
 */
export function EmptyState({
  icon,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-4 rounded-card bg-surface p-6', className)}>
      {icon ? (
        <span
          className="flex size-12 items-center justify-center rounded-2xl bg-neutral-50 text-muted"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p className="text-center text-body font-semibold text-ink">{children}</p>
      {action}
    </div>
  )
}
