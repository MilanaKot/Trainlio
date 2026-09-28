'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import {
  ALLOWED_LOGO_TYPES,
  MIN_LOGO_PIXELS,
  checkChosenLogo,
  type LogoRejection,
} from '@/lib/domain/logo'
import type { LogoBackground } from '@/lib/domain/org'
import { saveOrganization } from '@/server/organization/actions'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { OrgLogo } from '@/components/ui/org-logo'
import { useToast } from '@/components/ui/toast'
import { LogoSheet } from '@/components/organization/logo-sheet'

const t = messages.organization

/**
 * The club's name and mark (admin/SPEC.md §A4 / §A4b).
 *
 * Two states of one screen rather than two screens: with a mark, the panel
 * offers to change or remove it; without one, it is a drop zone and the
 * monogram beside it shows what parents see meanwhile. The monogram follows
 * the name as it is typed, which is the whole reason the name and the logo are
 * edited together.
 *
 * Nothing here is authorization. The controls are shown to an administrator
 * because `canEdit` is the database's own predicate, and every write goes
 * through a domain function that asks again.
 */
export function OrganizationForm({
  workspaceId,
  organization,
  canEdit,
}: {
  workspaceId: string
  organization: { name: string; shortName: string | null; logoUrl: string | null }
  canEdit: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const picker = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(organization.name)
  const [shortName, setShortName] = useState(organization.shortName ?? '')
  const [background, setBackground] = useState<LogoBackground>('white')

  /** The file being adjusted, before it has been cropped. */
  const [chosen, setChosen] = useState<File | null>(null)
  /** The cropped 512px PNG, waiting for Uložit. */
  const [pending, setPending] = useState<{ file: File; previewUrl: string } | null>(null)
  const [removed, setRemoved] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState(false)

  const [errors, setErrors] = useState<{ name?: string; shortName?: string; logo?: string }>({})
  const [saving, startSaving] = useTransition()

  const shownLogo = pending?.previewUrl ?? (removed ? null : organization.logoUrl)
  const preview = { name, logoUrl: shownLogo, logoBackground: background }

  function reject(code: LogoRejection) {
    const table = t.errors as Record<string, string>
    setErrors({ logo: table[code] ?? t.errors.generic })
  }

  async function choose(file: File | undefined) {
    if (picker.current) picker.current.value = ''
    if (!file) return
    setErrors({})

    const rejection = checkChosenLogo(file)
    if (rejection) return reject(rejection)

    // The size of the picture, not of the file. Checked before the sheet opens,
    // so a mark too small to draw is refused against the file the person just
    // picked rather than after they have spent a minute framing it. The server
    // checks it again on the cropped result.
    if (file.type !== 'image/svg+xml') {
      const size = await readImageSize(file)
      if (!size) return reject('LOGO_TYPE_NOT_ALLOWED')
      if (size.width < MIN_LOGO_PIXELS || size.height < MIN_LOGO_PIXELS) {
        return reject('LOGO_TOO_SMALL')
      }
    }

    setChosen(file)
  }

  function save() {
    setErrors({})
    startSaving(async () => {
      const result = await saveOrganization({
        workspaceId,
        name,
        shortName,
        logoBackground: background,
        logo: pending?.file ?? null,
        removeLogo: removed && !pending,
      })

      if (result.ok) {
        toast(t.saved)
        router.push('/trener/vice')
        router.refresh()
        return
      }

      const table = t.errors as Record<string, string>
      const message = table[result.code] ?? t.errors.generic
      setErrors({ [result.field ?? 'logo']: message })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
          {t.logoCaption}
        </h2>

        {shownLogo ? (
          <div className="flex items-center gap-4 rounded-card bg-surface p-4 shadow-card">
            <OrgLogo org={preview} size={96} />
            {canEdit ? (
              <div className="flex flex-col items-start gap-2">
                <Button variant="outline" onClick={() => picker.current?.click()}>
                  {t.change}
                </Button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoval(true)}
                  className="flex min-h-11 items-center text-row font-semibold text-danger"
                >
                  {t.remove}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {canEdit ? (
              // The whole zone is the label, so the tap target is the panel
              // rather than a link inside it.
              <label className="flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-card bg-selected-bg p-4 text-center shadow-[inset_0_0_0_2px_var(--color-primary-200)]">
                <span
                  aria-hidden="true"
                  className="flex size-13 items-center justify-center rounded-control-lg bg-primary-100 text-primary"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="size-6">
                    <path
                      d="M12 16V4m0 0L7 9m5-5l5 5M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-body font-bold text-primary">{t.upload}</span>
                <span className="text-hint text-muted">{t.uploadHint}</span>
                <input
                  ref={picker}
                  type="file"
                  accept={ALLOWED_LOGO_TYPES.join(',')}
                  className="sr-only"
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </label>
            ) : null}

            <div className="flex items-center gap-3 rounded-card bg-bg p-3">
              <OrgLogo org={preview} size={44} />
              <p className="text-meta text-muted">{t.monogramNote}</p>
            </div>
          </>
        )}

        {shownLogo && canEdit ? (
          <>
            <p className="text-hint text-muted">{t.changeHint}</p>
            <input
              ref={picker}
              type="file"
              accept={ALLOWED_LOGO_TYPES.join(',')}
              className="sr-only"
              aria-label={t.change}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </>
        ) : null}

        {errors.logo ? (
          <p role="alert" className="text-hint font-semibold text-danger">
            {errors.logo}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-bold uppercase tracking-[0.8px] text-muted">
          {t.nameCaption}
        </h2>
        <div className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-card">
          <Field label={t.name} required {...(errors.name ? { error: errors.name } : {})}>
            {(props) => (
              <input
                {...props}
                type="text"
                value={name}
                maxLength={80}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>

          <Field
            label={t.shortName}
            optional
            hint={t.shortNameHint}
            {...(errors.shortName ? { error: errors.shortName } : {})}
          >
            {(props) => (
              <input
                {...props}
                type="text"
                value={shortName}
                maxLength={24}
                disabled={!canEdit}
                onChange={(event) => setShortName(event.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      {canEdit ? (
        <Button size="lg" onClick={save} {...(saving ? { loadingLabel: t.saving } : {})}>
          {t.save}
        </Button>
      ) : null}

      {chosen ? (
        <LogoSheet
          file={chosen}
          orgName={name}
          background={background}
          onBackgroundChange={setBackground}
          onApply={(file, previewUrl) => {
            setPending({ file, previewUrl })
            setRemoved(false)
            setChosen(null)
          }}
          onChooseAnother={() => {
            setChosen(null)
            picker.current?.click()
          }}
          onClose={() => setChosen(null)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmRemoval}
        onOpenChange={setConfirmRemoval}
        title={t.removeTitle}
        description={t.removeQuestion}
        tone="danger"
        cancelLabel={messages.common.cancel}
        confirmLabel={t.removeConfirm}
        confirmVariant="danger"
        stacked
        onConfirm={() => {
          setPending(null)
          setRemoved(true)
          setConfirmRemoval(false)
        }}
      />
    </div>
  )
}

/** The picture's own dimensions, read from the file the person just picked. */
function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}
