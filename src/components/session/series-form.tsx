'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { messages, plural } from '@/lib/i18n'
import { weeklyOccurrenceDates, formatLocalDateShort } from '@/lib/time/workspace-time'
import { ISO_WEEKDAYS, MAX_SERIES_OCCURRENCES } from '@/lib/domain/series'
import { createSeries } from '@/server/sessions/actions'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Notice } from '@/components/ui/notice'
import { Panel, TrainingFields } from '@/components/session/training-fields'
import type { SessionFormValues } from '@/components/session/training-fields'
import type { CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

/**
 * A season of trainings (coach/SPEC.md §K11), and the same screen as a copy of
 * one training over a period (§K4b).
 *
 * The preview runs the same rule the server does — whole calendar days in the
 * workspace timezone — so what a coach approves is what gets created. It is
 * still only a preview: the generated dates are not submitted. What is
 * submitted is the pattern plus the dates the coach UNCHECKED, so a stale or
 * edited client can decline an occurrence but never conjure one.
 *
 * Everything a training is, apart from when it happens, is the same panels the
 * single form uses. A season that offered different halls or a different note
 * limit would be a second product.
 */
export function SeriesForm({
  workspace,
  today,
  initial,
  /** §K4b: the training this period was copied from, for the notice. */
  source,
}: {
  workspace: CoachWorkspace
  today: string
  initial: SessionFormValues
  source?: { id: string; label: string } | undefined
}) {
  const router = useRouter()
  const [values, setValues] = useState<SessionFormValues>(initial)
  const [byWeekdays, setByWeekdays] = useState<number[]>(
    initial.date ? [isoWeekday(initial.date)] : [7],
  )
  const [dateFrom, setDateFrom] = useState(initial.date || today)
  const [dateTo, setDateTo] = useState(initial.date || today)
  // Dates the coach unchecked. Kept by date rather than by index, so changing
  // the range does not silently move an exclusion onto a different day.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = useState(source === undefined)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const preview = useMemo(() => {
    try {
      return weeklyOccurrenceDates(dateFrom, dateTo, byWeekdays)
    } catch {
      return []
    }
  }, [dateFrom, dateTo, byWeekdays])

  const selected = useMemo(() => preview.filter((d) => !excluded.has(d)), [preview, excluded])
  const overLimit = selected.length > MAX_SERIES_OCCURRENCES

  function toggleWeekday(day: number) {
    setByWeekdays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    )
  }

  function toggleDate(date: string) {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})

    const form = new FormData()
    form.set('localDate', '')
    form.set('localStartTime', values.start)
    form.set('localEndTime', values.end)
    form.set('localDateFrom', dateFrom)
    form.set('localDateTo', dateTo)
    form.set('facilityId', values.facilityId)
    form.set('capacity', String(values.capacity))
    form.set('eligibilityMode', values.eligibilityMode)
    form.set('birthYearFrom', values.eligibilityMode === 'ALL' ? '' : values.birthYearFrom)
    form.set('birthYearTo', values.eligibilityMode === 'ALL' ? '' : values.birthYearTo)
    form.set('changingRoom', values.changingRoom)
    form.set('publicNotes', values.publicNotes)
    form.set('internalNotes', values.internalNotes)
    form.set('mainCoachProfileId', values.mainCoachId)
    for (const day of byWeekdays) form.append('byWeekday', String(day))
    // Only the unchecked dates travel. The server re-derives the pattern and
    // subtracts these, so this list can shrink a series but never extend one.
    for (const date of preview) if (excluded.has(date)) form.append('excludedDate', date)

    startTransition(async () => {
      const result = await createSeries(workspace.id, form)
      if (!result.ok) {
        if (result.code === 'VALIDATION' && result.fieldErrors) {
          setFieldErrors(result.fieldErrors)
          return
        }
        setError(errorText(result.code))
        return
      }
      router.push('/trener/serie')
      router.refresh()
    })
  }

  const fieldError = (name: string) => {
    const code = fieldErrors[name]
    return code ? errorText(code) : undefined
  }

  const hall = workspace.facilities.find((f) => f.id === values.facilityId)
  const summary = [
    hall?.code,
    values.changingRoom,
    `${t.capacity} ${values.capacity}`,
    values.eligibilityMode === 'ALL'
      ? t.eligibilityAllShort
      : `${values.birthYearFrom}–${values.birthYearTo}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 pb-36">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/trener"
          className="flex min-h-11 items-center text-row font-semibold text-muted"
        >
          {messages.common.cancel}
        </Link>
      </div>

      <h1 className="font-display text-form-title font-bold text-ink">
        {source ? t.newSessionTitle : t.series}
      </h1>

      {source ? (
        <div className="flex flex-col gap-3">
          <Notice variant="info" title={t.duplicateNotice.replace('{source}', source.label)}>
            {/* Not `Vyberte nové datum` here: on a period the dates come from
                the pattern below, not from a field. */}
            {t.duplicateNoticeAthletes}
          </Notice>

          <div
            role="tablist"
            aria-label={t.duplicateTitle}
            className="flex gap-1 rounded-control-lg bg-neutral-50 p-1"
          >
            <Link
              role="tab"
              aria-selected="false"
              href={{ pathname: '/trener/novy', query: { from: source.id } }}
              className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] text-row text-muted"
            >
              {t.duplicateOne}
            </Link>
            <span
              role="tab"
              aria-selected="true"
              className="flex min-h-11 flex-1 items-center justify-center rounded-[9px] bg-surface text-row text-ink shadow-card"
            >
              {t.duplicatePeriod}
            </span>
          </div>
        </div>
      ) : null}

      <Panel caption={source ? t.whenCaption : t.repeatCaption}>
        {/* Multi-select, 44px (coach/SPEC.md §K4b). The checked days are posted
            as the pattern; the server normalises and re-derives the dates. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-meta font-semibold text-ink">{t.repeatEvery}</legend>
          <div className="flex flex-wrap gap-2">
            {ISO_WEEKDAYS.map((day) => {
              const on = byWeekdays.includes(day)
              return (
                <label
                  key={day}
                  className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control px-3 text-row font-semibold ${
                    on
                      ? 'bg-primary text-white'
                      : 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleWeekday(day)}
                    className="sr-only"
                  />
                  {/* Two letters for the eye, the whole weekday for a screen
                      reader — "Po Pondělí" would be read out otherwise. */}
                  <span aria-hidden="true">
                    {t.weekdaysShort[String(day) as keyof typeof t.weekdaysShort]}
                  </span>
                  <span className="sr-only">
                    {t.weekdays[String(day) as keyof typeof t.weekdays]}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.yearFrom} required>
            {(props) => (
              <input
                {...props}
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            )}
          </Field>
          <Field label={t.yearTo} required>
            {(props) => (
              <input
                {...props}
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t.startTime}
            required
            {...(fieldError('localStartTime') ? { error: fieldError('localStartTime') } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="time"
                value={values.start}
                onChange={(event) => setValues((v) => ({ ...v, start: event.target.value }))}
              />
            )}
          </Field>
          <Field
            label={t.endTime}
            required
            {...(fieldError('localEndTime') ? { error: fieldError('localEndTime') } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="time"
                value={values.end}
                onChange={(event) => setValues((v) => ({ ...v, end: event.target.value }))}
              />
            )}
          </Field>
        </div>
      </Panel>

      {/* §K4b: a copy shows what comes with it as one line, and opens the whole
          form only if the coach wants to change something. */}
      {expanded ? (
        <TrainingFields
          workspace={workspace}
          values={values}
          setValues={setValues}
          fieldError={fieldError}
          notesAreDefault={source === undefined}
        />
      ) : (
        <Panel caption={t.copiedCaption}>
          <p className="text-meta text-ink">{summary}</p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-h-11 items-center self-start text-row font-semibold text-primary"
          >
            {t.editCopied}
          </button>
        </Panel>
      )}

      <Panel>
        {preview.length === 0 ? (
          <p className="text-meta text-muted">{t.previewEmpty}</p>
        ) : (
          <>
            <p className="text-date font-bold text-ink">
              {plural(selected.length, t.previewCount)}
            </p>
            <p className="text-hint text-muted">{t.previewUncheck}</p>
            <ul className="flex flex-col">
              {preview.map((date) => {
                const on = !excluded.has(date)
                return (
                  <li key={date}>
                    <label className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-1 last:border-0">
                      <span className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleDate(date)}
                          className="size-5 accent-primary"
                        />
                        <span
                          className={on ? 'text-row text-ink' : 'text-row text-muted line-through'}
                        >
                          {formatLocalDateShort(date)}
                        </span>
                      </span>
                      {/* The same time on every line, including across a
                          daylight-saving change — which is what the coach
                          should see before saving. */}
                      <span className="nums text-meta text-muted">
                        {values.start}–{values.end}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {overLimit ? (
              <p role="alert" className="text-hint font-semibold text-danger">
                {t.errors.SERIES_TOO_LONG}
              </p>
            ) : (
              <p className="text-hint text-muted">{t.seriesLimit}</p>
            )}
          </>
        )}
        <p className="text-hint text-muted">{t.seriesIndependent}</p>
      </Panel>

      {error ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl flex-col gap-3 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
        {/* The footer counts what will be created, which is what is checked
            (coach/SPEC.md §K4b). Disabling is a courtesy — the server refuses
            an empty or over-long series on its own (principle 5). */}
        <Button
          type="submit"
          size="lg"
          disabled={pending || selected.length === 0 || overLimit}
          {...(pending ? { loadingLabel: t.saving } : {})}
        >
          {selected.length === 0 ? t.createSeries : plural(selected.length, t.createSeriesCount)}
        </Button>
      </div>
    </form>
  )
}

/** The ISO weekday (Mon = 1 … Sun = 7) of a `YYYY-MM-DD` key. */
function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}
