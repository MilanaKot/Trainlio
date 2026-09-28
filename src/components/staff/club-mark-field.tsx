'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { ALLOWED_LOGO_TYPES } from '@/lib/domain/logo'
import { setWorkspaceLogo } from '@/server/staff/actions'
import { Button } from '@/components/ui/button'
import { ClubMark } from '@/components/ui/club-mark'
import { useToast } from '@/components/ui/toast'

const t = messages.clubMark

/**
 * Uploading the club's mark (migration 29).
 *
 * Offered only to an administrator, and that offer comes from the database
 * rather than from a role this component decided to trust: the storage policy
 * and the domain function both check it again, so a coach who reached this
 * form would simply be refused.
 */
export function ClubMarkField({
  workspaceId,
  workspaceName,
  logoUrl,
  canEdit,
}: {
  workspaceId: string
  workspaceName: string
  logoUrl: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(file: File | null) {
    setError(null)
    startTransition(async () => {
      const result = await setWorkspaceLogo(workspaceId, file)
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        setError(table[result.code] ?? t.errors.generic)
        return
      }
      if (input.current) input.current.value = ''
      toast(file ? t.saved : t.removed)
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <h2 className="text-date font-bold text-ink">{t.title}</h2>
        <p className="text-meta text-muted">{t.intro}</p>
      </div>

      <div className="flex items-center gap-3">
        {logoUrl ? (
          <ClubMark url={logoUrl} name={workspaceName} size={56} />
        ) : (
          <p className="text-meta text-muted">{t.none}</p>
        )}
      </div>

      {canEdit ? (
        <>
          <input
            ref={input}
            type="file"
            accept={ALLOWED_LOGO_TYPES.join(',')}
            aria-label={t.choose}
            className="text-meta file:mr-3 file:min-h-11 file:rounded-control file:border-0 file:bg-primary-100 file:px-4 file:text-row file:font-semibold file:text-primary"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) save(file)
            }}
            disabled={pending}
          />
          <p className="text-hint text-muted">{t.hint}</p>

          {logoUrl ? (
            <Button
              variant="danger-outline"
              onClick={() => save(null)}
              disabled={pending}
              className="self-start"
            >
              {t.remove}
            </Button>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-hint text-danger">
          {error}
        </p>
      ) : null}
    </section>
  )
}
