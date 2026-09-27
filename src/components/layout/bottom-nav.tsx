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
 */
export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label={messages.nav.myAthletes}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-black/10 bg-[var(--background)] pb-[env(safe-area-inset-bottom)] dark:border-white/15"
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
                  active ? 'font-semibold' : 'opacity-60'
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
