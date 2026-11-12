'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { formatDateAtTime, formatDateTime } from '@/lib/time/workspace-time'
import { formatPhone } from '@/lib/domain/phone'
import { COACH_NOTE_LIMIT, PARENT_MESSAGE_LIMIT } from '@/lib/domain/booking-notes'
import { HOCKEY_POSITION_LABELS, STICK_SIDE_LABELS } from '@/lib/enums/hockey'
import type { HockeyPosition, StickSide } from '@/lib/enums/hockey'
import {
  removeAthleteFromSession,
  sendParentMessage,
  setBookingPaid,
  setCoachNote,
} from '@/server/roster/actions'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field, TextareaWithCounter } from '@/components/ui/field'
import { PaymentChip } from '@/components/ui/payment-chip'
import { useToast } from '@/components/ui/toast'
import type { BookingGuardian, RosterEntry } from '@/server/roster/queries'

const t = messages.coach

/** The design caps the removal message at 200; the domain function does too. */
const REMOVAL_MESSAGE_LIMIT = 200

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

function errorText(code: string): string {
  const table = t.errors as Record<string, string>
  return table[code] ?? t.errors.generic
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
      <path
        d="M6.6 3.5l1.7 3.4-1.6 1.6a10 10 0 004.8 4.8l1.6-1.6 3.4 1.7-.6 2.6a1.5 1.5 0 01-1.6 1.1A13.6 13.6 0 012.9 5.7a1.5 1.5 0 011.1-1.6l2.6-.6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function BubbleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)} aria-hidden="true">
      <path
        d="M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={cn('shrink-0', className)} aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
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
 * K17 / K17b · one athlete at one training (coach/SPEC.md, handoff v3.3).
 *
 * Three things with three audiences, in the order a coach reaches for them:
 * whether they paid (the parent sees `Zaplaceno`), a note for the staff (no
 * parent ever does), and a message to the parent (in the app and by e-mail).
 *
 * Nothing waits for a `Uložit`: payment saves on the tap, the note when the
 * field is left, the message on `Odeslat rodiči`. A coach at the rink closes
 * the sheet with `Hotovo` and nothing is lost.
 *
 * A coach who may only view the training (decision 33) sees the same three as
 * text. The database refuses them the rest (FORBIDDEN_EDIT).
 */
export function PlayerCard({
  entry,
  guardians,
  sessionId,
  sessionLabel,
  timezone,
  editable,
  removable,
  profileNote,
  myName,
  onClose,
}: {
  entry: RosterEntry
  /** null while the row that opened this sheet is still fetching them. */
  guardians: BookingGuardian[] | null
  sessionId: string
  /** `Ne 4. 10. · 09:00`, so the removal dialog names the training. */
  sessionLabel: string
  timezone: string
  /** canEdit(session), and the training not cancelled. */
  editable: boolean
  /** False once the training is over: nobody is removed from the past. */
  removable: boolean
  /** The athlete's general note (§K13), shown read-only under this one. */
  profileNote: string | null
  /** Who is signed in, for `Označil …` before the server confirms it. */
  myName: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()

  const name = `${entry.firstName} ${entry.lastName}`

  // Payment: shown as tapped at once, put back if the database says no.
  const [paidAt, setPaidAt] = useState(entry.paidAt)
  const [paidByName, setPaidByName] = useState(entry.paidByName)
  const paid = paidAt !== null

  // The note saves when the field is left, and only if it changed.
  const [note, setNote] = useState(entry.coachNote ?? '')
  const [savedNote, setSavedNote] = useState(entry.coachNote ?? '')
  const [noteError, setNoteError] = useState<string | null>(null)

  // The message: the sent one, and the editor that replaces it.
  const [sent, setSent] = useState(
    entry.parentMessage && entry.parentMessageSentAt
      ? { text: entry.parentMessage, at: entry.parentMessageSentAt }
      : null,
  )
  const [editingMessage, setEditingMessage] = useState(sent === null)
  const [message, setMessage] = useState(entry.parentMessage ?? '')
  const [messageError, setMessageError] = useState<string | null>(null)

  const [confirming, setConfirming] = useState(false)
  const [removalMessage, setRemovalMessage] = useState('')
  const [removalError, setRemovalError] = useState<string | null>(null)

  const guardianNames = (guardians ?? [])
    .map((g) => g.displayName)
    .filter((n): n is string => Boolean(n))
    .join(', ')

  function togglePaid() {
    const was = { paidAt, paidByName }
    const next = !paid
    setPaidAt(next ? new Date().toISOString() : null)
    setPaidByName(next ? myName : null)
    startTransition(async () => {
      const result = await setBookingPaid(sessionId, entry.bookingId, next)
      if (!result.ok) {
        setPaidAt(was.paidAt)
        setPaidByName(was.paidByName)
        toast(errorText(result.code))
        return
      }
      router.refresh()
    })
  }

  function saveNote() {
    if (note.trim() === savedNote.trim()) return
    setNoteError(null)
    const draft = note
    startTransition(async () => {
      const result = await setCoachNote(sessionId, entry.bookingId, draft)
      if (!result.ok) {
        setNoteError(errorText(result.code))
        return
      }
      setSavedNote(draft)
      router.refresh()
    })
  }

  function send() {
    setMessageError(null)
    const text = message
    startTransition(async () => {
      const result = await sendParentMessage(sessionId, entry.bookingId, text)
      if (!result.ok) {
        setMessageError(errorText(result.code))
        return
      }
      setSent({ text: text.trim(), at: new Date().toISOString() })
      setEditingMessage(false)
      toast(t.messageSentToast)
      router.refresh()
    })
  }

  function onRemove() {
    setRemovalError(null)
    startTransition(async () => {
      const result = await removeAthleteFromSession(
        sessionId,
        entry.bookingId,
        removalMessage.trim(),
      )
      if (!result.ok) {
        setRemovalError(errorText(result.code))
        return
      }
      setConfirming(false)
      onClose()
      toast(t.removed)
      router.refresh()
    })
  }

  return (
    <>
      <BottomSheet
        open
        tall
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={name}
        subtitle={athleteLine(entry)}
        lead={<Avatar firstName={entry.firstName} lastName={entry.lastName} size={48} />}
        footer={
          <div className="flex flex-col items-center gap-1">
            <Button size="lg" onClick={onClose}>
              {t.done}
            </Button>
            {removable ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={pending}
                className="flex min-h-11 items-center text-row font-semibold text-danger"
              >
                {t.removeFromSession}
              </button>
            ) : null}
          </div>
        }
      >
        {/* Who to ring. Every active guardian, one row each: the one who
            booked is not necessarily the one at the rink. */}
        <ul className="flex flex-col gap-2">
          {guardians === null ? (
            <li className="rounded-[12px] bg-surface p-3 text-meta text-muted shadow-card">
              {t.loadingValue}
            </li>
          ) : (
            guardians.map((guardian, index) => (
              <li
                key={guardian.profileId}
                className="flex items-center gap-3 rounded-[12px] bg-surface p-3 shadow-card"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-row font-bold text-ink">
                    {guardian.displayName ?? t.none}
                  </span>
                  <span className="text-hint text-muted">
                    {[
                      index === 0
                        ? t.guardianBooked.replace(
                            '{when}',
                            formatDateTime(new Date(entry.bookedAt), timezone),
                          )
                        : null,
                      guardian.phone ? formatPhone(guardian.phone) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {guardian.phone ? (
                  <a
                    href={`tel:${guardian.phone}`}
                    aria-label={t.callGuardian.replace('{phone}', formatPhone(guardian.phone))}
                    className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-primary-100 text-primary"
                  >
                    <PhoneIcon />
                  </a>
                ) : null}
              </li>
            ))
          )}
        </ul>

        {/* 1 · Payment. Saves on the tap. */}
        {editable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={paid}
            onClick={togglePaid}
            disabled={pending}
            className={cn(
              'flex min-h-15 items-center gap-3 rounded-card px-4 py-3 text-left',
              paid
                ? 'bg-success-soft shadow-[inset_0_0_0_2px_var(--color-success)]'
                : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-line)]',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-[6px]',
                paid
                  ? 'bg-success text-white'
                  : 'bg-surface shadow-[inset_0_0_0_1.5px_var(--color-subtle)]',
              )}
            >
              {paid ? <CheckIcon className="size-4" /> : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={cn('text-body font-bold', paid ? 'text-success' : 'text-ink')}>
                {t.paid}
              </span>
              <span className="text-hint text-muted">
                {paid && paidAt
                  ? t.paidBy
                      .replace('{name}', paidByName ?? t.none)
                      .replace('{when}', formatDateAtTime(new Date(paidAt), timezone))
                  : t.paidHint}
              </span>
            </span>
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 shadow-card">
            <PaymentChip paid={paid} />
            {paid && paidAt ? (
              <span className="text-hint text-muted">
                {t.paidBy
                  .replace('{name}', paidByName ?? t.none)
                  .replace('{when}', formatDateAtTime(new Date(paidAt), timezone))}
              </span>
            ) : null}
          </div>
        )}

        {/* 2 · The note for this training. Staff only, saved on blur. */}
        <section className="flex flex-col gap-2 rounded-card bg-internal p-4 shadow-[inset_0_0_0_1px_var(--color-internal-border)]">
          <h3 className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.05em] text-internal-ink">
            <LockIcon />
            {t.bookingNoteCaption}
          </h3>
          {editable ? (
            <TextareaWithCounter
              value={note}
              onChange={setNote}
              onBlur={saveNote}
              maxLength={COACH_NOTE_LIMIT}
              rows={3}
              placeholder={t.bookingNotePlaceholder}
              aria-label={t.bookingNoteCaption}
            />
          ) : (
            <p className="whitespace-pre-line text-body text-ink">
              {savedNote || <span className="text-muted">{t.bookingNoteNone}</span>}
            </p>
          )}
          {noteError ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {noteError}
            </p>
          ) : null}
          {profileNote ? (
            <p className="text-hint text-internal-ink">
              {t.profileNote.replace('{note}', profileNote)}
            </p>
          ) : null}
        </section>

        {/* 3 · The message to the parent. In the app and by e-mail. */}
        <section className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
          <h3 className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.05em] text-muted">
            <BubbleIcon />
            {guardianNames
              ? t.messageCaption.replace('{names}', guardianNames)
              : t.messageCaptionNoGuardian}
          </h3>

          {editable && editingMessage ? (
            <>
              <TextareaWithCounter
                value={message}
                onChange={setMessage}
                maxLength={PARENT_MESSAGE_LIMIT}
                rows={3}
                placeholder={t.messagePlaceholder}
                aria-label={t.messagePlaceholder}
              />
              <p className="text-hint text-muted">{t.messageHelper}</p>
              {messageError ? (
                <p role="alert" className="text-hint font-semibold text-danger">
                  {messageError}
                </p>
              ) : null}
              <span>
                <Button
                  variant="secondary"
                  onClick={send}
                  disabled={message.trim() === '' || pending}
                  {...(pending ? { loadingLabel: t.sendingMessage } : {})}
                >
                  <BubbleIcon className="size-4" />
                  {t.sendMessage}
                </Button>
              </span>
            </>
          ) : sent ? (
            <>
              <p className="whitespace-pre-line text-body text-ink">{sent.text}</p>
              <p className="flex items-center gap-1.5 text-hint font-semibold text-success">
                <CheckIcon />
                {t.messageSentAt.replace('{when}', formatDateAtTime(new Date(sent.at), timezone))}
              </p>
              {editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setMessage(sent.text)
                    setEditingMessage(true)
                  }}
                  className="flex min-h-11 items-center self-start text-row font-semibold text-primary"
                >
                  {t.resendMessage}
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-meta text-muted">{t.messageNone}</p>
          )}
        </section>
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
                maxLength={REMOVAL_MESSAGE_LIMIT}
                value={removalMessage}
                onChange={setRemovalMessage}
              />
            )}
          </Field>
          <p className="flex items-start gap-1.5 text-meta text-muted">
            <MailIcon />
            {t.removeInfo}
          </p>
          {removalError ? (
            <p role="alert" className="text-hint text-danger">
              {removalError}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  )
}
