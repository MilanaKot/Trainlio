'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { formatDateAtTime } from '@/lib/time/workspace-time'
import { inviteGuardian, revokeGuardianInvitation } from '@/server/club/actions'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import type { GuardianInvitation } from '@/server/club/queries'

const t = messages.club

/**
 * G8 · `RODIČE` (PRD §6, migration 50): inviting the other parent to this
 * child, and to any of the family's other children in the same e-mail. The
 * invitation is accepted by signing in with that address; until then it is
 * listed here and can be withdrawn. Built without a design (DR-19).
 */
export function GuardiansSection({
  athleteId,
  athletes,
  invitations,
  timezone,
}: {
  athleteId: string
  /** Every child this parent manages, so one e-mail can cover siblings. */
  athletes: { id: string; name: string }[]
  invitations: GuardianInvitation[]
  timezone: string
}) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [chosen, setChosen] = useState<string[]>([athleteId])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const errorText = (code: string) => {
    const table = t.errors as Record<string, string>
    return table[code] ?? t.errors.generic
  }

  function send() {
    setError(null)
    startTransition(async () => {
      const result = await inviteGuardian(email, chosen)
      if (!result.ok) {
        setError(errorText(result.code))
        return
      }
      setOpen(false)
      setEmail('')
      toast(t.inviteSent)
      router.refresh()
    })
  }

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeGuardianInvitation(id)
      toast(result.ok ? t.revoked : errorText(result.code))
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
        {t.guardiansCaption}
      </h2>

      {invitations.length > 0 ? (
        <ul className="flex flex-col rounded-card bg-surface px-4 shadow-card">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex items-center gap-3 border-b border-line py-3 last:border-0"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-row font-semibold text-ink">{invitation.email}</span>
                <span className="text-hint text-muted">
                  {t.invitedMeta.replace(
                    '{when}',
                    formatDateAtTime(new Date(invitation.createdAt), timezone),
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => revoke(invitation.id)}
                disabled={pending}
                className="flex min-h-11 items-center text-hint font-bold text-danger"
              >
                {t.revoke}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button variant="secondary" size="lg" onClick={() => setOpen(true)}>
        {t.invite}
      </Button>

      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setError(null)
          setOpen(next)
        }}
        title={t.inviteTitle}
        footer={
          <Button
            size="lg"
            onClick={send}
            disabled={email.trim() === '' || chosen.length === 0}
            {...(pending ? { loadingLabel: messages.auth.sending } : {})}
          >
            {t.inviteSend}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-meta text-muted">{t.inviteBody}</p>
          <Field label={t.inviteEmail} {...(error ? { error } : {})}>
            {(props) => (
              <input
                {...props}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </Field>
          {athletes.length > 1 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-meta font-semibold text-ink">{t.inviteAthletes}</legend>
              {athletes.map((athlete) => (
                <label key={athlete.id} className="flex min-h-11 items-center gap-3 text-row">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={chosen.includes(athlete.id)}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, athlete.id]
                          : current.filter((id) => id !== athlete.id),
                      )
                    }
                  />
                  {athlete.name}
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
      </BottomSheet>
    </section>
  )
}
