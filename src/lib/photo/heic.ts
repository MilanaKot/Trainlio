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
 *
 * The result is full size. HEIC stores the same picture in roughly half the
 * bytes, so it can come out larger than the file the parent picked; the field
 * passes it through `shrinkPhoto` like any other photograph.
 */

import { jpegName } from './shrink'

const QUALITY = 0.85

export async function heicToJpeg(file: File): Promise<File> {
  const { default: heic2any } = await import('heic2any')

  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: QUALITY })
  const blob = Array.isArray(converted) ? converted[0] : converted
  if (!blob) throw new Error('The converter returned nothing')

  return new File([blob], jpegName(file.name), { type: 'image/jpeg' })
}
