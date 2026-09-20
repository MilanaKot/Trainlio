'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { updateDisplayName } from '@/server/auth/actions'

export function DisplayNameForm({ displayName }: { displayName: string }) {
  const router = useRouter()
  const [value, setValue] = useState(displayName)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    startTransition(async () => {
      const result = await updateDisplayName(value)
      if (!result.ok) {
        setError(messages.athlete.errors.generic)
        return
      }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.displayName}
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={100}
          className="rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20"
        />
        <span className="text-xs font-normal opacity-60">
          {messages.account.displayNameHint}
        </span>
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
