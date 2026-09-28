'use client'

import Link, { type LinkProps } from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { cancelSession, duplicateSession, setBookingState } from '@/server/sessions/actions'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { CoachSession } from '@/server/sessions/queries'

const t = messages.coach

// Generic over the route so typed routes still check the href: a template
// literal built from a session id is verified here exactly as it would be on
// an inline <Link>.
function Row<T>({
  href,
  onClick,
  icon,
  children,
}: {
  href?: LinkProps<T>['href']
  onClick?: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const className =
    'flex h-14 w-full items-center gap-3 rounded-card bg-surface px-4 text-row font-semibold text-ink shadow-card'
  const body = (
    <>
      <span className="text-muted" aria-hidden="true">
        {icon}
      </span>
      {children}
    </>
  )

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  )
}

const PencilIcon = (
  <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
    <path
      d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

const CopyIcon = (
  <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
    <rect x="3" y="3" width="10" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7 17h6a3 3 0 003-3V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const LockIcon = (
  <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
    <rect x="4" y="9" width="12" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7 9V6.5a3 3 0 016 0V9" stroke="currentColor" strokeWidth="1.6" />
  </svg>
)

const CrossIcon = (
  <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

const CheckIcon = (
  <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
    <path
      d="M3.5 8.5l3 3 6-7"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const UndoIcon = (
  <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
    <path d="M3 8a5 5 0 115 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path
      d="M5.5 5.5H2.5V2.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const MailIcon = (
  <svg viewBox="0 0 16 16" fill="none" className="size-4 shrink-0" aria-hidden="true">
    <rect x="2" y="3.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 5l5.5 4 5.5-4" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

/**
 * What a coach does to a training (coach/SPEC.md §K2 §7–8, §K5, §K6).
 *
 * Two consequences, two shapes. Closing registration is reversible and the
 * sheet lists what it does and does not do, ending with the fact that it can
 * be reopened. Cancelling is terminal (D-07) and e-mails every booked family,
 * so it is a centred dialog whose confirm button is the red one and whose
 * default is not to.
 *
 * Neither is what enforces anything. The domain functions re-check the coach's
 * membership and the session's state, and refuse a cancelled session outright.
 */
export function SessionControls({
  session,
  confirmedCount,
  todayLocal,
}: {
  session: CoachSession
  confirmedCount: number
  /** Today in the workspace timezone, the sensible default for a copy. */
  todayLocal: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [closing, setClosing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateDate, setDuplicateDate] = useState(todayLocal)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const open = session.status === 'OPEN'

  function run(action: () => Promise<{ ok: boolean; code?: string }>, done: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        setError(table[result.code ?? ''] ?? t.errors.generic)
        return
      }
      done()
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-caption font-bold uppercase tracking-[0.05em] text-muted">
        {t.actionsCaption}
      </h2>

      <div className="flex flex-col gap-2">
        <Row href={`/trener/${session.id}/upravit`} icon={PencilIcon}>
          {t.editSession}
        </Row>
        <Row onClick={() => setDuplicating(true)} icon={CopyIcon}>
          {t.duplicate}
        </Row>
        {open ? (
          <Row onClick={() => setClosing(true)} icon={LockIcon}>
            {t.closeBooking}
          </Row>
        ) : (
          <Row
            onClick={() =>
              run(
                () => setBookingState(session.id, true),
                () => toast(t.reopened),
              )
            }
            icon={LockIcon}
          >
            {t.openBooking}
          </Row>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-hint text-danger">
          {error}
        </p>
      ) : null}

      <div className="pt-8">
        <Button variant="danger-outline" size="lg" onClick={() => setCancelling(true)}>
          {t.cancelSession}
        </Button>
      </div>

      <BottomSheet
        open={closing}
        onOpenChange={setClosing}
        title={t.closeTitle}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              {...(pending ? { loadingLabel: messages.athlete.saving } : {})}
              onClick={() =>
                run(
                  () => setBookingState(session.id, false),
                  () => {
                    setClosing(false)
                    toast(t.closed)
                  },
                )
              }
            >
              {t.closeConfirm}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setClosing(false)}>
              {t.closeKeepOpen}
            </Button>
          </div>
        }
      >
        {/* What it does, what it does not, and that it is not final. A coach
            closing registration an hour before a training should not have to
            guess whether the people already in are affected. */}
        <ul className="flex flex-col gap-3 text-row">
          <li className="flex items-start gap-2 text-ink">
            <span className="text-danger">{CrossIcon}</span>
            {t.closeConsequenceNoNew}
          </li>
          <li className="flex items-start gap-2 text-ink">
            <span className="text-success">{CheckIcon}</span>
            {plural(confirmedCount, t.closeConsequenceKeep)}
          </li>
          <li className="flex items-start gap-2 text-ink">
            <span className="text-success">{CheckIcon}</span>
            {t.closeConsequenceManual}
          </li>
          <li className="flex items-start gap-2 text-muted">
            <span>{UndoIcon}</span>
            {t.closeConsequenceReopen}
          </li>
        </ul>
      </BottomSheet>

      {/* §K4 gives duplicating a screen of its own, with the whole form and a
          period option. Until that screen exists this keeps the action
          working: the one thing a copy needs that the source cannot supply is
          its date. */}
      <ConfirmDialog
        open={duplicating}
        onOpenChange={setDuplicating}
        title={t.duplicateTitle}
        cancelLabel={messages.common.cancel}
        confirmLabel={t.duplicate}
        pending={pending}
        onConfirm={() =>
          run(
            () => duplicateSession(session.id, duplicateDate),
            () => setDuplicating(false),
          )
        }
      >
        <Field label={t.date}>
          {(field) => (
            <input
              {...field}
              type="date"
              value={duplicateDate}
              onChange={(event) => setDuplicateDate(event.target.value)}
            />
          )}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t.cancelTitle}
        description={t.cancelBody}
        tone="danger"
        cancelLabel={t.cancelKeep}
        confirmLabel={t.cancelConfirmButton}
        confirmVariant="danger"
        stacked
        pending={pending}
        onConfirm={() =>
          run(
            () => cancelSession(session.id, ''),
            () => {
              setCancelling(false)
              toast(t.cancelled)
            },
          )
        }
      >
        <div className="flex flex-col gap-2 rounded-control-lg bg-bg p-3">
          <p className="flex items-start gap-2 text-meta text-ink">
            {MailIcon}
            {plural(confirmedCount, t.cancelEmailCount)}
          </p>
          <p className="text-meta font-semibold text-danger">{t.cancelTerminal}</p>
        </div>
      </ConfirmDialog>
    </section>
  )
}
