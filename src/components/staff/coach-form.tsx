'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages, plural } from '@/lib/i18n'
import { formatPhone, normalisePhone } from '@/lib/domain/phone'
import { formatDateShort, formatTime, DEFAULT_TIMEZONE } from '@/lib/time/workspace-time'
import {
  addCoach,
  inviteCoach,
  setMemberActive,
  setMemberEmail,
  setMemberName,
  setMemberPhone,
  setMemberRole,
} from '@/server/staff/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Notice } from '@/components/ui/notice'
import { AccessStatus } from '@/components/ui/access-status'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import type { StaffMember } from '@/server/staff/queries'

const t = messages.staff

function errorText(code: string | undefined): string {
  const table = t.errors as Record<string, string>
  return table[code ?? ''] ?? t.errors.generic
}

/** `Pozvánka odeslána 4. 10. v 09:12` — one stamp, two sentences (§A3). */
function stamp(template: string, iso: string): string {
  const at = new Date(iso)
  return template
    .replace('{date}', formatDateShort(at, DEFAULT_TIMEZONE))
    .replace('{time}', formatTime(at, DEFAULT_TIMEZONE))
}

function EmailField({
  value,
  onChange,
  error,
  autoFocus = false,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
  autoFocus?: boolean
}) {
  return (
    <Field label={t.email} hint={t.emailHint} {...(error ? { error } : {})}>
      {(props) => (
        <input
          {...props}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          maxLength={160}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}

function PhoneField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error?: string
}) {
  return (
    <Field label={t.phone} optional hint={t.phoneHint} {...(error ? { error } : {})}>
      {(props) => (
        <input
          {...props}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          maxLength={24}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
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
  isLastAdmin = false,
  otherAdminName,
}: {
  workspaceId: string
  member?: StaffMember
  /** §A2 warns — and does not block — on an exact duplicate. */
  existingNames?: string[]
  isSelf?: boolean
  /** §A3d: the role cannot be given away when there is nobody to give it to. */
  isLastAdmin?: boolean
  /** §A3e names who could give it back. */
  otherAdminName?: string
}) {
  const router = useRouter()
  const toast = useToast()

  const [firstName, setFirstName] = useState(member?.firstName ?? '')
  const [lastName, setLastName] = useState(member?.lastName ?? '')
  const [isActive, setIsActive] = useState(member?.isActive ?? true)
  const [isAdmin, setIsAdmin] = useState(member?.roles.includes('WORKSPACE_ADMIN') ?? false)
  const [confirmOwnRole, setConfirmOwnRole] = useState(false)
  const [phone, setPhone] = useState(member?.phone ? formatPhone(member.phone) : '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [errors, setErrors] = useState<{
    firstName?: string
    lastName?: string
    phone?: string
    email?: string
    form?: string
  }>({})
  const [inviting, startInviting] = useTransition()
  const [confirmFuture, setConfirmFuture] = useState<number | null>(null)
  const [pending, startSaving] = useTransition()

  const name = [firstName, lastName].filter(Boolean).join(' ').trim()
  const duplicate =
    member === undefined && name !== '' && existingNames.some((existing) => existing === name)

  function validate(): boolean {
    const next: { firstName?: string; lastName?: string; phone?: string; email?: string } = {}
    if (firstName.trim() === '') next.firstName = t.errors.FIRST_NAME_REQUIRED
    if (lastName.trim() === '') next.lastName = t.errors.LAST_NAME_REQUIRED
    // The same two shapes the column accepts, refused here so the number is
    // rejected under its own field rather than as a failed save (§A3).
    if (!normalisePhone(phone).ok) next.phone = t.errors.PHONE_MALFORMED
    // The address is optional, and recommended: the server holds it to the same
    // shape and decides whether anybody else already has it.
    if (email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      next.email = t.errors.EMAIL_MALFORMED
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function save(confirmFutureSessions = false, confirmOwnRoleRemoval = false) {
    if (!validate()) return

    startSaving(async () => {
      if (!member) {
        const typed = normalisePhone(phone)
        const created = await addCoach(workspaceId, firstName.trim(), lastName.trim(), {
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(typed.ok && typed.value ? { phone: typed.value } : {}),
        })
        if (!created.ok) {
          setErrors(
            created.code === 'EMAIL_TAKEN'
              ? { email: errorText(created.code) }
              : { form: errorText(created.code) },
          )
          return
        }

        // §A2: the invitation is the point of the address, so it goes with the
        // save rather than waiting for somebody to open A3b and ask for it.
        if (email.trim() && created.profileId) {
          const invited = await inviteCoach(workspaceId, created.profileId)
          toast(invited.ok ? t.addedWithInvite : t.added)
        } else {
          toast(t.added)
        }

        router.push('/trener/vice/treneri')
        router.refresh()
        return
      }

      // §A3/§A3e: the role first, before anything else writes.
      //
      // Not an ordering preference: §A3e's confirmation is a refusal from the
      // server, and a save that had already renamed somebody would have
      // revalidated this screen underneath the dialog — resetting the switch
      // the administrator had just moved. Asking before anything has changed
      // also means an administrator who cancels has changed nothing.
      const wasAdmin = member.roles.includes('WORKSPACE_ADMIN')
      if (isAdmin !== wasAdmin) {
        const changed = await setMemberRole(
          workspaceId,
          member.profileId,
          isAdmin,
          confirmOwnRoleRemoval,
        )
        if (!changed.ok) {
          if (changed.code === 'CONFIRM_SELF') {
            setConfirmOwnRole(true)
            return
          }
          setErrors({ form: errorText(changed.code) })
          return
        }
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

      const nextEmail = email.trim()
      if (nextEmail !== (member.email ?? '')) {
        const stored = await setMemberEmail(workspaceId, member.profileId, nextEmail)
        if (!stored.ok) {
          setErrors(
            stored.code === 'EMAIL_TAKEN' || stored.code === 'EMAIL_MALFORMED'
              ? { email: errorText(stored.code) }
              : { form: errorText(stored.code) },
          )
          return
        }

        // §A3c: a new address on a coach who has never signed in is an
        // invitation waiting to happen, and the helper text promised one.
        if (nextEmail && member.access !== 'signed_in') {
          await inviteCoach(workspaceId, member.profileId)
        }
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

      {/* §A2/§A3 PŘÍSTUP DO APLIKACE. The address is what makes a coach able to
          sign in at all, so on A3 it sits under the state it produces. */}
      {member ? (
        <Panel caption={t.accessCaption}>
          <AccessStatus
            access={member.access}
            detail={
              isSelf
                ? t.accessItsYou
                : member.access === 'signed_in'
                  ? member.lastSeenAt
                    ? stamp(t.accessLastSeen, member.lastSeenAt)
                    : undefined
                  : member.access === 'invited'
                    ? member.invitedAt
                      ? stamp(t.accessInvitedAt, member.invitedAt)
                      : undefined
                    : t.accessNoEmailBody
            }
          />
          <EmailField
            value={email}
            onChange={setEmail}
            autoFocus={member.access === 'no_email'}
            {...(errors.email ? { error: errors.email } : {})}
          />

          {/* §A3b: at most once an hour, which the database enforces — this
              button only reports what it answered. */}
          {member.access !== 'signed_in' ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="md"
                disabled={email.trim() === '' || inviting || pending}
                onClick={() =>
                  startInviting(async () => {
                    const result = await inviteCoach(workspaceId, member.profileId)
                    if (result.ok) {
                      toast(t.accessSent)
                      router.refresh()
                    } else {
                      setErrors({ form: errorText(result.code) })
                    }
                  })
                }
              >
                {member.access === 'invited' ? t.accessResend : t.accessSend}
              </Button>
              <p className="text-hint text-muted">{t.accessResendHelper}</p>
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel caption={t.contactCaption}>
        {member ? null : (
          <EmailField
            value={email}
            onChange={setEmail}
            {...(errors.email ? { error: errors.email } : {})}
          />
        )}
        <PhoneField
          value={phone}
          onChange={setPhone}
          {...(errors.phone ? { error: errors.phone } : {})}
        />
      </Panel>

      {/* §A3 ROLE (v3, DR-08). The rules are the server's; this explains them. */}
      {member ? (
        <Panel caption={t.roleCaption}>
          <Switch
            checked={isAdmin}
            onChange={setIsAdmin}
            label={t.adminSwitch}
            hint={t.adminSwitchHint}
            disabled={isLastAdmin}
          />
          {isLastAdmin ? <Notice variant="neutral">{t.lastAdminNotice}</Notice> : null}
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
          {member ? messages.coach.saveChanges : email.trim() ? t.addWithInvite : t.addSubmit}
        </Button>
      </div>

      {/* §A3e: a confirmation rather than a warning, because afterwards this
          screen is gone. */}
      <ConfirmDialog
        open={confirmOwnRole}
        onOpenChange={(open) => (open ? undefined : setConfirmOwnRole(false))}
        title={t.removeOwnAdminTitle}
        tone="warning"
        cancelLabel={t.removeOwnAdminKeep}
        confirmLabel={t.removeOwnAdminConfirm}
        pending={pending}
        onConfirm={() => save(false, true)}
      >
        <p className="text-meta text-muted">
          {t.removeOwnAdminBody.replace('{admin}', otherAdminName ?? t.someoneElse)}
        </p>
      </ConfirmDialog>

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
