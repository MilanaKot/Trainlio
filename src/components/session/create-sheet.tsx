'use client'

import Link from 'next/link'
import { useState } from 'react'
import { messages } from '@/lib/i18n'
import { BottomSheet } from '@/components/ui/bottom-sheet'

const t = messages.coach

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="13" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 8.5h14M7 3v3M13 3v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
      <path
        d="M4 8a5 5 0 018.7-3.3M16 12a5 5 0 01-8.7 3.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M13 2.5V5.5h-3M7 17.5V14.5h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The FAB and the sheet behind it (coach/SPEC.md §K1, §K10,
 * DESIGN_SYSTEM §6.18).
 *
 * Two ways to create, asked before the form rather than as a mode switch
 * inside it: a coach creating a season of Sunday trainings and a coach adding
 * one extra session are doing different things, and the series form asks four
 * questions the single one does not.
 */
export function CreateSheet() {
  const [open, setOpen] = useState(false)

  const options = [
    {
      href: '/trener/novy' as const,
      icon: <CalendarIcon />,
      title: t.createSingle,
      hint: t.createSingleHint,
    },
    {
      href: '/trener/serie/nova' as const,
      icon: <RepeatIcon />,
      title: t.createSeriesOption,
      hint: t.createSeriesHint,
    },
  ]

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-4 z-20 flex h-14 [bottom:calc(var(--spacing-nav)+1rem+env(safe-area-inset-bottom))] items-center gap-2 rounded-full bg-primary px-5 text-body font-bold text-white shadow-[0_8px_24px_rgb(43_85_224/.35)] active:bg-primary-600"
      >
        <span aria-hidden="true">+</span> {t.create}
      </button>

      <BottomSheet open={open} onOpenChange={setOpen} title={t.create}>
        <ul className="flex flex-col gap-2">
          {options.map((option) => (
            <li key={option.href}>
              <Link
                href={option.href}
                onClick={() => setOpen(false)}
                className="flex min-h-[72px] items-center gap-3 rounded-control-lg px-2 py-3"
              >
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-100 text-primary"
                  aria-hidden="true"
                >
                  {option.icon}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-date font-bold text-ink">{option.title}</span>
                  <span className="text-meta text-muted">{option.hint}</span>
                </span>
                <span className="ml-auto text-subtle" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  )
}
