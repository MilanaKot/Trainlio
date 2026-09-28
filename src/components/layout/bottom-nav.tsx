'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { messages } from '@/lib/i18n'

const items = [
  { href: '/treninky', label: messages.nav.sessions },
  { href: '/moje-treninky', label: messages.nav.myBookings },
  { href: '/moji-sportovci', label: messages.nav.myAthletes },
  { href: '/ucet', label: messages.nav.account },
] as const

/**
 * Primary guardian navigation (PRD §17). Fixed to the bottom, within the safe
 * area, with tap targets sized for a thumb rather than a cursor.
 *
 * Colours come from the design tokens. It used to say `bg-[var(--background)]`,
 * a token that no longer exists, so the bar rendered transparent and the last
 * row of every list scrolled underneath it — which is also what made the
 * labels hard to read, since they sat over whatever was passing behind.
 *
 * The labels are `text-muted` and `text-primary` to match the design system
 * rather than to repair a contrast failure: measured on the opaque bar, the
 * dimmed ink they replace came to 4.72:1, which passes. The mobile review
 * measures both, so neither claim rests on arithmetic.
 *
 * The design-system tab bar in `components/ui/bottom-nav.tsx` replaces this
 * one when the guardian screens are built; it takes its items, icons included,
 * from the caller.
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label={messages.nav.label}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 items-center justify-center px-1 text-center text-xs leading-tight ${
                  active ? 'font-semibold text-primary' : 'text-muted'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
