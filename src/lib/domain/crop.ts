/**
 * The square crop behind the adjust sheet (admin/SPEC.md §A5).
 *
 * The arithmetic lives here, away from the pointer events, because it is the
 * part that can be wrong in ways nobody sees until a club's crest is stored
 * with its left edge cut off: what "fills the window" means, how far the image
 * may be dragged before it stops covering, and which part of the original the
 * canvas should copy.
 *
 * One coordinate system throughout: CSS pixels of the crop window, whose
 * origin is the window's top-left corner. `offset` is where the scaled image's
 * top-left corner sits in it, and is therefore normally negative.
 */

export type Size = { width: number; height: number }
export type Offset = { x: number; y: number }

/**
 * The scale at which the shorter side of the image exactly fills the window.
 *
 * The starting point, and the floor: below it the square would have corners
 * with nothing in them.
 */
export function coverScale(natural: Size, window: number): number {
  const shortest = Math.min(natural.width, natural.height)
  if (shortest <= 0) return 1
  return window / shortest
}

/**
 * The offset with the image dragged back until it covers the window again.
 *
 * Rather than refusing the drag: a finger that has gone too far should stop at
 * the edge, not snap back to the middle.
 */
export function clampOffset(offset: Offset, rendered: Size, window: number): Offset {
  const axis = (value: number, length: number) => {
    // An image narrower than the window (it cannot be, after coverScale, but
    // the slider is the caller's) is centred rather than clamped to nonsense.
    if (length <= window) return (window - length) / 2
    return Math.min(0, Math.max(window - length, value))
  }

  return { x: axis(offset.x, rendered.width), y: axis(offset.y, rendered.height) }
}

/**
 * The square of the *original* image that the window is showing.
 *
 * What `drawImage` needs: the export is always 512 px square, so the source
 * rectangle is the only thing that varies with where the image was dragged.
 */
export function sourceRect(
  offset: Offset,
  natural: Size,
  scale: number,
  window: number,
): { x: number; y: number; size: number } {
  const size = window / scale
  const x = -offset.x / scale
  const y = -offset.y / scale

  // Never outside the bitmap: a fractional pixel of drag should not make
  // drawImage read from beyond the edge and paint a transparent seam.
  return {
    x: Math.min(Math.max(0, x), Math.max(0, natural.width - size)),
    y: Math.min(Math.max(0, y), Math.max(0, natural.height - size)),
    size,
  }
}

/** The zoom slider's range, as a multiple of `coverScale` (§A5: 50–150 %). */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 1.5

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}
