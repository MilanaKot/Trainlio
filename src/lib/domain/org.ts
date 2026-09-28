/**
 * The club or training centre, as every screen shows it
 * (DESIGN_SYSTEM §6.23, admin/SPEC.md §Organization).
 *
 * The design handoff calls this an organization; in the schema it is a
 * workspace, and migration 30 says why the two are one row rather than two
 * tables. This is the shape the interface reads: the name a parent sees, the
 * mark, and how the mark is drawn. Nothing operational travels with it, so the
 * same object serves the sign-in screen, where there is no session at all.
 */
export type Organization = {
  id: string
  name: string
  /** Optional, for places the full name does not fit. Null means use `name`. */
  shortName: string | null
  /** Already a public URL, or null when the club has no mark. */
  logoUrl: string | null
  logoBackground: LogoBackground
}

export type LogoBackground = 'white' | 'transparent'

export function isLogoBackground(value: unknown): value is LogoBackground {
  return value === 'white' || value === 'transparent'
}

/**
 * The monogram that stands in for a mark the club has not uploaded.
 *
 * The first letters of the first two words — `Hokejová škola Příbram` is `HŠ`,
 * not `HSP` and not `HO`. A single-word name gives its first two letters,
 * because one letter in a 96px square reads as a mistake.
 *
 * Uppercased in Czech and with the diacritics kept: `Š` is a different letter
 * from `S` to everyone who will read it, and stripping accents to make an
 * ASCII monogram would be the product misspelling the club's own name.
 *
 * Code points rather than UTF-16 units, so a name starting outside the basic
 * plane is not cut in half.
 */
export function orgInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''

  const letters =
    words.length === 1
      ? Array.from(words[0] ?? '').slice(0, 2)
      : [Array.from(words[0] ?? '')[0], Array.from(words[1] ?? '')[0]]

  return letters
    .filter((letter): letter is string => Boolean(letter))
    .join('')
    .toLocaleUpperCase('cs-CZ')
}

/**
 * What the name is called where the full one does not fit.
 *
 * The short name when the club set one, the full name otherwise. The interface
 * never abbreviates on its own: `Hokejová škola…` is a truncation the club did
 * not choose, and CSS can do that where it is a layout problem rather than a
 * naming one.
 */
export function orgDisplayName(org: Pick<Organization, 'name' | 'shortName'>): string {
  return org.shortName ?? org.name
}
