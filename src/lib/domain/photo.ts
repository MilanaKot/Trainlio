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
/** What may be *stored*. The server checks this and nothing else. */
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PHOTO_SIGNED_URL_SECONDS = 60 * 60 // D-19

/**
 * What the picker offers (handoff v3, DR-13).
 *
 * HEIC is the default on every iPhone, so refusing it refuses the camera most
 * of these photographs come from. It is accepted and converted to JPEG in the
 * browser, which is why it is not in `ALLOWED_PHOTO_TYPES`: nothing HEIC ever
 * reaches the bucket, and the server still refuses it.
 *
 * The extensions are in the list because they have to be. A `.heic` file picked
 * from the Files app arrives with `type: ''` in several browsers, and an
 * `accept` of MIME types alone then greys it out in the picker.
 */
export const PICKER_PHOTO_TYPES = [...ALLOWED_PHOTO_TYPES, 'image/heic', 'image/heif'] as const
export const PICKER_ACCEPT = [...PICKER_PHOTO_TYPES, '.heic', '.heif'].join(',')

/**
 * A file the browser has to convert before anything else can look at it.
 *
 * By type when the browser gave one, by extension when it did not — and the
 * extension alone is enough, because a file named `.heic` that turns out to be
 * something else fails the conversion and says so.
 */
export function isHeic(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase()
  if (type === 'image/heic' || type === 'image/heif') return true
  return /\.hei[cf]$/i.test(file.name)
}

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
