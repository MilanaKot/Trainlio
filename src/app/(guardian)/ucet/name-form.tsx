'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { updateOwnName } from '@/server/auth/actions'

/**
 * Your own name, in the two parts the schema stores (migration 21).
 *
 * A surname is optional here, deliberately: a parent may be "Jana" on a roster
 * if that is how they want to be known. A coach's name is not optional, but a
 * coach's name is set on the team screen, not this one.
 */
export function NameForm({ firstName, lastName }: { firstName: string; lastName: string }) {
  const router = useRouter()
  const [first, setFirst] = useState(firstName)
  const [last, setLast] = useState(lastName)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    startTransition(async () => {
      const result = await updateOwnName(first, last)
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
