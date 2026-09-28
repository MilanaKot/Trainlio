'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { formatDateTime } from '@/lib/time/workspace-time'
import { formatPhone } from '@/lib/domain/phone'
import { HOCKEY_POSITION_LABELS, STICK_SIDE_LABELS } from '@/lib/enums/hockey'
import type { HockeyPosition, StickSide } from '@/lib/enums/hockey'
import { removeAthleteFromSession } from '@/server/roster/actions'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DetailList } from '@/components/ui/detail-list'
import { Field, TextareaWithCounter } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import type { BookingGuardian, RosterEntry } from '@/server/roster/queries'

const t = messages.coach

/** The design caps the coach's message at 200; the domain function does too. */
const MESSAGE_LIMIT = 200

export function athleteLine(entry: {
  birthYear: number | null
  positionCode: string | null
  stickSideCode: string | null
}): string {
  return [
    entry.birthYear,
    entry.positionCode ? HOCKEY_POSITION_LABELS[entry.positionCode as HockeyPosition] : null,
    entry.stickSideCode ? STICK_SIDE_LABELS[entry.stickSideCode as StickSide] : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * One athlete of the roster, and what a coach does about them
 * (coach/SPEC.md §K2).
 *
 * The telephone number is why this sheet exists: a coach standing at the rink
 * with a child nobody collected needs to call someone. Every active guardian
 * is listed, not whoever made the booking — two parents share a child, and the
 * one who tapped the button is not necessarily the one who can come.
 *
 * Removing is a real consequence — a place freed and an e-mail sent — so the
 * dialog says both before it happens, and offers the coach's own words to go
 * with it (§G6d).
 */
export function AthleteSheet({
  entry,
  guardians,
  sessionId,
  sessionLabel,
  timezone,
  onClose,
}: {
  entry: RosterEntry | null
  /** null while the row that opened this sheet is still fetching them. */
  guardians: BookingGuardian[] | null
  sessionId: string
  /** `Ne 4. 10. · 09:00`, so the confirmation names the training it is about. */
  sessionLabel: string
  timezone: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!entry) return null

  const name = `${entry.firstName} ${entry.lastName}`
  const phone = guardians?.find((g) => g.phone)?.phone ?? null

  function onRemove() {
    setError(null)
    startTransition(async () => {
      const result = await removeAthleteFromSession(sessionId, entry!.bookingId, message.trim())
      if (!result.ok) {
        const table = messages.coach.errors as Record<string, string>
        setError(table[result.code] ?? messages.coach.errors.generic)
        return
      }
      setConfirming(false)
      setMessage('')
      onClose()
      toast(t.removed)
      router.refresh()
    })
  }

  return (
    <>
      <BottomSheet open onOpenChange={(open) => (open ? undefined : onClose())} title={name}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar firstName={entry.firstName} lastName={entry.lastName} size={56} />
            <div className="flex flex-col">
              <span className="text-row font-bold text-ink">{name}</span>
              <span className="text-meta text-muted">{athleteLine(entry)}</span>
              {entry.clubName ? (
                <span className="text-meta text-muted">{entry.clubName}</span>
              ) : null}
            </div>
          </div>

          <DetailList
            items={[
              {
                term: t.parent,
                value:
                  guardians === null ? (
                    <span className="text-subtle">{t.loadingValue}</span>
                  ) : guardians.length > 0 ? (
                    guardians.map((g) => g.displayName ?? t.none).join(', ')
                  ) : (
                    <span className="text-subtle">{t.none}</span>
                  ),
              },
              {
                term: t.phone,
                // AC-254: coaches of this workspace, and nobody else, read it.
                value:
                  guardians === null ? (
                    <span className="text-subtle">{t.loadingValue}</span>
                  ) : phone ? (
                    formatPhone(phone)
                  ) : (
                    <span className="text-subtle">{t.none}</span>
                  ),
              },
              {
                term: t.bookedAtLabel,
                value: formatDateTime(new Date(entry.bookedAt), timezone),
              },
            ]}
          />

          {phone ? (
            <div className="flex flex-col gap-2">
              <a href={`tel:${phone}`} className={buttonVariants({ size: 'lg' })}>
                {t.call.replace('{phone}', formatPhone(phone))}
              </a>
              <a
                href={`sms:${phone}`}
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                {t.sendSms}
              </a>
            </div>
          ) : null}

          {entry.status === 'CONFIRMED' ? (
            <Button
              variant="danger-outline"
              size="lg"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              {t.removeFromSession}
            </Button>
          ) : null}

          {error ? (
            <p role="alert" className="text-hint text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t.removeTitle}
        description={`${name} · ${sessionLabel}`}
        tone="warning"
        cancelLabel={t.keep}
        confirmLabel={t.removeConfirm}
        onConfirm={onRemove}
        pending={pending}
        stacked
      >
        <div className="flex flex-col gap-3">
          <Field label={t.removeMessage} optional>
            {(field) => (
              <TextareaWithCounter
                {...field}
                rows={3}
                maxLength={MESSAGE_LIMIT}
                value={message}
                onChange={setMessage}
              />
            )}
          </Field>
          <p className="flex items-start gap-1.5 text-meta text-muted">
            <MailIcon />
            {t.removeInfo}
          </p>
        </div>
      </ConfirmDialog>
    </>
  )
}
