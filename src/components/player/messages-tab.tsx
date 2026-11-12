'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { COACH_NOTE_LIMIT, PARENT_MESSAGE_LIMIT } from '@/lib/domain/booking-notes'
import { formatDateShort, formatDateTime, formatTimeRange } from '@/lib/time/workspace-time'
import { sendParentMessage, setCoachNote } from '@/server/roster/actions'
import { BubbleIcon, LockIcon } from '@/components/roster/roster-list'
import { Button } from '@/components/ui/button'
import { TextareaWithCounter } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import type { CardSession } from '@/components/player/trainings-tab'

const t = messages.coach.card

const PAGE = 10

/**
 * K13 · Zprávy (decision 43): per training, the coach's note — staff only,
 * decision 35 — and the message to the parents, which they read in the app
 * and receive as E09 (decision 36). Every booking of the athlete, newest
 * first, so a message can go before a training as well as after it.
 */
export function MessagesTab({ sessions, timezone }: { sessions: CardSession[]; timezone: string }) {
  const [shown, setShown] = useState(PAGE)
  const ordered = [...sessions].sort((a, b) => b.startAt.localeCompare(a.startAt))

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-hint text-muted">{t.messagesIntro}</p>
      {ordered.length === 0 ? (
        <p className="text-meta text-muted">{t.messagesNone}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordered.slice(0, shown).map((session) => (
            <SessionMessages key={session.bookingId} session={session} timezone={timezone} />
          ))}
        </ul>
      )}
      {ordered.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((count) => count + PAGE)}
          className="flex min-h-11 items-center self-start text-row font-bold text-primary"
        >
          {t.showMore.replace('{count}', String(ordered.length - shown))}
        </button>
      ) : null}
    </div>
  )
}

function SessionMessages({ session, timezone }: { session: CardSession; timezone: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<'note' | 'message' | null>(null)
  const [draft, setDraft] = useState('')
  const start = new Date(session.startAt)

  function open(which: 'note' | 'message') {
    setDraft((which === 'note' ? session.coachNote : session.parentMessage) ?? '')
    setEditing(which)
  }

  function save() {
    const which = editing
    startTransition(async () => {
      const result =
        which === 'note'
          ? await setCoachNote(session.sessionId, session.bookingId, draft)
          : await sendParentMessage(session.sessionId, session.bookingId, draft)
      if (!result.ok) {
        const table = messages.coach.errors as Record<string, string>
        toast(table[result.code] ?? messages.coach.errors.generic)
        return
      }
      if (which === 'message') toast(messages.coach.messageSentToast)
      // Only the editor that was saved closes: the coach may have opened the
      // other one while this was on its way.
      setEditing((current) => (current === which ? null : current))
      router.refresh()
    })
  }

  const editor = (which: 'note' | 'message') => (
    <div className="flex flex-col gap-2">
      <TextareaWithCounter
        value={draft}
        onChange={setDraft}
        maxLength={which === 'note' ? COACH_NOTE_LIMIT : PARENT_MESSAGE_LIMIT}
        rows={3}
        autoFocus
        aria-label={which === 'note' ? t.noteCaption : t.writeMessage}
        placeholder={which === 'note' ? t.notePlaceholder : t.messagePlaceholder}
      />
      {which === 'message' ? <p className="text-hint text-muted">{t.messageHelper}</p> : null}
      <div className="flex gap-2">
        <Button
          onClick={save}
          disabled={which === 'message' && draft.trim() === ''}
          {...(pending ? { loadingLabel: messages.coach.saving } : {})}
        >
          {which === 'note' ? t.save : t.send}
        </Button>
        <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
          {messages.common.cancel}
        </Button>
      </div>
    </div>
  )

  return (
    <li className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
      <h2 className="nums text-[0.9375rem]/[1.25rem] font-bold text-ink">
        {formatDateShort(start, timezone)} ·{' '}
        {formatTimeRange(start, new Date(session.endAt), timezone)}
      </h2>

      {editing === 'note' ? (
        editor('note')
      ) : session.coachNote ? (
        <Block
          tone="internal"
          icon={<LockIcon className="mt-0.5 size-3.5" />}
          caption={t.noteCaption}
          text={session.coachNote}
          {...(session.editable ? { onEdit: () => open('note') } : {})}
        />
      ) : session.editable ? (
        <AddLink tone="internal" icon={<LockIcon />} onClick={() => open('note')}>
          {t.addNote}
        </AddLink>
      ) : null}

      {editing === 'message' ? (
        editor('message')
      ) : session.parentMessage && session.parentMessageSentAt ? (
        <Block
          tone="primary"
          icon={<BubbleIcon className="mt-0.5 size-3.5" />}
          caption={t.messageCaption.replace(
            '{when}',
            formatDateTime(new Date(session.parentMessageSentAt), timezone),
          )}
          text={session.parentMessage}
          {...(session.editable ? { onEdit: () => open('message') } : {})}
        />
      ) : session.editable ? (
        <AddLink tone="primary" icon={<BubbleIcon />} onClick={() => open('message')}>
          {t.writeMessage}
        </AddLink>
      ) : null}
    </li>
  )
}

function Block({
  tone,
  icon,
  caption,
  text,
  onEdit,
}: {
  tone: 'internal' | 'primary'
  icon: React.ReactNode
  caption: string
  text: string
  /** Editing a sent message sends it again (E09). */
  onEdit?: () => void
}) {
  return (
    <div
      className={`flex gap-2 rounded-[12px] px-3 py-2.5 ${tone === 'internal' ? 'bg-internal' : 'bg-primary-100'}`}
    >
      <span className={tone === 'internal' ? 'text-internal-ink' : 'text-primary'}>{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={`text-hint font-bold ${tone === 'internal' ? 'text-internal-ink' : 'text-primary'}`}
        >
          {caption}
        </span>
        <p className="whitespace-pre-line text-meta text-ink">{text}</p>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className={`flex min-h-9 items-center self-start text-hint font-bold ${tone === 'internal' ? 'text-internal-ink' : 'text-primary'}`}
          >
            {t.edit}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function AddLink({
  tone,
  icon,
  onClick,
  children,
}: {
  tone: 'internal' | 'primary'
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center gap-1.5 self-start text-row font-bold ${tone === 'internal' ? 'text-internal-ink' : 'text-primary'}`}
    >
      {icon}
      {children}
    </button>
  )
}
