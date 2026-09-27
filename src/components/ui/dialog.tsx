'use client'

import { AlertDialog } from 'radix-ui'
import { cn } from '@/lib/utils'

/**
 * The centred question that stops everything (DESIGN_SYSTEM §6.14).
 *
 * An alert dialog, not a sheet: these are the moments where the next tap
 * cannot be undone — removing an athlete, reducing capacity under a roster,
 * cancelling a training — and the design puts them in the middle of the screen
 * on a darker scrim so they do not read as one more panel.
 *
 * Focus starts on the safe button. Radix does that for whichever child is
 * `AlertDialog.Cancel`, which is why the cancel action is a required prop
 * rather than something a caller can forget.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  tone = 'neutral',
  cancelLabel,
  confirmLabel,
  onConfirm,
  confirmVariant = 'primary',
  /** Destructive pairs stack, so the safe choice is the one under the thumb. */
  stacked = false,
  children,
  pending = false,
  pendingLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  icon?: React.ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
  cancelLabel: string
  confirmLabel: string
  onConfirm: () => void
  confirmVariant?: 'primary' | 'danger'
  stacked?: boolean
  children?: React.ReactNode
  pending?: boolean
  pendingLabel?: string
}) {
  const tile = {
    neutral: 'bg-neutral-50 text-muted',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  }[tone]

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-scrim-strong" />
        <AlertDialog.Content className="fixed inset-x-5 top-1/2 z-50 -translate-y-1/2 rounded-sheet bg-surface p-6 pb-5 shadow-dialog">
          {icon ? (
            <span
              className={cn('mb-4 flex size-13 items-center justify-center rounded-2xl', tile)}
              aria-hidden="true"
            >
              {icon}
            </span>
          ) : null}

          <AlertDialog.Title className="font-display text-sheet-title font-bold text-ink">
            {title}
          </AlertDialog.Title>

          {description ? (
            <AlertDialog.Description className="mt-2 text-body text-muted">
              {description}
            </AlertDialog.Description>
          ) : null}

          {children ? <div className="mt-4 flex flex-col gap-3">{children}</div> : null}

          <div className={cn('mt-6 flex gap-3', stacked ? 'flex-col-reverse' : 'flex-row')}>
            <AlertDialog.Cancel
              className={cn(
                'flex min-h-touch items-center justify-center rounded-control bg-surface px-4 text-row font-semibold text-ink',
                'shadow-[inset_0_0_0_1.5px_var(--color-line)]',
                stacked ? 'w-full' : 'flex-1',
              )}
            >
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={(event) => {
                // The caller decides when the dialog closes: a server call can
                // still refuse, and a dialog that vanished first has nowhere
                // to put the refusal.
                event.preventDefault()
                onConfirm()
              }}
              disabled={pending}
              aria-busy={pending || undefined}
              className={cn(
                'flex min-h-touch items-center justify-center rounded-control px-4 text-row font-semibold text-white',
                confirmVariant === 'danger' ? 'bg-danger' : 'bg-primary',
                'disabled:bg-neutral-50 disabled:text-subtle',
                stacked ? 'w-full' : 'flex-1',
              )}
            >
              {pending && pendingLabel !== undefined ? pendingLabel : confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
