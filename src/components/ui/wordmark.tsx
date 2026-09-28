import { cn } from '@/lib/utils'

/**
 * The product's own mark (guardian/SPEC.md §G11 footer).
 *
 * Barlow Semi Condensed with a cobalt bar sitting on the baseline after the
 * word. Small and at the bottom: the name at the top of the sign-in screen is
 * the club's, and this only says whose software it is.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-end gap-0.5 font-display font-bold', className)}>
      trainlio
      <span aria-hidden="true" className="mb-[3px] h-2 w-1 rounded-[1px] bg-primary" />
    </span>
  )
}
