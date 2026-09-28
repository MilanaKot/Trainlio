import { cn } from '@/lib/utils'

/**
 * The club's own mark, beside the name of the thing it runs.
 *
 * Not in the design handoff — every header there is the product's — so three
 * choices were made here and are cheap to overrule:
 *
 * A rounded square with the image contained inside it, not a circle. Club
 * emblems are shields and crests, and a circular crop cuts their corners off.
 * A white tile behind it, because a logo drawn for white paper disappears on
 * the app's grey.
 *
 * Nothing at all when a club has no mark. A monogram placeholder would be
 * noise standing in for information that does not exist.
 */
export function ClubMark({
  url,
  name,
  size = 36,
  className,
}: {
  url: string | null
  /** Used as the alt text: the mark stands for the club, so it says so. */
  name: string
  size?: number
  className?: string
}) {
  if (!url) return null

  return (
    // A plain <img>, not next/image: the URL is public Supabase storage rather
    // than a configured image domain, and a 36px mark gains nothing from the
    // optimiser that it does not lose in configuration.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      className={cn('shrink-0 rounded-chip bg-surface object-contain', className)}
      style={{ width: size, height: size }}
    />
  )
}
