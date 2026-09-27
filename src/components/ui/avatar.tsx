import { cn } from '@/lib/utils'

/**
 * An athlete or a person, as initials or a photograph (DESIGN_SYSTEM §6.19).
 *
 * Initials are derived here rather than passed in, so every list renders them
 * the same way, and they come from the first characters of the given name and
 * the surname — never from a display name that might be a single word.
 */
const SIZES = {
  28: 'size-7 text-[0.6875rem]',
  36: 'size-9 text-[0.8125rem]',
  40: 'size-10 text-[0.875rem]',
  56: 'size-14 text-[1.125rem]',
  72: 'size-18 text-[1.5rem]',
} as const

export type AvatarSize = keyof typeof SIZES

export function Avatar({
  firstName,
  lastName,
  photoUrl,
  size = 40,
  muted = false,
  className,
}: {
  firstName: string
  lastName?: string | undefined
  photoUrl?: string | null | undefined
  size?: AvatarSize
  /** Inactive or ineligible: the same shape, drained of colour. */
  muted?: boolean
  className?: string
}) {
  const initials = [firstName, lastName]
    .map((part) => part?.trim().charAt(0).toLocaleUpperCase('cs-CZ') ?? '')
    .join('')

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        SIZES[size],
        muted ? 'bg-neutral-200 text-muted' : 'bg-primary-100 text-primary',
        className,
      )}
      // The name is already next to it in every place this is used, so the
      // picture repeats it rather than adding anything (§10).
      aria-hidden="true"
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  )
}
