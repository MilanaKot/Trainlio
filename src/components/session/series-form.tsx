'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { weeklyOccurrenceDates, formatLocalDateKey } from '@/lib/time/workspace-time'
import { createSeries } from '@/server/sessions/actions'
import type { CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

/**
 * Series creation with a live date preview (UI_SPEC, PRD §16).
 *
 * The preview runs the same rule the server does — whole calendar days in the
 * workspace timezone — so what a coach approves is what gets created. It is
 * still only a preview: the dates are not submitted, because a stale or edited
 * one must not be able to decide what exists.
 */
export function SeriesForm({
  workspace,
  today,
}: {
  workspace: CoachWorkspace
  today: string
}) {
  const router = useRouter()
  const [byWeekday, setByWeekday] = useState('7')
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [startTime, setStartTime] = useState('09:00')
  const [mode, setMode] = useState('ALL')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const preview = useMemo(() => {
    try {
      return weeklyOccurrenceDates(dateFrom, dateTo, Number(byWeekday))
    } catch {
      return []
    }
  }, [dateFrom, dateTo, byWeekday])

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
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t.weekday}
          <select
            name="byWeekday"
            value={byWeekday}
            onChange={(e) => setByWeekday(e.target.value)}
            className={input}
          >
            {(['1', '2', '3', '4', '5', '6', '7'] as const).map((day) => (
              <option key={day} value={day}>
                {t.weekdays[day]}
              </option>
            ))}
          </select>
        </label>
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
            <p className="text-sm">{plural(preview.length, t.previewCount)}</p>
            <ul className="flex flex-col gap-1 text-sm tabular-nums opacity-80">
              {preview.map((date) => (
                <li key={date}>
                  {/* A calendar date and the chosen local time. The same time
                      on every line, including across a daylight-saving change —
                      which is exactly what the coach should see before saving. */}
                  {formatLocalDateKey(date)} · {startTime}
                </li>
              ))}
            </ul>
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
        disabled={pending || preview.length === 0}
        className="min-h-12 rounded-lg bg-black px-4 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {pending ? messages.athlete.saving : t.createSeries}
      </button>
    </form>
  )
}
