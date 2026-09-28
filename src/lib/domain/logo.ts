/**
 * The club's mark: what may be chosen, what may be stored, and where
 * (migrations 29 and 30, admin/SPEC.md "File rules").
 *
 * Two different questions live here, and keeping them apart is the point.
 *
 * What an administrator may *choose* is a PNG, a JPEG or an SVG of at most
 * 2 MB whose raster is at least 256 px square — checked in the browser, where
 * the file still is, so the refusal is instant and names the file.
 *
 * What may be *stored* is narrower: a PNG, because the adjust sheet crops
 * every choice to a 512 px PNG before it leaves the page, an SVG included. A
 * stored SVG is a script served from our own origin, so that is not a
 * preference — it is why the bucket itself takes PNG alone (migration 30) and
 * why the server action checks the bytes rather than the caller's word.
 */

/**
 * The bucket is public, unlike the athlete one. A club's emblem travels in the
 * e-mails a parent receives, and a mail client can follow neither a signed URL
 * that expires nor a private bucket. A child's photograph is a different kind
 * of thing and stays private (BR-093, D-19).
 */
export const LOGO_BUCKET = 'workspace-logos'

/** admin/SPEC.md: two megabytes, matching the bucket's own limit. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

/** A mark below this is smaller than the 96px square it is drawn in at 2×. */
export const MIN_LOGO_PIXELS = 256

/** The square the sheet crops to, and the only size ever stored. */
export const STORED_LOGO_PIXELS = 512

/** What the file picker offers, and what the sheet knows how to rasterise. */
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const

/** What may reach storage: the sheet's own output. */
export const STORED_LOGO_TYPE = 'image/png'

export type LogoRejection =
  'LOGO_EMPTY' | 'LOGO_TOO_LARGE' | 'LOGO_TYPE_NOT_ALLOWED' | 'LOGO_TOO_SMALL'

/** The file an administrator picked, before the sheet has touched it. */
export function checkChosenLogo(file: { size: number; type: string }): LogoRejection | null {
  if (file.size === 0) return 'LOGO_EMPTY'
  if (file.size > MAX_LOGO_BYTES) return 'LOGO_TOO_LARGE'
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(file.type)) {
    return 'LOGO_TYPE_NOT_ALLOWED'
  }
  return null
}

/**
 * The bytes about to be uploaded.
 *
 * Deliberately stricter than what may be chosen: this runs on the server,
 * where the only thing that can be trusted is the file itself. A client that
 * skipped the sheet and posted its original SVG is refused here, and would be
 * refused again by the bucket.
 */
export function checkStoredLogo(
  file: { size: number; type: string },
  bytes: Uint8Array,
): LogoRejection | null {
  if (file.size === 0) return 'LOGO_EMPTY'
  if (file.size > MAX_LOGO_BYTES) return 'LOGO_TOO_LARGE'
  if (file.type !== STORED_LOGO_TYPE) return 'LOGO_TYPE_NOT_ALLOWED'

  const size = pngSize(bytes)
  // Not a readable PNG header: the declared type is a claim, the bytes are the
  // evidence, and an object that is not what it says it is does not go into a
  // public bucket.
  if (!size) return 'LOGO_TYPE_NOT_ALLOWED'
  if (size.width < MIN_LOGO_PIXELS || size.height < MIN_LOGO_PIXELS) return 'LOGO_TOO_SMALL'
  return null
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A PNG's dimensions, from its first chunk.
 *
 * Thirty bytes of a format that has not changed since 1996, rather than an
 * image library on the server for one number each way: IHDR is the first
 * chunk of every PNG, and its width and height are two big-endian 32-bit
 * integers at a fixed offset.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return null
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null

  const read = (offset: number) =>
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)

  const width = read(16)
  const height = read(20)
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

/**
 * `logos/{workspaceId}/{uuid}.png`
 *
 * The path is authorization, as it is for athlete photos: the storage policy
 * reads the second segment as the workspace id and requires an administrator
 * of it, and a CHECK constraint on `workspaces.logo_path` pins the shape. A
 * path built any other way is either unreachable or rejected on save.
 *
 * A fresh name per upload rather than a fixed one: a public object sits behind
 * a CDN, and reusing the path would serve the previous emblem for as long as
 * the cache holds it.
 */
export function logoPath(workspaceId: string, uuid: string): string {
  return `logos/${workspaceId}/${uuid}.png`
}

/**
 * The public URL of a stored logo.
 *
 * Built here rather than by the storage client, because the same URL has to be
 * written into an e-mail by the drain job, where there is no browser client and
 * no session at all.
 *
 * `?v=` is when the mark last changed. The object name is already unique per
 * upload, so this is for the second cache: a page a parent has open, and the
 * next/image entry keyed by URL, both of which would otherwise keep drawing
 * the emblem the club has just replaced.
 */
export function logoUrl(
  supabaseUrl: string,
  path: string | null,
  updatedAt?: string | null,
): string | null {
  if (!path) return null
  const base = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/${path}`
  if (!updatedAt) return base
  return `${base}?v=${encodeURIComponent(updatedAt)}`
}
