'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { markAllPaid } from '@/server/roster/actions'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import type { RosterEntry } from '@/server/roster/queries'

const t = messages.coach

/**
 * K2c · `Zaplatili všichni` (coach/SPEC.md, handoff v3.3).
 *
 * Lists exactly who is about to be marked, because the button on K2 says
 * "everyone" and the coach should see that it means these three. One request
 * marks only those still unpaid; whoever paid earlier keeps their own who and
 * when (mark_session_paid).
 */
export function MarkAllPaidSheet({
  sessionId,
  unpaid,
  anyPaid,
  onClose,
}: {
  sessionId: string
  unpaid: RosterEntry[]
  /** Whether `Ostatní už zaplaceno mají` is true, so it is only said if so. */
  anyPaid: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const count = String(unpaid.length)

  function confirm() {
    startTransition(async () => {
      const result = await markAllPaid(sessionId)
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        toast(table[result.code] ?? t.errors.generic)
        return
      }
      onClose()
      toast(t.markedAllToast)
      router.refresh()
    })
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={plural(unpaid.length, t.markAllTitle)}
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={confirm} {...(pending ? { loadingLabel: t.saving } : {})}>
            {t.markAllConfirm.replace('{count}', count)}
          </Button>
          <Button size="lg" variant="outline" onClick={onClose} disabled={pending}>
            {messages.common.cancel}
          </Button>
        </div>
      }
    >
      <p className="text-meta text-muted">{anyPaid ? t.markAllBody : t.markAllBodyNonePaid}</p>
      <ul className="flex flex-col gap-1 rounded-card bg-bg p-3">
        {unpaid.map((entry) => (
          <li key={entry.bookingId} className="flex items-center gap-3 py-1.5">
            <Avatar firstName={entry.firstName} lastName={entry.lastName} size={32} />
            <span className="text-row font-bold text-ink">
              {entry.firstName} {entry.lastName}
            </span>
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}
