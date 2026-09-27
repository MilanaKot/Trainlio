'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/**
 * The confirmation that something happened (DESIGN_SYSTEM §6.16).
 *
 * No action button, by decision: there is no "Vrátit". Undoing a booking is
 * cancelling one, which has its own rules and its own deadline, and a toast
 * that offered it would be promising something the domain does not allow.
 *
 * `role="status"` with a polite live region: it is worth hearing, never worth
 * interrupting.
 */
type Toast = { id: number; message: string }

const ToastContext = createContext<((message: string) => void) | null>(null)

/** How long a confirmation stays before it stops being news. */
const DISMISS_AFTER_MS = 3000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string) => {
    setToasts((current) => [...current, { id: Date.now() + current.length, message }])
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-28 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            message={toast.message}
            onDone={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext)
  if (show === null) throw new Error('useToast must be used inside a ToastProvider')
  return show
}

function ToastCard({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [onDone])

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
