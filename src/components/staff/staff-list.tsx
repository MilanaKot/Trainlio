'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { addCoach, setMemberActive, setMemberName } from '@/server/staff/actions'
import type { StaffMember } from '@/server/staff/queries'
import type { WorkspaceRole } from '@/types/database'

const t = messages.staff

const FIELD = 'rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20'
const PRIMARY =
  'min-h-12 rounded-lg bg-black px-4 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black'
const SECONDARY = 'min-h-12 rounded-lg border border-black/15 px-4 text-base dark:border-white/20'

function roleLabel(role: WorkspaceRole): string {
  return role === 'WORKSPACE_ADMIN' ? t.roleWORKSPACE_ADMIN : t.roleCOACH
}

function errorLabel(code: string): string {
  return code in t.errors ? t.errors[code as keyof typeof t.errors] : t.errors.generic
}

/**
 * The coaching staff, and — for an administrator — the names guardians read.
 *
 * `isEditable` is the database's answer, not this component's guess, so the
 * controls appear exactly where the write would be accepted. A coach who is not
 * an administrator sees the same list without them, which is the point: a
 * missing coach name is visible to whoever notices it first.
 */
export function StaffList({
  workspaceId,
  staff,
  canAdd,
}: {
  workspaceId: string
  staff: StaffMember[]
  canAdd: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {canAdd ? <AddCoachForm workspaceId={workspaceId} /> : null}

      <ul className="flex flex-col gap-3">
        {staff.map((member) => (
          <li
            key={member.profileId}
            className="rounded-lg border border-black/10 p-4 dark:border-white/15"
          >
            <StaffRow workspaceId={workspaceId} member={member} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AddCoachForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await addCoach(workspaceId, first, last)
      if (!result.ok) {
        setError(errorLabel(result.code))
        return
      }
      setOpen(false)
      setFirst('')
      setLast('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${PRIMARY} self-start`}>
        {t.addCoach}
      </button>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/15"
    >
      <h2 className="font-medium">{t.addCoachTitle}</h2>

      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.firstName}
        <input
          name="firstName"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          maxLength={100}
          className={FIELD}
        />
      </label>

      <label className="flex flex-col gap-2 text-sm font-medium">
        {messages.account.lastName}
        <input
          name="lastName"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          maxLength={100}
          className={FIELD}
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? messages.athlete.saving : messages.common.add}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className={SECONDARY}
        >
          {messages.common.cancel}
        </button>
      </div>
    </form>
  )
}

function StaffRow({ workspaceId, member }: { workspaceId: string; member: StaffMember }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState(member.firstName ?? '')
  const [last, setLast] = useState(member.lastName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await setMemberName(workspaceId, member.profileId, first, last)
      if (!result.ok) {
        setError(errorLabel(result.code))
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  function toggleActive(confirm: boolean) {
    setError(null)

    startTransition(async () => {
      const result = await setMemberActive(workspaceId, member.profileId, !member.isActive, confirm)
      if (!result.ok) {
        // AC-251: the refusal carries the count, so the warning quotes the
        // server rather than a number this component worked out for itself.
        if (result.code === 'LEADS_FUTURE_SESSIONS') {
          setWarning(plural(result.futureSessions ?? 0, t.leadsFutureSessions))
          return
        }
        setError(errorLabel(result.code))
        return
      }
      setWarning(null)
      router.refresh()
    })
  }

  const badges = [
    ...member.roles.map(roleLabel),
    ...(member.isActive ? [] : [t.inactive]),
    ...(member.hasLogin ? [] : [t.neverSignedIn]),
  ].join(' · ')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={member.isActive ? undefined : 'opacity-60'}>
          <p className={member.displayName ? 'font-medium' : 'font-medium text-red-600'}>
            {member.displayName ?? t.noName}
          </p>
          <p className="text-sm opacity-60">{badges}</p>
        </div>

        {member.isEditable && !editing ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-11 rounded-lg border border-black/15 px-4 text-sm font-medium dark:border-white/20"
            >
              {t.editName}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleActive(false)}
              className="min-h-11 rounded-lg border border-black/15 px-4 text-sm disabled:opacity-60 dark:border-white/20"
            >
              {member.isActive ? t.deactivate : t.activate}
            </button>
          </div>
        ) : null}
      </div>

      {warning ? (
        <div className="flex flex-col gap-2 rounded-lg border border-black/15 p-3 dark:border-white/20">
          <p role="alert" className="text-sm">
            {warning}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => toggleActive(true)}
              className={PRIMARY}
            >
              {messages.common.saveAnyway}
            </button>
            <button type="button" onClick={() => setWarning(null)} className={SECONDARY}>
              {messages.common.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {member.isEditable && editing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-sm font-medium">
            {messages.account.firstName}
            <input
              name="firstName"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              maxLength={100}
              className={FIELD}
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium">
            {messages.account.lastName}
            <input
              name="lastName"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              maxLength={100}
              className={FIELD}
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? messages.athlete.saving : messages.common.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setError(null)
                setFirst(member.firstName ?? '')
                setLast(member.lastName ?? '')
              }}
              className={SECONDARY}
            >
              {messages.common.cancel}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
