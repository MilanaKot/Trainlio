'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { HOCKEY_POSITION_LABELS, type HockeyPosition } from '@/lib/enums/hockey'
import { matchesName } from '@/lib/domain/roster'
import { addAthletesToSession } from '@/server/roster/actions'
import { Avatar } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { CapacityMeter } from '@/components/ui/capacity-meter'
import { ConfirmDialog } from '@/components/ui/dialog'
import { PickerRow } from '@/components/ui/picker-row'
import { SearchField } from '@/components/ui/search-field'
import { useToast } from '@/components/ui/toast'
import type { CandidateAthlete } from '@/server/roster/queries'

const t = messages.coach

/**
 * Adding an athlete by hand (coach/SPEC.md §K7, §K7b).
 *
 * The list is the server's own verdict on who may be added, filtered by name
 * on the client only. Search is a convenience; eligibility is not.
 *
 * Over capacity is allowed (BR-033) and therefore asked rather than refused —
 * but the dialog states the consequence, because the number the coach set is
 * not the number the training will have. The confirmation is not what enforces
 * it either: without the flag the domain function refuses and returns the
 * counts, so a client that skipped this dialog would simply be told no.
 */
export function AddAthleteSheet({
  sessionId,
  sessionLabel,
  candidates,
  capacity,
  confirmedCount,
  onClose,
}: {
  sessionId: string
  sessionLabel: string
  candidates: CandidateAthlete[]
  capacity: number
  confirmedCount: number
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [override, setOverride] = useState<{ confirmed: number; capacity: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const addable = useMemo(() => candidates.filter((c) => c.canAdd), [candidates])
  const shown = useMemo(
    () => addable.filter((c) => matchesName(`${c.firstName} ${c.lastName}`, query)),
    [addable, query],
  )
  // §6.13 (v3): somebody already ticked stays on screen, even once the query
  // has stopped matching them — otherwise a coach adding three children loses
  // two of them to the next keystroke.
  const pinned = useMemo(() => {
    if (query.trim() === '') return []
    const matched = new Set(shown.map((c) => c.athleteId))
    return addable.filter((c) => selected.includes(c.athleteId) && !matched.has(c.athleteId))
  }, [addable, shown, selected, query])

  function toggle(athleteId: string) {
    setError(null)
    setSelected((current) =>
      current.includes(athleteId)
        ? current.filter((id) => id !== athleteId)
        : [...current, athleteId],
    )
  }

  function submit(confirmOverCapacity: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await addAthletesToSession(sessionId, selected, confirmOverCapacity)

      if (result.ok) {
        setOverride(null)
        onClose()
        toast(t.added)
        router.refresh()
        return
      }

      // Whatever went in stays in (D-05), so the selection shrinks to what is
      // still being asked about and the dialog speaks about those.
      setSelected(result.remaining)

      if (result.code === 'WOULD_EXCEED_CAPACITY') {
        // The numbers come from the server's refusal, so the dialog never
        // states a figure the client guessed.
        setOverride({
          confirmed: result.confirmedCount ?? confirmedCount,
          capacity: result.capacity ?? capacity,
        })
        return
      }

      const table = t.errors as Record<string, string>
      setError(table[result.code] ?? t.errors.generic)
      if (result.added > 0) router.refresh()
    })
  }

  return (
    <>
      <BottomSheet
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title={t.addAthleteTitle}
        tall
        footer={
          <Button
            size="lg"
            disabled={selected.length === 0 || pending}
            {...(pending ? { loadingLabel: t.adding } : {})}
            onClick={() => submit(false)}
          >
            {plural(selected.length || 1, t.addCount)}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-control-lg bg-bg p-3">
            <span className="text-meta font-semibold text-ink">{sessionLabel}</span>
            <CapacityMeter booked={confirmedCount} capacity={capacity} registrationOpen size="sm" />
          </div>

          {/* §6.13/§6.27: the sheet's own search, filled rather than outlined —
              an outline inside a white sheet fights the panel it sits in. */}
          <SearchField
            value={query}
            onChange={setQuery}
            label={t.searchPlaceholder}
            variant="fill"
          />

          <p className="text-hint text-muted">{t.addAthleteHint}</p>

          {error ? (
            <p role="alert" className="text-hint text-danger">
              {error}
            </p>
          ) : null}

          {pinned.length > 0 ? (
            <>
              <h3 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
                {messages.coach.pickerChosen}
              </h3>
              <ul className="flex flex-col gap-2">
                {pinned.map((candidate) => (
                  <li key={candidate.athleteId}>
                    <PickerRow
                      checked
                      onChange={() => toggle(candidate.athleteId)}
                      leading={
                        <Avatar
                          firstName={candidate.firstName}
                          lastName={candidate.lastName}
                          size={36}
                        />
                      }
                      title={`${candidate.firstName} ${candidate.lastName}`}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {addable.length === 0 ? (
            <p className="text-meta text-muted">{t.addAthleteEmpty}</p>
          ) : shown.length === 0 ? (
            <p className="text-meta text-muted">{t.addAthleteNoMatch}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((candidate) => (
                <li key={candidate.athleteId}>
                  <PickerRow
                    checked={selected.includes(candidate.athleteId)}
                    onChange={() => toggle(candidate.athleteId)}
                    leading={
                      <Avatar
                        firstName={candidate.firstName}
                        lastName={candidate.lastName}
                        size={36}
                      />
                    }
                    title={`${candidate.firstName} ${candidate.lastName}`}
                    meta={[
                      candidate.birthYear,
                      candidate.positionCode
                        ? HOCKEY_POSITION_LABELS[candidate.positionCode as HockeyPosition]
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={override !== null}
        onOpenChange={(open) => (open ? undefined : setOverride(null))}
        title={t.overCapacityTitle}
        description={t.overCapacityQuestion}
        tone="warning"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.overCapacityConfirm}
        onConfirm={() => submit(true)}
        pending={pending}
      >
        <p className="text-meta text-muted">
          {t.overCapacityHelp.replace(
            '{total}',
            String((override?.confirmed ?? confirmedCount) + selected.length),
          )}
        </p>
      </ConfirmDialog>
    </>
  )
}
