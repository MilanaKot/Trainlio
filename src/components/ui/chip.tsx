import { cn } from '@/lib/utils'

/**
 * A chosen assistant, and the button that adds another (DESIGN_SYSTEM §6.12).
 *
 * The remove button names who it removes. "×" repeated five times down a form
 * is five identical announcements to a screen reader.
 */
export function Chip({
  children,
  onRemove,
  removeLabel,
}: {
  children: React.ReactNode
  onRemove?: () => void
  /** The full `Odebrat {name}`, so the action is unambiguous out of context. */
  removeLabel?: string
}) {
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-full bg-neutral-50 pl-3.5 pr-1 text-meta font-semibold text-ink">
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex size-7 items-center justify-center rounded-full text-muted"
        >
          <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </span>
  )
}

export function AddChip({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex h-9 items-center rounded-full bg-primary-100 px-3.5 text-meta font-semibold text-primary',
        className,
      )}
    >
      {children}
    </button>
  )
}
