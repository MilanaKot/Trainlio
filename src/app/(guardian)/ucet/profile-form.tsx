'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { formatPhone } from '@/lib/domain/phone'
import { updateOwnProfile } from '@/server/auth/actions'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'

/**
 * Your own details, in the parts the schema stores.
 *
 * A surname is optional here, deliberately: a parent may be "Jana" on a roster
 * if that is how they want to be known. So is the telephone number — and the
 * hint under it says who reads it and why, because that is the only basis on
 * which someone can decide to give it (DESIGN_BRIEF decision 18).
 */
export function ProfileForm({
  firstName,
  lastName,
  phone,
}: {
  firstName: string
  lastName: string
  phone: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [first, setFirst] = useState(firstName)
  const [last, setLast] = useState(lastName)
  // Shown grouped, stored in E.164: a run of twelve digits is unreadable, and
  // what the parent sees should be what they would write down.
  const [tel, setTel] = useState(phone === '' ? '' : formatPhone(phone))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await updateOwnProfile(first, last, tel)
      if (!result.ok) {
        setError(result.message)
        return
      }
      toast(messages.account.saved)
      router.push('/ucet')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">
        <Field label={messages.account.firstName} required>
          {(props) => (
            <input
              {...props}
              type="text"
              name="firstName"
              autoComplete="given-name"
              maxLength={100}
              value={first}
              onChange={(event) => setFirst(event.target.value)}
            />
          )}
        </Field>

        {/* Optional, deliberately: a parent may be "Jana" on a roster if that
            is how they want to be known. A surname alone is refused, because
            `Přihlásil Nováková` is a form rather than a person. */}
        <Field label={messages.account.lastName} optional hint={messages.account.nameHint}>
          {(props) => (
            <input
              {...props}
              type="text"
              name="lastName"
              autoComplete="family-name"
              maxLength={100}
              value={last}
              onChange={(event) => setLast(event.target.value)}
            />
          )}
        </Field>

        {/* The hint says who reads it and why, because that is the only basis
            on which somebody can decide to give it (decision 18). */}
        <Field label={messages.account.phone} optional hint={messages.account.phoneHint}>
          {(props) => (
            <input
              {...props}
              type="tel"
              name="phone"
              inputMode="tel"
              autoComplete="tel"
              placeholder={messages.account.phonePlaceholder}
              value={tel}
              onChange={(event) => setTel(event.target.value)}
            />
          )}
        </Field>
      </div>

      {error ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md flex-col gap-3 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
        <Button
          type="submit"
          size="lg"
          {...(pending ? { loadingLabel: messages.account.saving } : {})}
        >
          {messages.account.save}
        </Button>
      </div>
    </form>
  )
}
