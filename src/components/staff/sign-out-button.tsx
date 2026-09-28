'use client'

import { useState, useTransition } from 'react'
import { signOut } from '@/server/auth/actions'
import { ConfirmDialog } from '@/components/ui/dialog'
import { messages } from '@/lib/i18n'

const t = messages.more

/**
 * Leaving the application (admin/SPEC.md §A0, guardian/SPEC.md §G13).
 *
 * The full sentence, and a confirmation: `Odhlásit` on its own means cancelling
 * a training in this product, and a coach at the rink tapping the wrong one of
 * those has a bad evening.
 */
export function SignOutButton() {
  const [asking, setAsking] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="flex min-h-13 items-center justify-center rounded-card bg-surface text-row font-bold text-danger shadow-card"
      >
        {t.signOut}
      </button>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t.signOutTitle}
        tone="danger"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.signOutConfirm}
        confirmVariant="danger"
        stacked
        pending={pending}
        onConfirm={() => startTransition(async () => void (await signOut()))}
      />
    </>
  )
}
