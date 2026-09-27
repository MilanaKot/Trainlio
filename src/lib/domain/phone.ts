/**
 * The parent's contact number (DESIGN_BRIEF decision 18).
 *
 * Stored in E.164 because that is what a `tel:` link needs in order to dial
 * from a phone that is not in the same country — and the clubs this serves do
 * have families abroad. What a parent types is another matter: nobody writes
 * their own number without spaces, so the separators are removed before the
 * shape is judged.
 */
const E164 = /^\+[1-9][0-9]{7,14}$/

/** Everything a person uses to make a number readable, and nothing else. */
const SEPARATORS = /[\s  ().-]/g

export type PhoneResult =
  { ok: true; value: string | null } | { ok: false; reason: 'FORMAT' | 'MISSING_COUNTRY_CODE' }

/**
 * Normalises what was typed, or explains what is wrong with it.
 *
 * A blank field is a valid answer — the number is optional — and comes back as
 * null rather than an empty string, so the column holds one representation of
 * "not given".
 */
export function normalisePhone(input: string): PhoneResult {
  const stripped = input.replace(SEPARATORS, '')
  if (stripped === '') return { ok: true, value: null }

  // Worth its own reason: a Czech parent typing 777123456 has made a different
  // mistake from one who typed letters, and deserves a different sentence.
  if (!stripped.startsWith('+')) return { ok: false, reason: 'MISSING_COUNTRY_CODE' }
  if (!E164.test(stripped)) return { ok: false, reason: 'FORMAT' }

  return { ok: true, value: stripped }
}

/**
 * `+420 123 456 789` — the stored number, spaced so it can be read.
 *
 * Grouped in threes from the end, across the whole number. It deliberately
 * does not try to separate the country code: that needs a dial-code table, and
 * guessing produces `+120 255 501 43` for a number whose code is `+1`. This
 * lands on the conventional grouping for the Czech numbers this serves, and
 * for everyone else it is still only spaces — no digit moves, none is lost.
 */
export function formatPhone(phone: string): string {
  const match = /^\+(\d+)$/.exec(phone)
  if (!match) return phone

  const digits = match[1] ?? ''
  return `+${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}
