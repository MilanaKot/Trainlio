'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { createSession, updateSession } from '@/server/sessions/actions'
import type { CoachSession, CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

type Props = {
  workspace: CoachWorkspace
  session?: CoachSession | undefined
  /** Wall-clock values already rendered in the workspace timezone by the server. */
  initial: { date: string; start: string; end: string }
}

type Confirmation =
  | { kind: 'capacity'; confirmed: number; capacity: number }
  | { kind: 'eligibility'; count: number }

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

/**
 * Create and edit.
 *
 * The two warnings are driven by the server, not by the form: it refuses the
 * change and returns the count, and only then is the dialog shown. A coach
 * cannot reach the write path without passing the flag back, and the UI cannot
 * grant it by forgetting to render the dialog.
 */
export function SessionForm({ workspace, session, initial }: Props) {
  const router = useRouter()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [mode, setMode] = useState(session?.eligibilityMode ?? 'ALL')
  const [pending, startTransition] = useTransition()

  function submit(form: FormData, confirm: { overCapacity?: boolean; ineligibleBookings?: boolean }) {
    startTransition(async () => {
      const result = session
        ? await updateSession(session.id, form, confirm)
        : await createSession(workspace.id, form)

      if (result.ok) {
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
          confirmed: result.details?.confirmed_count ?? 0,
          capacity: result.details?.requested_capacity ?? 0,
        })
        return
      }

      if (result.code === 'BOOKINGS_WOULD_BECOME_INELIGIBLE') {
        setConfirmation({ kind: 'eligibility', count: result.details?.affected_count ?? 0 })
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
    submit(new FormData(event.currentTarget), {})
  }

  function onConfirm(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest('form')
    if (!form || !confirmation) return
    const data = new FormData(form)
    // Each warning is answered on its own. Confirming a capacity reduction does
    // not also confirm an eligibility narrowing the coach has not been shown.
    submit(
      data,
      confirmation.kind === 'capacity' ? { overCapacity: true } : { overCapacity: true, ineligibleBookings: true },
    )
  }

  function fieldError(name: string) {
    const code = fieldErrors[name]
    if (!code) return null
    return (
      <p role="alert" className="text-sm text-red-600">
        {errorText(code)}
      </p>
    )
  }

  const input = 'rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20'
  const label = 'flex flex-col gap-2 text-sm font-medium'

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t.date}
          <input name="localDate" type="date" required defaultValue={initial.date} className={input} />
          {fieldError('localDate')}
        </label>
        <label className={label}>
          {t.startTime}
          <input name="localStartTime" type="time" required defaultValue={initial.start} className={input} />
          {fieldError('localStartTime')}
        </label>
        <label className={label}>
          {t.endTime}
          <input name="localEndTime" type="time" required defaultValue={initial.end} className={input} />
          {fieldError('localEndTime')}
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t.facility}
          <select name="facilityId" required defaultValue={session ? undefined : ''} className={input}>
            {workspace.facilities.map((facility) => (
              <option
                key={facility.id}
                value={facility.id}
                selected={session ? facility.code === session.facilityCode : undefined}
              >
                {facility.code} — {facility.name}
              </option>
            ))}
          </select>
          {fieldError('facilityId')}
        </label>

        <label className={label}>
          {t.capacity}
          <input
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            required
            defaultValue={session?.capacity ?? 10}
            className={input}
          />
          {fieldError('capacity')}
        </label>

        <label className={label}>
          {t.changingRoom}
          <input name="changingRoom" defaultValue={session?.changingRoom ?? ''} className={input} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{t.eligibility}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="eligibilityMode"
            value="ALL"
            checked={mode === 'ALL'}
            onChange={() => setMode('ALL')}
          />
          {t.eligibilityAll}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="eligibilityMode"
            value="BIRTH_YEAR_RANGE"
            checked={mode === 'BIRTH_YEAR_RANGE'}
            onChange={() => setMode('BIRTH_YEAR_RANGE')}
          />
          {t.eligibilityRange}
        </label>

        {mode === 'BIRTH_YEAR_RANGE' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {t.birthYearFrom}
              <input
                name="birthYearFrom"
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                defaultValue={session?.birthYearFrom ?? ''}
                className={input}
              />
              {fieldError('birthYearFrom')}
            </label>
            <label className={label}>
              {t.birthYearTo}
              <input
                name="birthYearTo"
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                defaultValue={session?.birthYearTo ?? ''}
                className={input}
              />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className={label}>
        {t.mainCoach}
        <select
          name="mainCoachProfileId"
          defaultValue={session?.mainCoachId ?? workspace.coaches[0]?.id ?? ''}
          className={input}
        >
          {workspace.coaches.map((coach) => (
            <option key={coach.id} value={coach.id}>
              {coach.displayName ?? '—'}
            </option>
          ))}
        </select>
      </label>

      {/* D-13: two separate fields, because one is read by parents and one is not. */}
      <label className={label}>
        {t.publicNotes} <span className="font-normal opacity-60">— {t.publicNotesHint}</span>
        <textarea name="publicNotes" rows={2} defaultValue={session?.publicNotes ?? ''} className={input} />
      </label>

      <label className={label}>
        {t.internalNotes} <span className="font-normal opacity-60">— {t.internalNotesHint}</span>
        <textarea name="internalNotes" rows={2} defaultValue={session?.internalNotes ?? ''} className={input} />
      </label>

      {confirmation ? (
        <div className="flex flex-col gap-3 rounded-lg border border-black/20 p-4 dark:border-white/25">
          <p className="font-medium">
            {confirmation.kind === 'capacity' ? t.capacityWarningTitle : t.eligibilityWarningTitle}
          </p>
          <p className="text-sm leading-relaxed">
            {confirmation.kind === 'capacity'
              ? t.capacityWarning
                  .replace('{confirmed}', String(confirmation.confirmed))
                  .replace('{capacity}', String(confirmation.capacity))
              : t.eligibilityWarning.replace('{count}', String(confirmation.count))}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmation(null)}
              className="min-h-11 rounded-lg border border-black/15 px-4 text-sm dark:border-white/20"
            >
              {messages.common.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="min-h-11 rounded-lg bg-black px-4 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {t.saveAnyway}
            </button>
          </div>
        </div>
      ) : null}

      {formError ? (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-12 rounded-lg bg-black px-4 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? messages.athlete.saving : messages.athlete.save}
      </button>
    </form>
  )
}
