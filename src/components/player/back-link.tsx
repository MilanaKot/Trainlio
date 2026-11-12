'use client'

import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'

/**
 * `‹ Zpět` (K13): the card opens from K2 and from K12, so back is wherever
 * the coach came from. Opened directly, with nothing to go back to, it goes to
 * the athlete list.
 */
export function BackLink() {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/trener/sportovci'))}
      className="flex min-h-11 items-center gap-1 self-start text-row font-semibold text-muted"
    >
      <span aria-hidden="true">‹</span> {messages.coach.card.back}
    </button>
  )
}
