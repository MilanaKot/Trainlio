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
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Notice } from '@/components/ui/notice'
import { RadioPills } from '@/components/ui/radio-pills'
import type { GuardianAthlete } from '@/server/athletes/queries'
import type { HockeyPosition, StickSide } from '@/lib/enums/hockey'

type Props = {
  workspaceId: string
  workspaceName: string
  timezone: string
  athlete?: GuardianAthlete | undefined
  /**
   * Asked for only when the parent has no name of their own yet. The coach's
   * roster names whoever booked each child, and a parent who registers without
   * one is a dash where the coach needs a person to call.
   */
  askGuardianDetails?: boolean
}

const t = messages.athlete

function Panel({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {caption ? (
        <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">{caption}</h2>
      ) : null}
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">{children}</div>
    </section>
  )
}

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
export function AthleteForm({
  workspaceId,
  workspaceName,
  timezone,
  athlete,
  askGuardianDetails = false,
}: Props) {
  const router = useRouter()
  const isEdit = Boolean(athlete)
  const hockey = athlete?.sportProfiles.find((p) => p.sportCode === 'HOCKEY')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [position, setPosition] = useState<HockeyPosition | ''>(hockey?.position ?? '')
  const [stickSide, setStickSide] = useState<StickSide | ''>(hockey?.stickSide ?? '')
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

  function fieldError(name: string): string | undefined {
    const code = fieldErrors[name]
    return code ? errorText(code) : undefined
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* First, because it is about the person filling the form in, and
          because guardian/SPEC.md §G16 is where these words come from. */}
      {askGuardianDetails ? (
        <Panel caption={messages.account.yourDetails}>
          <p className="text-meta text-muted">{messages.account.yourDetailsIntro}</p>

          <Field
            label={messages.account.firstName}
            required
            {...(fieldError('guardianFirstName') ? { error: fieldError('guardianFirstName') } : {})}
          >
            {(props) => <input {...props} name="guardianFirstName" type="text" required />}
          </Field>

          <Field label={messages.account.lastName} optional>
            {(props) => <input {...props} name="guardianLastName" type="text" />}
          </Field>

          <Field
            label={messages.account.phone}
            optional
            hint={messages.account.phoneHint}
            {...(fieldError('guardianPhone') ? { error: fieldError('guardianPhone') } : {})}
          >
            {(props) => (
              <input
                {...props}
                name="guardianPhone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={messages.account.phonePlaceholder}
              />
            )}
          </Field>
        </Panel>
      ) : null}

      <Panel>
        <Field
          label={t.firstName}
          required
          {...(fieldError('firstName') ? { error: fieldError('firstName') } : {})}
        >
          {(props) => (
            <input
              {...props}
              name="firstName"
              type="text"
              required
              autoComplete="off"
              maxLength={100}
              defaultValue={athlete?.firstName ?? ''}
            />
          )}
        </Field>

        <Field
          label={t.lastName}
          required
          {...(fieldError('lastName') ? { error: fieldError('lastName') } : {})}
        >
          {(props) => (
            <input
              {...props}
              name="lastName"
              type="text"
              required
              autoComplete="off"
              maxLength={100}
              defaultValue={athlete?.lastName ?? ''}
            />
          )}
        </Field>

        {/* AC-011: a full date, never just a birth year. Eligibility is derived
            from it server-side. */}
        <Field
          label={t.dateOfBirth}
          required
          {...(fieldError('dateOfBirth') ? { error: fieldError('dateOfBirth') } : {})}
        >
          {(props) => (
            <input
              {...props}
              name="dateOfBirth"
              type="date"
              required
              defaultValue={athlete?.dateOfBirth ?? ''}
            />
          )}
        </Field>
      </Panel>

      <Panel caption={t.hockeySection}>
        <Field label={t.club} optional>
          {(props) => (
            <input
              {...props}
              name="clubName"
              type="text"
              placeholder={t.clubPlaceholder}
              defaultValue={hockey?.clubName ?? ''}
            />
          )}
        </Field>

        <Field label={t.team} optional>
          {(props) => (
            <input
              {...props}
              name="teamOrCategory"
              type="text"
              placeholder={t.teamPlaceholder}
              defaultValue={hockey?.teamOrCategory ?? ''}
            />
          )}
        </Field>

        {/* Pills rather than a select, and no free text: these are the values
            the database accepts (AC-013, AC-014). */}
        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">
            {t.position}
            <span className="text-danger"> *</span>
          </span>
          <RadioPills
            name="position"
            label={t.position}
            value={position}
            onChange={setPosition}
            options={HOCKEY_POSITIONS.map((code) => ({
              value: code,
              label: HOCKEY_POSITION_LABELS[code],
            }))}
          />
          {fieldError('position') ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {fieldError('position')}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">
            {t.stickSide}
            <span className="text-danger"> *</span>
          </span>
          <RadioPills
            name="stickSide"
            label={t.stickSide}
            columns={3}
            value={stickSide}
            onChange={setStickSide}
            options={STICK_SIDES.map((code) => ({ value: code, label: STICK_SIDE_LABELS[code] }))}
          />
          {fieldError('stickSide') ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {fieldError('stickSide')}
            </p>
          ) : null}
        </div>

        <Field
          label={t.jerseyNumber}
          optional
          className="max-w-[50%]"
          {...(fieldError('jerseyNumber') ? { error: fieldError('jerseyNumber') } : {})}
        >
          {(props) => (
            <input
              {...props}
              name="jerseyNumber"
              type="text"
              inputMode="numeric"
              maxLength={10}
              defaultValue={hockey?.jerseyNumber ?? ''}
            />
          )}
        </Field>
      </Panel>

      {/* D-10: registering makes the child visible to that workspace's coaches.
          Said before submitting, not buried in a privacy policy. */}
      {!isEdit ? (
        <Notice variant="info">
          {t.workspaceNotice} <span className="font-semibold">{workspaceName}</span>
        </Notice>
      ) : null}

      {formError ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {formError}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md flex-col gap-3 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
        <Button type="submit" size="lg" {...(pending ? { loadingLabel: t.saving } : {})}>
          {isEdit ? t.save : t.add}
        </Button>
      </div>
    </form>
  )
}
