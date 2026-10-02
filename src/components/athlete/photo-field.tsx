'use client'

import Image from 'next/image'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { messages } from '@/lib/i18n'
import { isHeic, MAX_PHOTO_BYTES, PICKER_ACCEPT } from '@/lib/domain/photo'
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
  const [converting, setConverting] = useState(false)
  const [pending, startTransition] = useTransition()
  const busy = pending || converting

  function send(file: File) {
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

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)

    // DR-13. Not a HEIC: the server has always been the judge of these, and it
    // still is — nothing here duplicates its checks.
    if (!isHeic(file)) {
      send(file)
      return
    }

    // The limit is about the file the parent picked, so it is applied before the
    // conversion rather than to whatever the conversion produces (§G9).
    if (file.size > MAX_PHOTO_BYTES) {
      if (inputRef.current) inputRef.current.value = ''
      setError(t.errors.PHOTO_TOO_LARGE)
      return
    }

    setConverting(true)
    try {
      const { heicToJpeg } = await import('@/lib/photo/heic')
      const jpeg = await heicToJpeg(file)
      setConverting(false)
      send(jpeg)
    } catch {
      setConverting(false)
      if (inputRef.current) inputRef.current.value = ''
      // A file named `.heic` that is not one lands here too, which is the right
      // answer for it: the parent is told to pick a JPG.
      setError(t.errors.PHOTO_CONVERT_FAILED)
    }
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
      <span className="relative flex shrink-0">
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

        {/* §G9: the wait sits on the photograph, because that is the thing that
            is about to change. */}
        {converting ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-full bg-ink/40"
          >
            <svg viewBox="0 0 24 24" className="size-6 animate-spin text-white" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".3" />
              <path
                d="M21 12a9 9 0 00-9-9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
        ) : null}
      </span>

      <div className="flex min-w-0 flex-col items-start gap-1">
        <span className="flex items-baseline gap-2">
          <label className="flex min-h-11 cursor-pointer items-center text-row font-semibold text-primary">
            {converting ? t.photoConverting : photoUrl ? t.photoReplace : t.photoAdd}
            <input
              ref={inputRef}
              type="file"
              name="photo"
              accept={PICKER_ACCEPT}
              disabled={busy}
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
            disabled={busy}
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
