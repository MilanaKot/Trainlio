'use client'

import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { ALLOWED_PHOTO_TYPES } from '@/lib/domain/photo'
import { removeAthletePhoto, uploadAthletePhoto } from '@/server/athletes/actions'

const t = messages.athlete

/**
 * Photo upload, in its own form.
 *
 * Kept separate from the profile form deliberately: uploading is immediate and
 * irreversible from the parent's point of view, while the rest of the form is
 * draft text they may abandon. Mixing them would mean a half-filled form could
 * not be discarded without also discarding the photograph.
 */
export function PhotoField({
  athleteId,
  photoUrl,
}: {
  athleteId: string
  photoUrl: string | null
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    const form = new FormData()
    form.set('photo', file)

    startTransition(async () => {
      const result = await uploadAthletePhoto(athleteId, form)
      if (inputRef.current) inputRef.current.value = ''
      if (!result.ok) {
        const table = t.errors as Record<string, string>
        setError(table[result.code] ?? t.errors.generic)
        return
      }
      router.refresh()
    })
  }

  function onRemove() {
    setError(null)
    startTransition(async () => {
      const result = await removeAthletePhoto(athleteId)
      if (!result.ok) {
        setError(t.errors.generic)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-3 rounded-card bg-surface p-4 shadow-card">
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt=""
          width={72}
          height={72}
          // Signed URLs are short-lived and host-specific, so Next's optimizer
          // is bypassed: it would cache a URL that expires in an hour.
          unoptimized
          className="size-18 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-18 shrink-0 items-center justify-center rounded-full bg-neutral-50 text-subtle"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-8">
            <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M5 20c0-3.3 3-5.4 7-5.4s7 2.1 7 5.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}

      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="flex items-baseline gap-2">
          <label className="flex min-h-11 cursor-pointer items-center text-row font-semibold text-primary">
            {photoUrl ? t.photoReplace : t.photoAdd}
            <input
              ref={inputRef}
              type="file"
              name="photo"
              accept={ALLOWED_PHOTO_TYPES.join(',')}
              disabled={pending}
              onChange={onPick}
              className="sr-only"
            />
          </label>
          <span className="text-hint text-muted">{t.photoOptional}</span>
        </span>

        {photoUrl ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="flex min-h-11 items-center text-row font-semibold text-danger disabled:text-muted"
          >
            {t.photoRemove}
          </button>
        ) : null}

        <p className="text-hint text-muted">{t.photoHint}</p>
        {error ? (
          <p role="alert" className="text-hint font-semibold text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
