'use client'

import { useState, useTransition } from 'react'
import { messages } from '@/lib/i18n'
import { joinClub } from '@/server/club/actions'
import { Button } from '@/components/ui/button'

const t = messages.club

/** `Pokračovat` on the club's link: on success the action opens the child form. */
export function JoinButton({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <Button
        size="lg"
        onClick={() =>
          startTransition(async () => {
            const result = await joinClub(code)
            if (!result.ok) {
              const table = t.errors as Record<string, string>
              setError(table[result.code] ?? t.errors.generic)
            }
          })
        }
        {...(pending ? { loadingLabel: messages.auth.sending } : {})}
      >
        {t.landingContinue}
      </Button>
    </div>
  )
}
