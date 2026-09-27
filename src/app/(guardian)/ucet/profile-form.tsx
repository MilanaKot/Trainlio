'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { formatPhone } from '@/lib/domain/phone'
import { updateOwnProfile } from '@/server/auth/actions'

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
  const [first, setFirst] = useState(firstName)
  const [last, setLast] = useState(lastName)
  // Shown grouped, stored in E.164: a run of twelve digits is unreadable, and
  // what the parent sees should be what they would write down.
  const [tel, setTel] = useState(phone === '' ? '' : formatPhone(phone))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    startTransition(async () => {
      const result = await updateOwnProfile(first, last, tel)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  const field = 'rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20'

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.firstName}
        <input
          name="firstName"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          maxLength={100}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.lastName}
        <input
          name="lastName"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          maxLength={100}
          className={field}
        />
      </label>

      <span className="text-xs opacity-60">{messages.account.nameHint}</span>

      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.phone}
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          placeholder={messages.account.phonePlaceholder}
          maxLength={24}
          className={field}
        />
        <span className="text-xs font-normal opacity-60">{messages.account.phoneHint}</span>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm opacity-70">{messages.athlete.saved}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 self-start rounded-lg border border-black/15 px-4 text-sm font-medium disabled:opacity-60 dark:border-white/20"
      >
        {pending ? messages.athlete.saving : messages.athlete.save}
      </button>
    </form>
  )
}
