'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { requestJoinAgain } from '@/server/club/actions'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { useToast } from '@/components/ui/toast'
import type { MembershipApproval } from '@/types/database'

const t = messages.club

/**
 * G8 (migration 50): what the club said about this child. Waiting, or turned
 * away with `Požádat znovu` — after correcting the birth year, say, behind
 * `Upravit`. Nothing at all once approved.
 */
export function MembershipNotice({
  membershipId,
  approval,
}: {
  membershipId: string
  approval: MembershipApproval
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  if (approval === 'APPROVED') return null

  if (approval === 'PENDING') {
    return (
      <Notice variant="warning" title={t.waitingTitle} role="status">
        {t.waitingBody}
      </Notice>
    )
  }

  function again() {
    startTransition(async () => {
      const result = await requestJoinAgain(membershipId)
      const table = t.errors as Record<string, string>
      toast(result.ok ? t.requestedAgain : (table[result.code] ?? t.errors.generic))
      router.refresh()
    })
  }

  return (
    <Notice variant="danger" title={t.rejected} role="status">
      <div className="flex flex-col gap-3">
        <p>{t.rejectedBody}</p>
        <Button
          variant="outline"
          className="self-start"
          onClick={again}
          {...(pending ? { loadingLabel: messages.coach.saving } : {})}
        >
          {t.requestAgain}
        </Button>
      </div>
    </Notice>
  )
}
