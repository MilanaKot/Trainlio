'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import {
  HOCKEY_POSITIONS,
  HOCKEY_POSITION_LABELS,
  STICK_SIDES,
  STICK_SIDE_LABELS,
} from '@/lib/enums/hockey'
import { createAthlete, updateAthlete } from '@/server/athletes/actions'
import type { GuardianAthlete } from '@/server/athletes/queries'

type Props = {
  workspaceId: string
  workspaceName: string
  timezone: string
  athlete?: GuardianAthlete | undefined
}

const t = messages.athlete

function errorText(code: string | undefined): string {
  if (!code) return t.errors.generic
  const table = t.errors as Record<string, string>
  return table[code] ?? t.errors.generic
}

/**
 * Create and edit share one form: the fields are identical, and a parent adding
 * a second child should meet exactly the screen they already know.
 *
 * Both selects are built from the enum codes (AC-013, AC-014), so the options a
 * parent can pick are the values the database accepts — the Czech labels exist
 * only in the label map.
 */
export function AthleteForm({ workspaceId, workspaceName, timezone, athlete }: Props) {
  const router = useRouter()
  const isEdit = Boolean(athlete)
  const hockey = athlete?.sportProfiles.find((p) => p.sportCode === 'HOCKEY')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setFieldErrors({})
    setFormError(null)

    startTransition(async () => {
      const result = athlete
        ? await updateAthlete(athlete.id, workspaceId, timezone, form)
        : await createAthlete(workspaceId, timezone, form)

      if (result.ok) {
        router.push('/moji-sportovci')
        router.refresh()
        return
      }

      if (result.code === 'VALIDATION' && result.fieldErrors) {
        setFieldErrors(result.fieldErrors)
        return
      }
      setFormError(errorText(result.code))
    })
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

  const inputClass =
    'min-h-11 rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20'

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          {t.coreSection}
        </legend>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.firstName}
          <input
            name="firstName"
            required
            autoComplete="off"
            maxLength={100}
            defaultValue={athlete?.firstName ?? ''}
            className={inputClass}
          />
          {fieldError('firstName')}
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.lastName}
          <input
            name="lastName"
            required
            autoComplete="off"
            maxLength={100}
            defaultValue={athlete?.lastName ?? ''}
            className={inputClass}
          />
          {fieldError('lastName')}
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.dateOfBirth}
          {/* AC-011: a full date, never just a birth year. Eligibility is
              derived from it server-side. */}
          <input
            name="dateOfBirth"
            type="date"
            required
            defaultValue={athlete?.dateOfBirth ?? ''}
            className={inputClass}
          />
          {fieldError('dateOfBirth')}
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          {t.hockeySection}
        </legend>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.position}
          <select
            name="position"
            required
            defaultValue={hockey?.position ?? ''}
            className={inputClass}
          >
            <option value="" disabled>
              —
            </option>
            {HOCKEY_POSITIONS.map((position) => (
              <option key={position} value={position}>
                {HOCKEY_POSITION_LABELS[position]}
              </option>
            ))}
          </select>
          {fieldError('position')}
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.stickSide}
          <select
            name="stickSide"
            required
            defaultValue={hockey?.stickSide ?? ''}
            className={inputClass}
          >
            <option value="" disabled>
              —
            </option>
            {STICK_SIDES.map((side) => (
              <option key={side} value={side}>
                {STICK_SIDE_LABELS[side]}
              </option>
            ))}
          </select>
          {fieldError('stickSide')}
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.club} <span className="font-normal opacity-60">({t.optional})</span>
          <input name="clubName" defaultValue={hockey?.clubName ?? ''} className={inputClass} />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.team} <span className="font-normal opacity-60">({t.optional})</span>
          <input
            name="teamOrCategory"
            defaultValue={hockey?.teamOrCategory ?? ''}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm font-medium">
          {t.jerseyNumber} <span className="font-normal opacity-60">({t.optional})</span>
          <input
            name="jerseyNumber"
            inputMode="numeric"
            maxLength={10}
            defaultValue={hockey?.jerseyNumber ?? ''}
            className={inputClass}
          />
          {fieldError('jerseyNumber')}
        </label>
      </fieldset>

      {/* D-10: registering makes the child visible to that workspace's coaches.
          Said before submitting, not buried in a privacy policy. */}
      {!isEdit ? (
        <p className="rounded-lg bg-black/5 p-3 text-sm leading-relaxed dark:bg-white/10">
          {t.workspaceNotice} <span className="font-medium">{workspaceName}</span>
        </p>
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
        {pending ? t.saving : t.save}
      </button>
    </form>
  )
}
