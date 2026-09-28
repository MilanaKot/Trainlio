'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { messages } from '@/lib/i18n'
import {
  MIN_ZOOM,
  MAX_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  sourceRect,
} from '@/lib/domain/crop'
import type { Offset, Size } from '@/lib/domain/crop'
import { STORED_LOGO_PIXELS } from '@/lib/domain/logo'
import type { LogoBackground } from '@/lib/domain/org'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { Button } from '@/components/ui/button'
import { OrgLogo } from '@/components/ui/org-logo'
import { SegmentedControl } from '@/components/ui/segmented-control'

const t = messages.organization

/** The square the sheet crops to, in CSS pixels (§A5). */
const WINDOW = 200

/**
 * Adjusting the mark before it is saved (admin/SPEC.md §A5).
 *
 * The crop happens here, in the browser, and the 512 px PNG it produces is the
 * only thing that ever reaches storage. That is not an optimisation: an SVG is
 * a document that can carry script, and serving one back from our own origin
 * would be a cross-site scripting hole opened by an upload form. Rasterising
 * it here closes it before the file leaves the page, and the bucket takes PNG
 * alone so the rule holds even if this component is bypassed.
 *
 * The arithmetic is in lib/domain/crop.ts and is tested there; what is left
 * here is pointers, which are not.
 */
export function LogoSheet({
  file,
  orgName,
  background,
  onBackgroundChange,
  onApply,
  onChooseAnother,
  onClose,
}: {
  file: File
  orgName: string
  background: LogoBackground
  onBackgroundChange: (background: LogoBackground) => void
  onApply: (logo: File, previewUrl: string) => void
  onChooseAnother: () => void
  onClose: () => void
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 })
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => {
      // An SVG without width and height attributes reports nothing. It is
      // resolution-independent anyway, so it is rasterised at the size we
      // store rather than at a size it never had.
      const width = element.naturalWidth || STORED_LOGO_PIXELS
      const height = element.naturalHeight || STORED_LOGO_PIXELS
      setNatural({ width, height })
      setImage(element)
      const scale = coverScale({ width, height }, WINDOW)
      setOffset(
        clampOffset(
          { x: (WINDOW - width * scale) / 2, y: (WINDOW - height * scale) / 2 },
          { width: width * scale, height: height * scale },
          WINDOW,
        ),
      )
    }
    element.onerror = () => setError(t.errors.LOGO_UNREADABLE)
    element.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const scale = coverScale(natural, WINDOW) * zoom
  const rendered = { width: natural.width * scale, height: natural.height * scale }

  /** The crop, drawn at whatever size the caller needs. */
  const draw = useCallback(
    (size: number): HTMLCanvasElement | null => {
      if (!image || typeof document === 'undefined') return null
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) return null
      const rect = sourceRect(offset, natural, scale, WINDOW)
      context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size)
      return canvas
    },
    [image, natural, offset, scale],
  )

  // The preview is the real crop, small: a parent's screen is what is being
  // previewed, so showing the uncropped file there would be a different
  // picture from the one that gets saved. Derived rather than kept in state —
  // it is a function of the drag and the zoom and of nothing else.
  const preview = useMemo(() => draw(112)?.toDataURL('image/png') ?? null, [draw])

  function move(x: number, y: number) {
    setOffset((current) => clampOffset({ x: current.x + x, y: current.y + y }, rendered, WINDOW))
  }

  function apply() {
    const canvas = draw(STORED_LOGO_PIXELS)
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) {
        setError(t.errors.LOGO_UNREADABLE)
        return
      }
      const cropped = new File([blob], 'logo.png', { type: 'image/png' })
      onApply(cropped, canvas.toDataURL('image/png'))
    }, 'image/png')
  }

  const previewOrg = { name: orgName, logoUrl: preview, logoBackground: background }

  return (
    <BottomSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={t.adjustTitle}
      // The two buttons live in the sheet's footer rather than at the end of
      // its body: the body scrolls, and a primary action that scrolls out of
      // reach on a short screen is one a thumb cannot find.
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={apply} disabled={!image}>
            {t.apply}
          </Button>
          <Button size="lg" variant="outline" onClick={onChooseAnother}>
            {t.chooseAnother}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-hint font-semibold text-danger">
            {error}
          </p>
        ) : null}

        {/* The checkerboard is how transparency is shown; it is decoration and
            is drawn with a gradient rather than an asset. */}
        <div
          className="relative h-[260px] touch-none overflow-hidden rounded-card"
          style={{
            backgroundColor: '#ffffff',
            backgroundImage:
              'linear-gradient(45deg, #eceff5 25%, transparent 25%, transparent 75%, #eceff5 75%), linear-gradient(45deg, #eceff5 25%, transparent 25%, transparent 75%, #eceff5 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 8px 8px',
          }}
          onPointerDown={(event) => {
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const state = drag.current
            if (!state || state.pointer !== event.pointerId) return
            move(event.clientX - state.x, event.clientY - state.y)
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY }
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: WINDOW, height: WINDOW }}
          >
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.src}
                alt=""
                draggable={false}
                className="absolute max-w-none select-none"
                style={{
                  left: offset.x,
                  top: offset.y,
                  width: rendered.width,
                  height: rendered.height,
                }}
              />
            ) : null}
          </div>

          {/* The window: everything outside it is dimmed by a ring wider than
              the sheet, which is cheaper than four positioned panels. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sheet"
            style={{
              width: WINDOW,
              height: WINDOW,
              boxShadow: '0 0 0 9999px rgb(14 23 38 / 0.45), inset 0 0 0 2px #ffffff',
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="logo-zoom" className="text-meta font-semibold text-ink">
            {t.zoom}
          </label>
          <input
            id="logo-zoom"
            type="range"
            min={MIN_ZOOM * 100}
            max={MAX_ZOOM * 100}
            step={1}
            value={Math.round(zoom * 100)}
            onChange={(event) => {
              const next = clampZoom(Number(event.target.value) / 100)
              setZoom(next)
              const grown = coverScale(natural, WINDOW) * next
              setOffset((current) =>
                clampOffset(
                  current,
                  { width: natural.width * grown, height: natural.height * grown },
                  WINDOW,
                ),
              )
            }}
            className="h-11 w-full accent-primary"
          />
          <p className="text-hint text-muted">{t.zoomHint}</p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-meta font-semibold text-ink">{t.background}</span>
          <SegmentedControl
            label={t.background}
            value={background}
            onChange={onBackgroundChange}
            options={[
              { value: 'white', label: t.backgroundWhite },
              { value: 'transparent', label: t.backgroundTransparent },
            ]}
          />
        </div>

        <div className="flex items-center gap-4 rounded-card bg-bg p-3">
          <span className="text-meta text-muted">{t.preview}</span>
          <span className="ml-auto flex items-center gap-3">
            <OrgLogo org={previewOrg} size={36} />
            <OrgLogo org={previewOrg} size={56} />
          </span>
        </div>
      </div>
    </BottomSheet>
  )
}
