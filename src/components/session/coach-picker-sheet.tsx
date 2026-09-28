'use client'

import { useMemo, useState } from 'react'
import { messages, plural } from '@/lib/i18n'
import { matchesName } from '@/lib/domain/roster'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { PickerRow } from '@/components/ui/picker-row'

const t = messages.coach

export type PickableCoach = { id: string; displayName: string | null }

/** Above this the sheet grows a search field (§K3b). */
const SEARCHABLE_FROM = 8

function MailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 4.5l6 4 6-4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/**
 * Who runs the training (coach/SPEC.md §K3b, §K3c).
 *
 * One component for both, because they differ in one thing — how many may be
 * chosen — and agree on everything that matters: only active coaches, the
 * administrator owns the list, and the consequence of the choice is stated
 * before it is made rather than after.
 *
 * Nothing is saved from here. The sheet hands its answer back to the form,
 * which sends it with everything else, so a coach who closes the form without
 * saving has changed nothing.
 */
export function CoachPickerSheet({
  mode,
  coaches,
  mainCoachId,
  selected,
  assistantIds,
  bookedCount,
  onDone,
  onClose,
}: {
  mode: 'main' | 'assistants'
  coaches: PickableCoach[]
  /** The training's main coach: not an assistant, and shown as such. */
  mainCoachId: string
  /** Assistants for `assistants`, the current main coach for `main`. */
  selected: string[]
  /** The training's assistants, so §K3c can say who would stop being one. */
  assistantIds: string[]
  /** Active bookings, for the notice §K3c shows before the change is made. */
  bookedCount: number
  onDone: (ids: string[]) => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string[]>(selected)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    if (coaches.length < SEARCHABLE_FROM || query.trim() === '') return coaches
    return coaches.filter((coach) => matchesName(coach.displayName ?? '', query))
  }, [coaches, query])

  const picking = mode === 'main'

  function toggle(id: string, checked: boolean) {
    if (picking) {
      setChosen([id])
      return
    }
    setChosen((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    )
  }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={picking ? t.mainCoach : t.assistantsTitle}
      tall={coaches.length > 5}
      footer={
        <Button size="lg" disabled={picking && chosen.length === 0} onClick={() => onDone(chosen)}>
          {picking || chosen.length === 0 ? t.done : plural(chosen.length, t.doneCount)}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-meta text-muted">{picking ? t.mainCoachIntro : t.assistantsIntro}</p>

        {picking && bookedCount > 0 ? (
          <Notice variant="warning" icon={<MailIcon />}>
            {plural(bookedCount, t.mainCoachEmail)}
          </Notice>
        ) : null}

        {coaches.length >= SEARCHABLE_FROM ? (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="h-12 rounded-control-lg bg-neutral-50 px-4 text-body text-ink placeholder:text-muted"
          />
        ) : null}

        <ul className="flex flex-col gap-2">
          {shown.map((coach) => {
            // The main coach is not one of their own assistants, and the domain
            // function says so too: the row is disabled rather than missing, so
            // the coach can see why.
            const isMain = !picking && coach.id === mainCoachId
            // The other direction: promoting an assistant takes them off that
            // list, which is said here rather than discovered afterwards.
            const leavesAssistants = picking && assistantIds.includes(coach.id)
            const meta = isMain
              ? t.assistantsIsMain
              : leavesAssistants
                ? t.mainCoachWasAssistant
                : undefined

            return (
              <li key={coach.id}>
                <PickerRow
                  control={picking ? 'radio' : 'checkbox'}
                  checked={chosen.includes(coach.id)}
                  disabled={isMain}
                  onChange={(checked) => toggle(coach.id, checked)}
                  leading={<Avatar firstName={coach.displayName ?? '?'} size={36} muted={isMain} />}
                  title={coach.displayName ?? t.none}
                  {...(meta ? { meta } : {})}
                />
              </li>
            )
          })}
        </ul>

        <p className="text-hint text-muted">{t.assistantsHint}</p>
      </div>
    </BottomSheet>
  )
}
