'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { createSession, updateSession } from '@/server/sessions/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Notice } from '@/components/ui/notice'
import { Panel, TrainingFields } from '@/components/session/training-fields'
import type { BookedAthlete, SessionFormValues } from '@/components/session/training-fields'
import type { CoachSession, CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

export type { BookedAthlete, SessionFormValues }

type Confirmation =
  { kind: 'capacity'; confirmed: number; capacity: number } | { kind: 'eligibility'; count: number }

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 4.5l6 4 6-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * Create and edit one training (coach/SPEC.md §K3).
 *
 * Two things this form does not decide.
 *
 * The warnings. Reducing capacity below what is booked, and narrowing the years
 * past somebody who is already coming, are both refused by the domain function
 * unless the call carries the matching flag; the count in the dialog is the
 * count the refusal returned. A client that chose not to render either dialog
 * would simply be told no (principle 5, BR-051, D-08).
 *
 * Who gets an e-mail. The form states the consequence before the coach saves —
 * that is the whole point of the footer notice — but the outbox rows are
 * written by the same transaction as the change, from its own idea of what is
 * significant (D-11). The notice mirrors that list; it does not define it.
 */
export function SessionForm({
  workspace,
  session,
  initial,
  bookedCount = 0,
  bookedAthletes = [],
  submitLabel,
  /** §K4: a duplicate opens with no date and cannot be created without one. */
  requireDate = false,
  notice,
}: {
  workspace: CoachWorkspace
  session?: CoachSession | undefined
  initial: SessionFormValues
  bookedCount?: number
  bookedAthletes?: BookedAthlete[]
  submitLabel?: string
  requireDate?: boolean
  notice?: React.ReactNode
}) {
  const router = useRouter()
  const [values, setValues] = useState<SessionFormValues>(initial)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = <K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(initial), [values, initial])

  /**
   * The fields whose change sends an e-mail (D-11), and only for a training
   * that exists and has somebody coming.
   */
  const significant = useMemo(() => {
    if (!session || bookedCount === 0) return []
    const changed: string[] = []
    if (values.date !== initial.date) changed.push(t.changedDate)
    if (values.start !== initial.start || values.end !== initial.end) changed.push(t.changedTime)
    if (values.locationName !== initial.locationName) changed.push(t.changedLocation)
    if (values.facilityId !== initial.facilityId) changed.push(t.changedFacility)
    if (values.mainCoachId !== initial.mainCoachId) changed.push(t.changedMainCoach)
    return changed
  }, [session, bookedCount, values, initial])

  /** §K9's list: who is booked and would fall outside the years being set. */
  const excluded = useMemo(() => {
    if (values.eligibilityMode !== 'BIRTH_YEAR_RANGE') return []
    const from = Number(values.birthYearFrom)
    const to = Number(values.birthYearTo)
    if (!from || !to) return []
    return bookedAthletes.filter((athlete) => athlete.birthYear < from || athlete.birthYear > to)
  }, [values.eligibilityMode, values.birthYearFrom, values.birthYearTo, bookedAthletes])

  function formData(): FormData {
    const form = new FormData()
    form.set('localDate', values.date)
    form.set('localStartTime', values.start)
    form.set('localEndTime', values.end)
    form.set('facilityId', values.facilityId)
    form.set('capacity', String(values.capacity))
    form.set('eligibilityMode', values.eligibilityMode)
    form.set('birthYearFrom', values.eligibilityMode === 'ALL' ? '' : values.birthYearFrom)
    form.set('birthYearTo', values.eligibilityMode === 'ALL' ? '' : values.birthYearTo)
    form.set('changingRoom', values.changingRoom)
    form.set('publicNotes', values.publicNotes)
    form.set('internalNotes', values.internalNotes)
    form.set('mainCoachProfileId', values.mainCoachId)
    return form
  }

  function submit(confirm: { overCapacity?: boolean; ineligibleBookings?: boolean }) {
    startTransition(async () => {
      const result = session
        ? await updateSession(session.id, formData(), confirm, values.assistantIds)
        : await createSession(workspace.id, formData(), values.assistantIds)

      if (result.ok) {
        setConfirmation(null)
        router.push(result.sessionId ? `/trener/${result.sessionId}` : '/trener')
        router.refresh()
        return
      }

      if (result.code === 'VALIDATION' && result.fieldErrors) {
        setFieldErrors(result.fieldErrors)
        return
      }

      if (result.code === 'CAPACITY_BELOW_OCCUPANCY') {
        setConfirmation({
          kind: 'capacity',
          confirmed: result.details?.confirmed_count ?? bookedCount,
          capacity: result.details?.requested_capacity ?? values.capacity,
        })
        return
      }

      if (result.code === 'BOOKINGS_WOULD_BECOME_INELIGIBLE') {
        setConfirmation({
          kind: 'eligibility',
          count: result.details?.affected_count ?? excluded.length,
        })
        return
      }

      setFormError(errorText(result.code))
    })
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFieldErrors({})
    setFormError(null)
    setConfirmation(null)
    submit({})
  }

  function leave() {
    router.push(session ? `/trener/${session.id}` : '/trener')
  }

  const fieldError = (name: string) => {
    const code = fieldErrors[name]
    return code ? errorText(code) : undefined
  }

  /** `Původně …`, but only for a training that already exists. */
  const was = (key: keyof SessionFormValues, render: (value: string) => string = (v) => v) => {
    if (!session) return undefined
    const before = initial[key]
    if (typeof before !== 'string' || before === values[key]) return undefined
    return render(before)
  }

  return (
    // The bottom padding clears the fixed footer, which is taller when it
    // carries the notice.
    <form
      onSubmit={onSubmit}
      className={significant.length > 0 ? 'flex flex-col gap-5 pb-64' : 'flex flex-col gap-5 pb-36'}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => (dirty ? setDiscarding(true) : leave())}
          className="flex min-h-11 items-center text-row font-semibold text-muted"
        >
          {messages.common.cancel}
        </button>
      </div>

      <h1 className="font-display text-form-title font-bold text-ink">
        {session ? t.editSessionTitle : t.newSessionTitle}
      </h1>

      {notice}

      <Panel caption={t.whenCaption}>
        <Field
          label={t.date}
          required
          {...(fieldError('localDate') ? { error: fieldError('localDate') } : {})}
          {...(was('date') ? { previously: was('date') } : {})}
        >
          {(props) => (
            <input
              {...props}
              type="date"
              value={values.date}
              autoFocus={requireDate}
              onChange={(event) => set('date', event.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.startTime}
            required
            {...(fieldError('localStartTime') ? { error: fieldError('localStartTime') } : {})}
            {...(was('start') ? { previously: was('start') } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="time"
                value={values.start}
                onChange={(event) => set('start', event.target.value)}
              />
            )}
          </Field>
          <Field
            label={t.endTime}
            required
            {...(fieldError('localEndTime') ? { error: fieldError('localEndTime') } : {})}
            {...(was('end') ? { previously: was('end') } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="time"
                value={values.end}
                onChange={(event) => set('end', event.target.value)}
              />
            )}
          </Field>
        </div>
      </Panel>

      <TrainingFields
        workspace={workspace}
        values={values}
        setValues={setValues}
        {...(session ? { initial } : {})}
        fieldError={fieldError}
        bookedCount={session ? bookedCount : 0}
        notesAreDefault={!session}
      />

      {formError ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {formError}
        </p>
      ) : null}

      {/* The footer is fixed: the consequence of the change and the button that
          commits it belong together, and on a phone the form is longer than the
          screen. */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl flex-col gap-3 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
        {significant.length > 0 ? (
          <Notice
            variant="warning"
            icon={<MailIcon />}
            title={
              significant.length === 1 ? (significant[0] ?? t.changedSeveral) : t.changedSeveral
            }
          >
            {plural(bookedCount, t.changedEmail)}
          </Notice>
        ) : null}

        {requireDate && values.date === '' ? (
          <p className="text-center text-hint text-muted">{t.pickDateFirst}</p>
        ) : null}

        <Button
          type="submit"
          size="lg"
          disabled={pending || (requireDate && values.date === '')}
          {...(pending ? { loadingLabel: t.saving } : {})}
        >
          {submitLabel ?? (session ? t.saveChanges : t.createSession)}
        </Button>
      </div>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={t.discardTitle}
        tone="warning"
        cancelLabel={t.discardKeep}
        confirmLabel={t.discardConfirm}
        confirmVariant="danger"
        stacked
        onConfirm={leave}
      />

      <ConfirmDialog
        open={confirmation?.kind === 'capacity'}
        onOpenChange={(open) => (open ? undefined : setConfirmation(null))}
        title={
          confirmation?.kind === 'capacity'
            ? plural(confirmation.confirmed, t.capacityBelowTitle)
            : ''
        }
        cancelLabel={messages.common.cancel}
        confirmLabel={t.saveAnyway}
        onConfirm={() => submit({ overCapacity: true })}
        pending={pending}
      >
        {confirmation?.kind === 'capacity' ? (
          <div className="flex flex-col gap-1 text-meta text-muted">
            <p className="text-row font-semibold text-ink">
              {t.capacityBelowNew.replace('{capacity}', String(confirmation.capacity))}
            </p>
            <p>{t.capacityBelowKept}</p>
            <p>{t.capacityBelowHelp.replace('{capacity}', String(confirmation.capacity))}</p>
          </div>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmation?.kind === 'eligibility'}
        onOpenChange={(open) => (open ? undefined : setConfirmation(null))}
        title={
          confirmation?.kind === 'eligibility' ? plural(confirmation.count, t.ineligibleTitle) : ''
        }
        tone="warning"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.saveAnyway}
        onConfirm={() => submit({ overCapacity: true, ineligibleBookings: true })}
        pending={pending}
      >
        <div className="flex flex-col gap-2 text-meta text-muted">
          <p className="text-row font-semibold text-ink">
            {t.ineligibleRange
              .replace('{from}', rangeLabel(initial))
              .replace('{to}', rangeLabel(values))}
          </p>
          {excluded.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-control-lg bg-bg p-3">
              {excluded.map((athlete) => (
                <li key={`${athlete.firstName}-${athlete.lastName}-${athlete.birthYear}`}>
                  {athlete.firstName} {athlete.lastName} · {athlete.birthYear}
                </li>
              ))}
            </ul>
          ) : null}
          <p>✓ {t.ineligibleKept}</p>
          <p>✉ {t.ineligibleNotified}</p>
        </div>
      </ConfirmDialog>
    </form>
  )
}

function rangeLabel(values: SessionFormValues): string {
  if (values.eligibilityMode === 'ALL') return t.eligibilityAll
  if (values.birthYearFrom === values.birthYearTo) return values.birthYearFrom
  return `${values.birthYearFrom}–${values.birthYearTo}`
}
