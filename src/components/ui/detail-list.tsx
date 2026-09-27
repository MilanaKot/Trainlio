import { cn } from '@/lib/utils'

/**
 * Labelled facts about one thing (DESIGN_SYSTEM §6.20).
 *
 * A real `<dl>`, because that is what this is. An empty optional value keeps
 * its row and shows an em dash: a missing changing room is information, and a
 * row that disappears makes the reader wonder whether they missed it.
 */
export function DetailList({
  items,
  className,
}: {
  items: { term: string; value: React.ReactNode | null }[]
  className?: string
}) {
  return (
    <dl className={cn('rounded-card bg-surface px-4 py-1', className)}>
      {items.map((item, index) => (
        <div
          key={item.term}
          className={cn(
            'grid grid-cols-[112px_1fr] gap-3 py-3',
            index > 0 && 'border-t border-line',
          )}
        >
          <dt className="text-meta text-muted">{item.term}</dt>
          <dd
            className={cn('text-row', item.value === null ? 'font-normal text-muted' : 'text-ink')}
          >
            {item.value ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  )
}
