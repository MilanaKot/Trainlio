'use client'

import { useMemo, useState } from 'react'
import { messages } from '@/lib/i18n'
import { Chip, AddChip } from '@/components/ui/chip'
import { Field, TextareaWithCounter } from '@/components/ui/field'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Stepper } from '@/components/ui/stepper'
import { CoachPickerSheet } from '@/components/session/coach-picker-sheet'
import type { CoachWorkspace } from '@/server/sessions/queries'

const t = messages.coach

/** Booked athletes, so §K9 can name the ones a narrower range would exclude. */
export type BookedAthlete = { firstName: string; lastName: string; birthYear: number }

/**
 * Everything a training is, apart from when it happens.
 *
 * One training and a season of them are the same thing asked twice: §K3 and
 * §K11 differ in the first panel — a date, or a pattern of weekdays — and
 * agree on the rest. These are the rest, so the two forms cannot drift into
 * offering different halls, different note limits or different coach pickers.
 */
export type SessionFormValues = {
  date: string
  start: string
  end: string
  locationName: string
  facilityId: string
  changingRoom: string
  capacity: number
  eligibilityMode: 'ALL' | 'BIRTH_YEAR_RANGE'
  birthYearFrom: string
  birthYearTo: string
  mainCoachId: string
  assistantIds: string[]
  publicNotes: string
  internalNotes: string
}

export function Panel({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">{caption}</h2>
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">{children}</div>
    </section>
  )
}

/** The years a club's athletes are plausibly born in, newest first. */
export function birthYears(): number[] {
  const thisYear = new Date().getFullYear()
  return Array.from({ length: 25 }, (_, index) => thisYear - index)
}

export function TrainingFields({
  workspace,
  values,
  setValues,
  /** The values as they were, when there is a training to compare against. */
  initial,
  fieldError,
  bookedCount = 0,
  /** Whether the notes panel says its text is a starting point (§K3, create). */
  notesAreDefault = false,
}: {
  workspace: CoachWorkspace
  values: SessionFormValues
  setValues: React.Dispatch<React.SetStateAction<SessionFormValues>>
  initial?: SessionFormValues | undefined
  fieldError: (name: string) => string | undefined
  bookedCount?: number
  notesAreDefault?: boolean
}) {
  const [picker, setPicker] = useState<'main' | 'assistants' | null>(null)

  const set = <K extends keyof SessionFormValues>(key: K, value: SessionFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const locations = useMemo(
    () => [...new Set(workspace.facilities.map((f) => f.locationName))],
    [workspace.facilities],
  )
  const halls = workspace.facilities.filter((f) => f.locationName === values.locationName)
  const coachName = (id: string) =>
    workspace.coaches.find((coach) => coach.id === id)?.displayName ?? t.none

  const was = (key: keyof SessionFormValues) => {
    if (!initial) return undefined
    const before = initial[key]
    if (typeof before !== 'string' || before === values[key]) return undefined
    return before
  }

  return (
    <>
      <Panel caption={t.whereCaption}>
        <Field
          label={t.location}
          {...(was('locationName') ? { previously: was('locationName') } : {})}
        >
          {(props) => (
            <select
              {...props}
              value={values.locationName}
              onChange={(event) => {
                const locationName = event.target.value
                const first = workspace.facilities.find((f) => f.locationName === locationName)
                setValues((current) => ({
                  ...current,
                  locationName,
                  // The hall belongs to the place: keeping the old one would
                  // submit a hall that is somewhere else.
                  facilityId: first?.id ?? '',
                }))
              }}
            >
              {locations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/* The label sits above the control, not inside it (§K3). */}
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">{t.facility}</span>
          <SegmentedControl
            label={t.facility}
            value={values.facilityId}
            onChange={(facilityId) => set('facilityId', facilityId)}
            options={halls.map((hall) => ({
              value: hall.id,
              label: hall.code,
              sublabel: hall.name,
            }))}
          />
          {was('facilityId') ? (
            <p className="text-hint font-semibold text-warning">
              {t.previously.replace(
                '{value}',
                workspace.facilities.find((f) => f.id === initial?.facilityId)?.code ?? t.none,
              )}
            </p>
          ) : null}
        </div>

        <Field
          label={t.changingRoom}
          optional
          className="max-w-[60%]"
          {...(was('changingRoom') ? { previously: was('changingRoom') } : {})}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              value={values.changingRoom}
              maxLength={40}
              onChange={(event) => set('changingRoom', event.target.value)}
            />
          )}
        </Field>
      </Panel>

      <Panel caption={t.whoCaption}>
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink" id="capacity-label">
            {t.capacity}
          </span>
          <Stepper
            label={t.capacity}
            value={values.capacity}
            onChange={(capacity) => set('capacity', capacity)}
            min={1}
            max={99}
          />
          {initial && values.capacity !== initial.capacity ? (
            <p className="text-hint font-semibold text-warning">
              {t.previously.replace('{value}', String(initial.capacity))}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">{t.eligibilityQuestion}</span>
          <SegmentedControl
            label={t.eligibilityQuestion}
            value={values.eligibilityMode}
            onChange={(mode) => set('eligibilityMode', mode)}
            options={[
              { value: 'ALL', label: t.eligibilityAll },
              { value: 'BIRTH_YEAR_RANGE', label: t.eligibilityRange },
            ]}
          />
        </div>

        {values.eligibilityMode === 'BIRTH_YEAR_RANGE' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field
              // `Od ročníku`, not the design's bare `Od`: the series screen has
              // a date range labelled `Od` and `Do` in another panel, and two
              // fields answering to the same word is ambiguous to a screen
              // reader, which cannot see which panel it is in.
              label={t.birthYearFrom}
              {...(fieldError('birthYearFrom') ? { error: fieldError('birthYearFrom') } : {})}
            >
              {(props) => (
                <select
                  {...props}
                  value={values.birthYearFrom}
                  onChange={(event) => set('birthYearFrom', event.target.value)}
                >
                  {birthYears().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label={t.birthYearTo}
              {...(fieldError('birthYearTo') ? { error: fieldError('birthYearTo') } : {})}
            >
              {(props) => (
                <select
                  {...props}
                  value={values.birthYearTo}
                  onChange={(event) => set('birthYearTo', event.target.value)}
                >
                  {birthYears().map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ) : null}
      </Panel>

      <Panel caption={t.coachesCaption}>
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">{t.mainCoach}</span>
          <button
            type="button"
            onClick={() => setPicker('main')}
            className="flex h-btn-block items-center justify-between rounded-control px-4 text-left text-body text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]"
          >
            {coachName(values.mainCoachId)}
            <span aria-hidden="true" className="text-subtle">
              ›
            </span>
          </button>
          {initial && values.mainCoachId !== initial.mainCoachId ? (
            <p className="text-hint font-semibold text-warning">
              {t.previously.replace('{value}', coachName(initial.mainCoachId))}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-meta font-semibold text-ink">{t.assistants}</span>
            <span className="text-hint text-muted">{t.changingRoomOptional}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {values.assistantIds.map((id) => (
              <Chip
                key={id}
                onRemove={() =>
                  set(
                    'assistantIds',
                    values.assistantIds.filter((value) => value !== id),
                  )
                }
                removeLabel={t.removeAssistant.replace('{name}', coachName(id))}
              >
                {coachName(id)}
              </Chip>
            ))}
            <AddChip onClick={() => setPicker('assistants')}>{t.addAssistant}</AddChip>
          </div>
        </div>
      </Panel>

      {/* D-13: two fields, because one is read by parents and one never is. */}
      <Panel caption={t.notesCaption}>
        <div className="flex flex-col gap-2">
          <label htmlFor="public-notes" className="text-meta font-semibold text-ink">
            {t.publicNotesLabel}
          </label>
          <TextareaWithCounter
            id="public-notes"
            value={values.publicNotes}
            onChange={(value) => set('publicNotes', value)}
            maxLength={200}
            rows={3}
          />
          {notesAreDefault ? (
            <p className="text-hint text-muted">{t.publicNotesDefaultHint}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="internal-notes" className="text-meta font-semibold text-ink">
            {t.internalNotesLabel}
          </label>
          <TextareaWithCounter
            id="internal-notes"
            value={values.internalNotes}
            onChange={(value) => set('internalNotes', value)}
            maxLength={200}
            rows={3}
            className="bg-internal shadow-[inset_0_0_0_1.5px_var(--color-internal-border)]"
          />
        </div>
      </Panel>

      {picker ? (
        <CoachPickerSheet
          mode={picker}
          coaches={workspace.coaches}
          mainCoachId={values.mainCoachId}
          assistantIds={values.assistantIds}
          selected={picker === 'main' ? [values.mainCoachId] : values.assistantIds}
          bookedCount={bookedCount}
          onClose={() => setPicker(null)}
          onDone={(ids) => {
            if (picker === 'main') {
              const mainCoachId = ids[0] ?? values.mainCoachId
              setValues((current) => ({
                ...current,
                mainCoachId,
                // A promoted assistant stops being one, as the sheet said.
                assistantIds: current.assistantIds.filter((id) => id !== mainCoachId),
              }))
            } else {
              set(
                'assistantIds',
                ids.filter((id) => id !== values.mainCoachId),
              )
            }
            setPicker(null)
          }}
        />
      ) : null}
    </>
  )
}
