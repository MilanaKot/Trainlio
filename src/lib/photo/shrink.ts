/**
 * A photograph small enough to send.
 *
 * Not only tidiness. The upload is a Server Action, and Next refuses an action
 * body over 1 MB before our code sees it — so a 3 MB JPEG straight off a phone
 * never reached the 5 MB check at all. §G9 asks for a client-side resize, and
 * this is it: the picture becomes a JPEG on the phone that took it, sized for
 * the 72 px avatar and the 512 px view with room to spare.
 */

/** Long edge of the resized image. The design shows photos at 72 and 512. */
const MAX_EDGE = 1024
const QUALITY = 0.85

/**
 * Below this a file goes as it is, undecoded: it already fits in an action body
 * with the form around it, and the server still judges its type.
 */
export const SEND_AS_IS_BYTES = 900 * 1024

export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= SEND_AS_IS_BYTES) return file

  // Throws for a file that is not a picture, whatever its name says; the field
  // turns that into the type error.
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('No 2D canvas')
  }

  // A transparent PNG would otherwise turn black where it was clear: JPEG has
  // no alpha.
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  )
  if (!encoded) throw new Error('The canvas returned nothing')

  return new File([encoded], jpegName(file.name), { type: 'image/jpeg' })
}

/** `IMG_0421.HEIC` → `IMG_0421.jpg`, and a name with no extension gets one. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./]+$/, '')
  return `${base === '' ? 'fotografie' : base}.jpg`
}
