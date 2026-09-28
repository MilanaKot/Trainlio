'use client'

import Image from 'next/image'
import { useState } from 'react'
import { orgInitials, type Organization } from '@/lib/domain/org'
import { cn } from '@/lib/utils'

/**
 * The club's mark, or its initials (DESIGN_SYSTEM §6.23).
 *
 * One component for every place the club appears — the sign-in screen, the
 * parent's training list, the administrator's own screen — so that a club
 * which has uploaded nothing is not a hole in one place and a monogram in
 * another.
 *
 * Three things it does rather than the caller:
 *
 * The plate. A logo drawn for white paper disappears on the app's grey, so the
 * default draws it on a white square with a hairline. A badge or a shield
 * already has its own edge and gets `transparent`, which is why that choice is
 * stored with the file (migration 30) rather than guessed per screen.
 *
 * The fallback. A mark that fails to load falls back to the monogram instead
 * of a broken-image icon: a parent on a train with a half-loaded page should
 * see the club, not a torn page.
 *
 * The alt text. The mark stands for the name, so it carries the name only
 * where the name is not already written beside it — everywhere else it is
 * decoration and says nothing twice.
 */
const SIZES = {
  28: { radius: 8, image: 22, font: 12 },
  36: { radius: 10, image: 28, font: 16 },
  /* Not in the table: A4b's "until you upload one" row asks for 44. */
  44: { radius: 12, image: 34, font: 20 },
  56: { radius: 16, image: 44, font: 24 },
  72: { radius: 20, image: 56, font: 32 },
  96: { radius: 20, image: 72, font: 40 },
} as const

export type OrgLogoSize = keyof typeof SIZES

export function OrgLogo({
  org,
  size = 36,
  standsAlone = false,
  className,
}: {
  org: Pick<Organization, 'name' | 'logoUrl' | 'logoBackground'>
  size?: OrgLogoSize
  /**
   * True where the mark is the only thing naming the club on the screen. False
   * — the usual case — means the name is printed next to it (§6.23 a11y).
   */
  standsAlone?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const { radius, image, font } = SIZES[size]
  const plate = org.logoBackground === 'white'
  const url = failed ? null : org.logoUrl

  const box = {
    width: size,
    height: size,
    borderRadius: radius,
  } as const

  if (!url) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center bg-primary-100 font-display font-bold text-primary',
          className,
        )}
        style={{ ...box, fontSize: font, lineHeight: 1 }}
        {...(standsAlone ? { role: 'img', 'aria-label': org.name } : { 'aria-hidden': true })}
      >
        {orgInitials(org.name)}
      </span>
    )
  }

  // A blob or a data URL is the crop preview inside the adjust sheet: it never
  // left the browser, so there is nothing for the image optimiser to fetch.
  const local = url.startsWith('blob:') || url.startsWith('data:')
  const inner = plate ? image : size
  const alt = standsAlone ? org.name : ''

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={{
        ...box,
        ...(plate
          ? { background: 'var(--color-surface)', boxShadow: 'inset 0 0 0 1px var(--color-line)' }
          : {}),
      }}
    >
      {local ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          width={inner}
          height={inner}
          style={{ width: inner, height: inner, objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Image
          src={url}
          alt={alt}
          width={inner}
          height={inner}
          // The stored object is 512px square; these are the sizes it is drawn
          // at, and the optimiser is told both so it serves neither a blurred
          // 28px nor a 512px file to a 36px square.
          style={{ width: inner, height: inner, objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
