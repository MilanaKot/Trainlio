'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { DollarIcon } from '@/components/ui/status-toggle'

/**
 * The confirmation that something happened (DESIGN_SYSTEM §6.16).
 *
 * No action button, by decision: there is no "Vrátit". Undoing a booking is
 * cancelling one, which has its own rules and its own deadline, and a toast
 * that offered it would be promising something the domain does not allow.
 * The one exception (v3.4) is un-marking a payment: `useUndoToast`, below.
 *
 * `role="status"` with a polite live region: it is worth hearing, never worth
 * interrupting.
 */
type Undo = { message: string; actionLabel: string; onAction: () => void }
type Toast = { id: number; message: string; undo?: Undo }

const ToastContext = createContext<((message: string) => void) | null>(null)
const UndoContext = createContext<((undo: Undo) => void) | null>(null)

/** How long a confirmation stays before it stops being news. */
const DISMISS_AFTER_MS = 3000
/** §6.16 exception: long enough to reach `Vrátit`. */
const UNDO_AFTER_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string) => {
    setToasts((current) => [...current, { id: Date.now() + current.length, message }])
  }, [])

  // One undo at a time: a second un-marking replaces the first offer, whose
  // payment stays un-marked — that was the tap, and the toast only offered.
  const showUndo = useCallback((undo: Undo) => {
    setToasts((current) => [
      ...current.filter((toast) => !toast.undo),
      { id: Date.now() + current.length, message: undo.message, undo },
    ])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      <UndoContext.Provider value={showUndo}>
        {children}
        <div className="pointer-events-none fixed inset-x-4 bottom-28 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <ToastCard
              key={toast.id}
              message={toast.message}
              {...(toast.undo ? { undo: toast.undo } : {})}
              onDone={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
            />
          ))}
        </div>
      </UndoContext.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext)
  if (show === null) throw new Error('useToast must be used inside a ToastProvider')
  return show
}

/**
 * DS §6.16, the v3.4 exception: `Platba zrušena · {athlete}` with `Vrátit`
 * and a 3 px bar that runs out with the four seconds.
 */
export function useUndoToast(): (undo: Undo) => void {
  const show = useContext(UndoContext)
  if (show === null) throw new Error('useUndoToast must be used inside a ToastProvider')
  return show
}

function ToastCard({
  message,
  undo,
  onDone,
}: {
  message: string
  undo?: Undo
  onDone: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, undo ? UNDO_AFTER_MS : DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [onDone, undo])

  if (undo) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-card bg-surface p-4 pr-3 shadow-toast"
      >
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"
          aria-hidden="true"
        >
          <DollarIcon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-row text-ink">{message}</p>
        <button
          type="button"
          onClick={() => {
            undo.onAction()
            onDone()
          }}
          className="flex h-9 shrink-0 items-center rounded-button bg-primary-100 px-3 text-meta font-bold text-primary"
        >
          {undo.actionLabel}
        </button>
        <span
          className="absolute bottom-0 left-0 h-[3px] w-full origin-left bg-primary motion-safe:animate-[toast-drain_4s_linear_forwards]"
          aria-hidden="true"
        />
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-toast"
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"
        aria-hidden="true"
      >
        <svg viewBox="0 0 16 16" fill="none" className="size-4">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <p className="text-row text-ink">{message}</p>
    </div>
  )
}
