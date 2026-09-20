/**
 * Athlete photo storage paths.
 *
 * The path is not cosmetic: storage authorization is derived from it. The
 * policies in migration 08 read the second segment as the athlete id and check
 * guardian or coach access against it, and a CHECK constraint on
 * `athletes.photo_path` pins the shape to exactly three segments. A path built
 * any other way is either unreachable or rejected on save.
 */
export const PHOTO_BUCKET = 'athlete-photos'
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PHOTO_SIGNED_URL_SECONDS = 60 * 60 // D-19

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type PhotoRejection = 'PHOTO_TOO_LARGE' | 'PHOTO_TYPE_NOT_ALLOWED' | 'PHOTO_EMPTY'

export function checkPhoto(file: { size: number; type: string }): PhotoRejection | null {
  if (file.size === 0) return 'PHOTO_EMPTY'
  if (file.size > MAX_PHOTO_BYTES) return 'PHOTO_TOO_LARGE'
  if (!(file.type in EXTENSION_BY_TYPE)) return 'PHOTO_TYPE_NOT_ALLOWED'
  return null
}

/**
 * `athletes/{athleteId}/{uuid}.{ext}`
 *
 * A fresh name per upload rather than a fixed one: signed URLs and CDN caches
 * key on the path, so reusing it would serve the previous photo after a
 * replacement.
 */
export function photoPath(athleteId: string, contentType: string, uuid: string): string {
  const extension = EXTENSION_BY_TYPE[contentType]
  if (!extension) throw new Error(`Unsupported photo type: ${contentType}`)
  return `athletes/${athleteId}/${uuid}.${extension}`
}

export function photoBelongsToAthlete(path: string, athleteId: string): boolean {
  const segments = path.split('/')
  return segments.length === 3 && segments[0] === 'athletes' && segments[1] === athleteId
}
