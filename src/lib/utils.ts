import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The design system's type scale (DESIGN_SYSTEM §3), named for
 * tailwind-merge's benefit.
 *
 * Without this list, `text-body` and `text-white` look like the same kind of
 * class to the merger — it knows Tailwind's own font sizes and treats every
 * other `text-*` as a colour — so one silently replaced the other. Whichever
 * came last won: filled buttons lost their white text and rendered near-black
 * on cobalt and on red, at 2.7:1 and 2.9:1 against a required 4.5:1, and
 * badges lost their size instead. Neither shows up in a type check, a lint
 * rule or a snapshot; both are obvious the moment a colour is measured.
 */
const FONT_SIZES = [
  'page',
  'hero',
  'form-title',
  'sheet-title',
  'count',
  'date',
  'body',
  'row',
  'meta',
  'hint',
  'caption',
  'badge',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZES] }],
    },
  },
})

/**
 * Class name composition for the design-system components.
 *
 * clsx resolves the conditionals; tailwind-merge then drops the losers of any
 * Tailwind conflict, so a caller's `px-6` replaces a component's `px-4` instead
 * of both landing in the class list and the outcome depending on stylesheet
 * order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
