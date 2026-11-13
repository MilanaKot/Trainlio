'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { formatPhone } from '@/lib/domain/phone'
import { birthYear, formatDateAtTime } from '@/lib/time/workspace-time'
import { decideJoinRequest } from '@/server/club/actions'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'
import type { JoinRequest } from '@/server/club/queries'

const t = messages.access

/**
 * One card per waiting child: who, how old, and the family behind them, so
 * an administrator who does not recognise the name can ring before deciding.
 * Approving is one tap; rejecting asks first, because the family is e-mailed.
 */
export function JoinRequestList({
  requests,
  timezone,
}: {
  requests: JoinRequest[]
  timezone: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null)
  const [pending, startTransition] = useTransition()

  const waiting = requests.filter((r) => r.approval === 'PENDING')
  const rejected = requests.filter((r) => r.approval === 'REJECTED')

  function decide(request: JoinRequest, approve: boolean) {
    const name = `${request.firstName} ${request.lastName}`
    startTransition(async () => {
      const result = await decideJoinRequest(request.membershipId, approve)
      setRejecting(null)
      toast(
        result.ok
          ? (approve ? t.approvedToast : t.rejectedToast).replace('{name}', name)
          : messages.club.errors.generic,
      )
      router.refresh()
    })
  }

  function card(request: JoinRequest, actions: boolean) {
    const position = request.positionCode
      ? HOCKEY_POSITION_LABELS[request.positionCode as HockeyPosition]
      : null
    return (
      <li
        key={request.membershipId}
        className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card"
      >
        <div className="flex items-center gap-3">
          <Avatar firstName={request.firstName} lastName={request.lastName} size={44} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-row font-bold text-ink">
              {request.firstName} {request.lastName}
            </span>
            <span className="text-meta text-muted">
              {[t.born.replace('{year}', String(birthYear(request.dateOfBirth))), position]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-1 text-meta text-ink">
          {request.guardians.map((guardian, index) => (
            <li key={index} className="flex flex-col">
              <span className="font-semibold">
                {guardian.name ?? messages.coach.bookedByParent}
              </span>
              {/* An address is one long word: it wraps anywhere rather than
                  pushing the card wider than the screen. */}
              <span className="break-all text-muted">
                {[guardian.phone ? formatPhone(guardian.phone) : null, guardian.email]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {request.requestedAt ? (
          <p className="text-hint text-muted">
            {t.requested.replace(
              '{when}',
              formatDateAtTime(new Date(request.requestedAt), timezone),
            )}
          </p>
        ) : null}
        {actions ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant="danger-outline"
              disabled={pending}
              onClick={() => setRejecting(request)}
            >
              {t.reject}
            </Button>
            <Button size="lg" disabled={pending} onClick={() => decide(request, true)}>
              {t.approve}
            </Button>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
          {t.pendingCaption.replace('{count}', String(waiting.length))}
        </h2>
        {waiting.length === 0 ? (
          <EmptyState>{t.none}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">{waiting.map((r) => card(r, true))}</ul>
        )}
      </section>

      {rejected.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-caption font-bold tracking-[0.05em] text-muted">
            {t.rejectedCaption.replace('{count}', String(rejected.length))}
          </h2>
          <ul className="flex flex-col gap-3">{rejected.map((r) => card(r, false))}</ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => (open ? undefined : setRejecting(null))}
        title={t.rejectTitle.replace(
          '{name}',
          rejecting ? `${rejecting.firstName} ${rejecting.lastName}` : '',
        )}
        description={t.rejectBody}
        tone="danger"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.reject}
        confirmVariant="danger"
        onConfirm={() => (rejecting ? decide(rejecting, false) : undefined)}
        pending={pending}
      />
    </div>
  )
}
