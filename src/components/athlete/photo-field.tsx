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
    <div className="flex items-center gap-4">
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt=""
          width={72}
          height={72}
          unoptimized
          className="size-18 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-18 items-center justify-center rounded-full bg-black/5 dark:bg-white/10"
        />
      )}

      <div className="flex flex-col items-start gap-1">
        <label className="min-h-11 cursor-pointer text-sm underline">
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

        {photoUrl ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={pending}
            className="text-sm underline opacity-70"
          >
            {t.photoRemove}
          </button>
        ) : null}

        <p className="text-xs opacity-60">{t.photoHint}</p>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
