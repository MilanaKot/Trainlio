'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TextareaWithCounter } from '@/components/ui/field'
import { messages } from '@/lib/i18n'
import { saveAthleteNote } from '@/server/roster/actions'

const t = messages.coach

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * What the staff note about an athlete (coach/SPEC.md §K13).
 *
 * The caption says whose eyes it is for, in the panel and not only in a help
 * text, because the one mistake that matters here is writing a message for the
 * parent into a field no parent will ever read (D-13).
 *
 * Edited in place rather than on a screen of its own: it is two sentences, and
 * a coach writing them is standing at the rink with the athlete in front of
 * them.
 */
export function AthleteNote({
  workspaceId,
  athleteId,
  note,
}: {
  workspaceId: string
  athleteId: string
  note: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startSaving] = useTransition()

  function save() {
    setError(null)
    startSaving(async () => {
      const result = await saveAthleteNote(workspaceId, athleteId, draft)
      if (!result.ok) {
        setError(messages.staff.errors.generic)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-2 rounded-card bg-internal p-4 shadow-[inset_0_0_0_1px_var(--color-internal-border)]">
      <h2 className="flex items-center gap-1.5 text-caption font-bold uppercase tracking-[0.05em] text-internal-ink">
        <LockIcon />
        {t.athleteNote}
      </h2>

      {editing ? (
        <div className="flex flex-col gap-3">
          <TextareaWithCounter
            value={draft}
            onChange={setDraft}
            maxLength={200}
            rows={3}
            autoFocus
            placeholder={t.athleteNotePlaceholder}
            aria-label={t.athleteNote}
          />
          {error ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button size="md" onClick={save} {...(pending ? { loadingLabel: t.saving } : {})}>
              {messages.common.save}
            </Button>
            <Button
              size="md"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setDraft(note ?? '')
                setEditing(false)
              }}
            >
              {messages.common.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="whitespace-pre-line text-body text-ink">
            {note ?? <span className="text-muted">{t.athleteNoteEmpty}</span>}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex min-h-11 items-center text-row font-semibold text-primary"
          >
            {t.athleteNoteEdit}
          </button>
        </div>
      )}
    </section>
  )
}
