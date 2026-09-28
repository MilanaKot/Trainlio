'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { weeklyOccurrenceDates, formatLocalDateKey } from '@/lib/time/workspace-time'
import { ISO_WEEKDAYS, MAX_SERIES_OCCURRENCES } from '@/lib/domain/series'
import { createSeries } from '@/server/sessions/actions'
import type { CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

/**
 * Series creation with a live date preview (UI_SPEC, PRD §16, coach/SPEC.md
 * §K4b and §K11).
 *
 * The preview runs the same rule the server does — whole calendar days in the
 * workspace timezone — so what a coach approves is what gets created. It is
 * still only a preview: the generated dates are not submitted. What is
 * submitted is the pattern plus the dates the coach UNCHECKED, so a stale or
 * edited client can decline an occurrence but never conjure one.
 */
export function SeriesForm({ workspace, today }: { workspace: CoachWorkspace; today: string }) {
  const router = useRouter()
  const [byWeekdays, setByWeekdays] = useState<number[]>([7])
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [startTime, setStartTime] = useState('09:00')
  const [mode, setMode] = useState('ALL')
  // Dates the coach unchecked. Kept by date rather than by index, so changing
  // the range does not silently move an exclusion onto a different day.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
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
    const form = new FormData(event.currentTarget)

    startTransition(async () => {
      const result = await createSeries(workspace.id, form)
      if (!result.ok) {
        setError(errorText(result.code))
        return
      }
      router.push('/trener/serie')
      router.refresh()
    })
  }

  // min-h-11 as well as the padding: a date input renders a shorter line box
  // than a text input in Chromium, which left it two pixels under the 44px a
  // thumb needs. Caught by the mobile viewport review, not by reading.
  const input =
    'min-h-11 rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20'
  const label = 'flex flex-col gap-2 text-sm font-medium'

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* Multi-select, 44 px (coach/SPEC.md §K4b). The checked days are posted
          as the pattern; the server normalises and re-derives the dates. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t.repeatEvery}</legend>
        <div className="flex flex-wrap gap-2">
          {ISO_WEEKDAYS.map((day) => {
            const on = byWeekdays.includes(day)
            return (
              <label
                key={day}
                className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-medium ${
                  on
                    ? 'border-black bg-black text-white dark:border-white dark:bg-white dark:text-black'
                    : 'border-black/15 dark:border-white/20'
                }`}
              >
                <input
                  type="checkbox"
                  name="byWeekday"
                  value={day}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          {t.dateFrom}
          <input
            name="localDateFrom"
            type="date"
            required
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={input}
          />
        </label>
        <label className={label}>
          {t.dateTo}
          <input
            name="localDateTo"
            type="date"
            required
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={input}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t.startTime}
          <input
            name="localStartTime"
            type="time"
            required
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className={input}
          />
        </label>
        <label className={label}>
          {t.endTime}
          <input name="localEndTime" type="time" required defaultValue="10:00" className={input} />
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
            defaultValue={10}
            className={input}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          {t.facility}
          <select name="facilityId" required className={input}>
            {workspace.facilities.map((facility) => (
              <option key={facility.id} value={facility.id}>
                {facility.code} — {facility.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t.changingRoom}
          <input name="changingRoom" className={input} />
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
              <input name="birthYearFrom" type="number" min={1900} max={2100} className={input} />
            </label>
            <label className={label}>
              {t.birthYearTo}
              <input name="birthYearTo" type="number" min={1900} max={2100} className={input} />
            </label>
          </div>
        ) : null}
      </fieldset>

      <label className={label}>
        {t.publicNotes} <span className="font-normal opacity-60">— {t.publicNotesHint}</span>
        <textarea name="publicNotes" rows={2} className={input} />
      </label>

      <label className={label}>
        {t.internalNotes} <span className="font-normal opacity-60">— {t.internalNotesHint}</span>
        <textarea name="internalNotes" rows={2} className={input} />
      </label>

      <section className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/15">
        <h2 className="text-sm font-semibold">{t.preview}</h2>
        {preview.length === 0 ? (
          <p className="text-sm opacity-70">{t.previewEmpty}</p>
        ) : (
          <>
            <p className="text-sm">{plural(selected.length, t.previewCount)}</p>
            <p className="text-xs opacity-60">{t.previewUncheck}</p>
            <ul className="flex flex-col gap-1 text-sm tabular-nums">
              {preview.map((date) => {
                const on = !excluded.has(date)
                return (
                  <li key={date}>
                    <label className="flex min-h-11 items-center gap-3">
                      <input type="checkbox" checked={on} onChange={() => toggleDate(date)} />
                      <span className={on ? '' : 'line-through opacity-50'}>
                        {/* A calendar date and the chosen local time. The same
                            time on every line, including across a daylight-saving
                            change — which is what the coach should see before
                            saving. */}
                        {formatLocalDateKey(date)} · {startTime}
                      </span>
                    </label>
                    {/* Only the unchecked dates travel. The server re-derives
                        the pattern and subtracts these, so this list can shrink
                        a series but never extend one. */}
                    {on ? null : <input type="hidden" name="excludedDate" value={date} />}
                  </li>
                )
              })}
            </ul>
            {overLimit ? (
              <p role="alert" className="text-sm text-red-600">
                {t.errors.SERIES_TOO_LONG}
              </p>
            ) : (
              <p className="text-xs opacity-60">{t.seriesLimit}</p>
            )}
          </>
        )}
        <p className="text-xs opacity-60">{t.seriesIndependent}</p>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || selected.length === 0 || overLimit}
        className="min-h-12 rounded-lg bg-black px-4 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {/* The footer counts what will be created, which is what is checked
            (coach/SPEC.md §K4b). Disabling is a courtesy — the server refuses
            an empty or over-long series on its own (principle 5). */}
        {pending
          ? messages.athlete.saving
          : selected.length === 0
            ? t.createSeries
            : plural(selected.length, t.createSeriesCount)}
      </button>
    </form>
  )
}
