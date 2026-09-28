'use client'

import Link from 'next/link'
import type { Route } from 'next'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * The tab bar (DESIGN_SYSTEM §6.17).
 *
 * Four items for a guardian, three for a coach; the caller supplies them, so
 * the component knows nothing about routes and neither role's navigation is
 * hidden inside the other's.
 *
 * The safe-area inset is not cosmetic: without it the last row of a list sits
 * under the home indicator on every recent iPhone, and the parent scrolling to
 * the bottom of "Moje tréninky" never sees it.
 */
export type NavItem = {
  // Typed routes are on, so a tab cannot point at a page that does not exist.
  href: Route
  label: string
  icon: React.ReactNode
}

export function BottomNav({
  items,
  /**
   * Screens that replace the tab bar rather than sit above it: a form is a
   * task, not a tab, and it ends with `Zrušit` at the top and one button at
   * the bottom. Two fixed bars stacked on a phone would also leave the
   * button under the navigation.
   */
  hideWhen,
}: {
  items: NavItem[]
  /** A regular expression source. A RegExp itself cannot cross the server
   *  boundary, and this component is rendered from a server layout. */
  hideWhen?: string
}) {
  const pathname = usePathname()

  if (hideWhen && new RegExp(hideWhen).test(pathname)) return null

  const best = items
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-nav items-start justify-around bg-surface pt-2 shadow-nav [padding-bottom:env(safe-area-inset-bottom)]"
      aria-label="Hlavní navigace"
    >
      {items.map((item) => {
        // A pushed screen keeps its tab lit: /moji-sportovci/novy is still
        // "Moji sportovci" as far as a person is concerned.
        //
        // The longest match wins, and that is not a detail: the coach's tabs
        // all live under /trener, so a plain prefix test lit `Tréninky` on
        // every screen in the group — including the one whose own tab was
        // already lit beside it.
        const active = item.href === best

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-touch min-w-16 flex-col items-center justify-start gap-1 px-2',
              active ? 'text-primary' : 'text-muted',
            )}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span className="text-[0.6875rem] font-semibold">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
