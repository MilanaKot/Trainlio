import { cn } from '@/lib/utils'

/**
 * `Přihlášen: Jan Novák` on a training card (DESIGN_SYSTEM §6.3).
 *
 * The masculine participle is used for every person, whatever their name.
 * The product does not collect gender and will not guess it from a name, and a
 * guess that is wrong is worse than a form that is uniform (§8, decision 17).
 */
export function BookedChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-chip bg-primary-100 px-2.5',
        'text-hint font-semibold text-primary',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Přihlášen: {name}
    </span>
  )
}
