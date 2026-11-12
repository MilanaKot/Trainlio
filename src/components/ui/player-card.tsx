'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { cn } from '@/lib/utils'

/**
 * A booking on K2, a training on K13 (DESIGN_SYSTEM §6.37, K02s).
 *
 * Two zones that never mix. The left one is a link — the thicker right edge,
 * not a chevron, says the card opens. The right one holds the StatusToggles,
 * which are siblings of the link rather than children, so a tap on a toggle
 * cannot reach it. Each toggle's hit area is the full card height by 62 px,
 * and the 8 px between the squares is split between them: there is no gap a
 * thumb can fall through to the card.
 *
 * The card darkens and shrinks for 100 ms and then navigates, so the press is
 * seen before the screen changes. A pointer that moves more than 8 px is a
 * scroll and opens nothing; a long-press does nothing.
 */
export function PlayerCard({
  href,
  children,
  toggles,
  compact = false,
  className,
}: {
  href: Route
  /** The left zone's content: avatar and name on K2, the date on K13. */
  children: React.ReactNode
  /** The two toggles, attendance then payment, rendered with TOGGLE_CELLS. */
  toggles: React.ReactNode
  /** K13: 68 px instead of 76. */
  compact?: boolean
  className?: string
}) {
  const router = useRouter()
  const [pressed, setPressed] = useState(false)
  const press = useRef<{ x: number; y: number; at: number } | null>(null)

  return (
    <div
      className={cn(
        'flex items-stretch rounded-card bg-surface pr-4 pl-3 transition-[transform,background-color] duration-100',
        'shadow-[inset_-5px_0_0_#c9d0dc,0_1px_2px_rgb(14_23_38/0.06)]',
        compact ? 'min-h-[68px]' : 'min-h-[76px]',
        pressed && 'scale-[.98] bg-[#eef1f6]',
        className,
      )}
    >
      <Link
        href={href}
        onPointerDown={(event) => {
          press.current = { x: event.clientX, y: event.clientY, at: Date.now() }
        }}
        onContextMenu={(event) => event.preventDefault()}
        onClick={(event) => {
          // Modified clicks keep the browser's own meaning (a new tab).
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          const start = press.current
          press.current = null
          if (start && event.detail > 0) {
            const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
            if (moved > 8 || Date.now() - start.at > 500) return
          }
          setPressed(true)
          setTimeout(() => {
            setPressed(false)
            router.push(href)
          }, 100)
        }}
        className="flex min-w-0 flex-1 touch-manipulation items-center gap-3 py-2.5 select-none [-webkit-touch-callout:none]"
      >
        {children}
      </Link>
      <div className="-mr-2.5 flex shrink-0 self-stretch">{toggles}</div>
    </div>
  )
}

/**
 * The hit areas of the two toggles, attendance then payment: 62 px each, the
 * outer 10 px reaching into the card's padding and the inner 4 px splitting
 * the gap between the squares.
 */
export const TOGGLE_CELLS = [
  'w-[62px] self-stretch pr-1 pl-2.5',
  'w-[62px] self-stretch pr-2.5 pl-1',
] as const
