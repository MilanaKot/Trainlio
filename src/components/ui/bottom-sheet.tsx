'use client'

import { Dialog } from 'radix-ui'
import { cn } from '@/lib/utils'

/**
 * The sheet that comes up from the bottom (DESIGN_SYSTEM §6.13).
 *
 * Radix's dialog underneath, and that is the whole reason to use a library
 * here: the focus trap, Esc, `aria-modal`, returning focus to whatever opened
 * it, and marking the rest of the page inert are §10's requirements and are
 * tedious to get right by hand. Everything visible is this project's.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  /** Tall sheets stop short of the top rather than covering the screen. */
  tall = false,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  tall?: boolean
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-sheet bg-surface shadow-sheet',
            'px-5 pt-2.5 pb-7 [padding-bottom:calc(1.75rem+env(safe-area-inset-bottom))]',
            tall ? 'top-12' : 'max-h-[85dvh]',
          )}
        >
          {/* The grabber is the affordance for the swipe; it says nothing, so
              it says nothing to a screen reader either. */}
          <span
            className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-line"
            aria-hidden="true"
          />

          <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
            <Dialog.Title className="font-display text-sheet-title font-bold text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Zavřít"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-50 text-muted"
            >
              <svg viewBox="0 0 20 20" fill="none" className="size-4" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">{children}</div>

          {footer ? <div className="shrink-0 pt-4">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
