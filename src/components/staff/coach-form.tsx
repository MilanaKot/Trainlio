'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { formatPhone, normalisePhone } from '@/lib/domain/phone'
import { addCoach, setMemberActive, setMemberName, setMemberPhone } from '@/server/staff/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Notice } from '@/components/ui/notice'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import type { StaffMember } from '@/server/staff/queries'

const t = messages.staff

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

function Panel({ caption, children }: { caption?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {caption ? (
        <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">{caption}</h2>
      ) : null}
      <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">{children}</div>
    </section>
  )
}

/**
 * Adding a coach and editing one (admin/SPEC.md §A2 and §A3).
 *
 * One component, because they are the same two fields and differ only in what
 * the footer does and whether there is a state to change.
 *
 * Nothing here decides who may write. `set_member_name`, `create_workspace_coach`
 * and `set_member_active` each check the administrator's role themselves, and
 * the last one refuses to switch off the club's last active administrator, or a
 * coach who still leads future trainings unless the call says the warning was
 * shown. This form states those consequences; it does not enforce them.
 */
export function CoachForm({
  workspaceId,
  member,
  existingNames = [],
  isSelf = false,
}: {
  workspaceId: string
  member?: StaffMember
  /** §A2 warns — and does not block — on an exact duplicate. */
  existingNames?: string[]
  isSelf?: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [firstName, setFirstName] = useState(member?.firstName ?? '')
  const [lastName, setLastName] = useState(member?.lastName ?? '')
  const [isActive, setIsActive] = useState(member?.isActive ?? true)
  const [phone, setPhone] = useState(member?.phone ? formatPhone(member.phone) : '')
  const [errors, setErrors] = useState<{
    firstName?: string
    lastName?: string
    phone?: string
    form?: string
  }>({})
  const [confirmFuture, setConfirmFuture] = useState<number | null>(null)
  const [pending, startSaving] = useTransition()

  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  const duplicate =
    member === undefined && name !== '' && existingNames.some((existing) => existing === name)

  function validate(): boolean {
    const next: { firstName?: string; lastName?: string; phone?: string } = {}
    if (firstName.trim() === '') next.firstName = t.errors.FIRST_NAME_REQUIRED
    if (lastName.trim() === '') next.lastName = t.errors.LAST_NAME_REQUIRED
    // The same two shapes the column accepts, refused here so the number is
    // rejected under its own field rather than as a failed save (§A3).
    if (!normalisePhone(phone).ok) next.phone = t.errors.PHONE_MALFORMED
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function save(confirmFutureSessions = false) {
    if (!validate()) return

    startSaving(async () => {
      if (!member) {
        const created = await addCoach(workspaceId, firstName.trim(), lastName.trim())
        if (!created.ok) {
          setErrors({ form: errorText(created.code) })
          return
        }
        toast(t.added)
        router.push('/trener/vice/treneri')
        router.refresh()
        return
      }

      const renamed = await setMemberName(
        workspaceId,
        member.profileId,
        firstName.trim(),
        lastName.trim(),
      )
      if (!renamed.ok) {
        setErrors({ form: errorText(renamed.code) })
        return
      }

      const typedPhone = normalisePhone(phone)
      const nextPhone = typedPhone.ok ? typedPhone.value : null
      if (nextPhone !== (member.phone ?? null)) {
        const stored = await setMemberPhone(workspaceId, member.profileId, nextPhone ?? '')
        if (!stored.ok) {
          setErrors({ form: errorText(stored.code) })
          return
        }
      }

      if (isActive !== member.isActive) {
        const switched = await setMemberActive(
          workspaceId,
          member.profileId,
          isActive,
          confirmFutureSessions,
        )

        if (!switched.ok) {
          // The count comes from the refusal, so the warning never states a
          // number this form made up (AC-251).
          if (switched.code === 'LEADS_FUTURE_SESSIONS') {
            setConfirmFuture(switched.futureSessions ?? member.futureSessions)
            return
          }
          setErrors({ form: errorText(switched.code) })
          return
        }
      }

      setConfirmFuture(null)
      toast(t.saved)
      router.push('/trener/vice/treneri')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-5 pb-36">
      <button
        type="button"
        onClick={() => router.push('/trener/vice/treneri')}
        className="flex min-h-11 items-center self-start text-row font-semibold text-muted"
      >
        {messages.common.cancel}
      </button>

      <h1 className="font-display text-form-title font-bold text-ink">
        {member ? t.editTitle : t.addCoachTitle}
      </h1>

      <Panel>
        <Field
          label={t.firstName}
          required
          {...(errors.firstName ? { error: errors.firstName } : {})}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              value={firstName}
              maxLength={50}
              autoFocus={!member}
              onChange={(event) => setFirstName(event.target.value)}
            />
          )}
        </Field>

        <Field label={t.lastName} required {...(errors.lastName ? { error: errors.lastName } : {})}>
          {(props) => (
            <input
              {...props}
              type="text"
              value={lastName}
              maxLength={50}
              onChange={(event) => setLastName(event.target.value)}
            />
          )}
        </Field>
      </Panel>

      {duplicate ? <Notice variant="warning">{t.duplicateName}</Notice> : null}

      {/* §A3 KONTAKT. On A2 the panel arrives with the e-mail beside it, which
          is what sends the invitation; here the number stands on its own. */}
      {member ? (
        <Panel caption={t.contactCaption}>
          <Field
            label={t.phone}
            optional
            hint={t.phoneHint}
            {...(errors.phone ? { error: errors.phone } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                maxLength={24}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
        </Panel>
      ) : null}

      {member ? (
        <Panel caption={t.stateCaption}>
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label={t.activeSwitch}
            hint={t.activeSwitchHint}
            disabled={isSelf}
            disabledHint={t.cannotDeactivateSelf}
          />

          <p className="rounded-control-lg bg-bg p-3 text-meta text-muted">
            {t.deactivateInfo
              .replace('{name}', member.displayName ?? t.noName)
              .replace('{count}', String(member.futureSessions))}
          </p>

          {/* Stated before the save, not after it: the coach stays on those
              trainings, which is the part an administrator needs to know. */}
          {!isActive && member.isActive && member.futureSessions > 0 ? (
            <Notice variant="warning">
              {plural(member.futureSessions, t.leadsFutureNotice).replace(
                '{name}',
                member.displayName ?? t.noName,
              )}
            </Notice>
          ) : null}
        </Panel>
      ) : (
        <p className="text-hint text-muted">{t.addHelper}</p>
      )}

      {errors.form ? (
        <p role="alert" className="text-hint font-semibold text-danger">
          {errors.form}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl flex-col gap-3 bg-bg/95 px-4 pb-5 pt-3 shadow-[0_-1px_0_var(--color-line)] backdrop-blur">
        <Button
          size="lg"
          onClick={() => save()}
          {...(pending ? { loadingLabel: messages.coach.saving } : {})}
        >
          {member ? messages.coach.saveChanges : t.addSubmit}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmFuture !== null}
        onOpenChange={(open) => (open ? undefined : setConfirmFuture(null))}
        title={t.deactivate}
        tone="warning"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.deactivate}
        pending={pending}
        onConfirm={() => save(true)}
      >
        <p className="text-meta text-muted">{plural(confirmFuture ?? 0, t.leadsFutureSessions)}</p>
      </ConfirmDialog>
    </div>
  )
}
