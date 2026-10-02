'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { OrgLogo } from '@/components/ui/org-logo'
import { formatPhone, normalisePhone } from '@/lib/domain/phone'
import { messages, plural } from '@/lib/i18n'
import { completeWelcome } from '@/server/staff/actions'
import type { Organization } from '@/lib/domain/org'

const t = messages.coach

/**
 * §K0. One screen, one decision: is this you, and how do parents reach you.
 *
 * The number is optional and asked for here because this is the one moment a
 * coach is not in a hurry — and the helper says exactly where a parent will
 * meet it, which is the only place they ever do (§G6d, decision 28).
 */
export function WelcomeForm({
  organization,
  organizationName,
  name,
  firstName,
  lastName,
  sessions,
  adminName,
  phone,
}: {
  organization: Organization
  organizationName: string
  name: string
  firstName: string
  lastName?: string
  sessions: number
  adminName?: string
  phone: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(phone ? formatPhone(phone) : '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startSaving] = useTransition()

  function onContinue() {
    const typed = normalisePhone(value)
    if (!typed.ok) {
      setError(messages.staff.errors.PHONE_MALFORMED)
      return
    }

    setError(null)
    startSaving(async () => {
      const result = await completeWelcome(typed.value ?? '')
      if (!result.ok) {
        setError(messages.staff.errors.generic)
        return
      }
      router.replace('/trener')
      router.refresh()
    })
  }

  return (
    <main className="flex flex-col gap-6">
      <OrgLogo org={organization} size={72} />

      <div className="flex flex-col gap-2">
        <h1 className="font-display text-page font-bold text-ink">{t.welcomeTitle}</h1>
        <p className="text-body text-ink">{t.welcomeBody.replace('{org}', organizationName)}</p>
      </div>

      <section className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
        <Avatar firstName={firstName} {...(lastName ? { lastName } : {})} size={44} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-row font-bold text-ink">{name}</span>
          <span className="text-meta text-muted">
            {sessions === 0 ? t.welcomeRole : plural(sessions, t.welcomeSessions)}
          </span>
        </span>
      </section>

      {adminName ? (
        <p className="text-hint text-muted">{t.welcomeWrongName.replace('{admin}', adminName)}</p>
      ) : null}

      <Field
        label={t.welcomePhone}
        optional
        hint={t.welcomePhoneHint}
        {...(error ? { error } : {})}
      >
        {(props) => (
          <input
            {...props}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={value}
            maxLength={24}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
      </Field>

      <Button size="lg" onClick={onContinue} {...(pending ? { loadingLabel: t.saving } : {})}>
        {t.welcomeContinue}
      </Button>
    </main>
  )
}
