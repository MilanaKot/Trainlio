/**
 * Club logo storage paths (migration 29).
 *
 * The path is authorization, as it is for athlete photos: the storage policy
 * reads the second segment as the workspace id and requires an administrator
 * of it, and a CHECK constraint on `workspaces.logo_path` pins the shape. A
 * path built any other way is either unreachable or rejected on save.
 *
 * The bucket is public, unlike the athlete one. A club's emblem travels in the
 * e-mails a parent receives, and a mail client can follow neither a signed URL
 * that expires nor a private bucket. A child's photograph is a different kind
 * of thing and stays private (BR-093, D-19).
 */
export const LOGO_BUCKET = 'workspace-logos'

/** A megabyte. A club emblem that does not fit is a scan, not a logo. */
export const MAX_LOGO_BYTES = 1024 * 1024

export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type LogoRejection = 'LOGO_TOO_LARGE' | 'LOGO_TYPE_NOT_ALLOWED' | 'LOGO_EMPTY'

export function checkLogo(file: { size: number; type: string }): LogoRejection | null {
  if (file.size === 0) return 'LOGO_EMPTY'
  if (file.size > MAX_LOGO_BYTES) return 'LOGO_TOO_LARGE'
  if (!(file.type in EXTENSION_BY_TYPE)) return 'LOGO_TYPE_NOT_ALLOWED'
  return null
}

/**
 * `logos/{workspaceId}/{uuid}.{ext}`
 *
 * A fresh name per upload rather than a fixed one: a public object sits behind
 * a CDN, and reusing the path would serve the previous emblem for as long as
 * the cache holds it.
 */
export function logoPath(workspaceId: string, contentType: string, uuid: string): string {
  const extension = EXTENSION_BY_TYPE[contentType]
  if (!extension) throw new Error(`Unsupported logo type: ${contentType}`)
  return `logos/${workspaceId}/${uuid}.${extension}`
}

/**
 * The public URL of a stored logo.
 *
 * Built here rather than by the storage client, because the same URL has to be
 * written into an e-mail by the drain job, where there is no browser client and
 * no session at all.
 */
export function logoUrl(supabaseUrl: string, path: string | null): string | null {
  if (!path) return null
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/${path}`
}
