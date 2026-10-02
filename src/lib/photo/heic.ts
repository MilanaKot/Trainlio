/**
 * HEIC, as a JPEG the rest of the app already understands (DR-13).
 *
 * Runs in the browser, on purpose. The alternative is a server that decodes
 * images, which means a native decoder in the deployment and every parent's
 * photograph passing through it; here the file becomes a JPEG on the phone that
 * took it, and the server keeps accepting exactly three types.
 *
 * `heic2any` is imported dynamically because it carries a copy of libheif —
 * megabytes no parent who uploads a JPEG should ever download.
 */

/** Long edge of the converted image. The design shows photos at 72 and 512. */
const MAX_EDGE = 1024
const QUALITY = 0.85

export async function heicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')

  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALITY })
  const blob = Array.isArray(converted) ? converted[0] : converted
  if (!blob) throw new Error('The converter returned nothing')

  // Resized, and not merely for speed: HEIC stores the same picture in roughly
  // half the bytes, so a 4 MB HEIC can convert into a JPEG past the 5 MB limit
  // the server enforces — and the parent would then be told their photograph is
  // too large *after* being told it was converted. The limit applies to the file
  // they picked (§G9), so what we hand on has to fit under it.
  const resized = await downscale(blob)

  return new File([resized], jpegName(file.name), { type: 'image/jpeg' })
}

async function downscale(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

  if (scale === 1 && blob.size <= 4 * 1024 * 1024) {
    bitmap.close()
    return blob
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)

  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return blob
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  )
  return encoded ?? blob
}

/** `IMG_0421.HEIC` → `IMG_0421.jpg`, and a name with no extension gets one. */
export function jpegName(name: string): string {
  const base = name.replace(/\.hei[cf]$/i, '')
  return `${base === '' ? 'fotografie' : base}.jpg`
}
