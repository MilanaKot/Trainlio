/**
 * The parent's contact number (DESIGN_BRIEF decision 18).
 *
 * Two shapes are accepted, and the reason is who types them. A parent writing
 * down their own number writes `777 123 456`; a form that rejects that is
 * telling someone their own telephone number is wrong. Both ends of this call
 * are in the same country, and `tel:777123456` dials fine from the coach's
 * phone standing at the rink.
 *
 * A number that does start with `+` is held to E.164 strictly, because that is
 * the form that has to work from anywhere — the design asked for it, and a
 * family abroad still gets it right.
 */
const INTERNATIONAL = /^\+[1-9][0-9]{7,14}$/
const NATIONAL = /^[0-9]{6,15}$/

/** Everything a person uses to make a number readable, and nothing else. */
const SEPARATORS = /[\s  ().-]/g

export type PhoneResult = { ok: true; value: string | null } | { ok: false }

/**
 * Normalises what was typed, or rejects it.
 *
 * A blank field is a valid answer — the number is optional — and comes back as
 * null rather than an empty string, so the column holds one representation of
 * "not given".
 */
export function normalisePhone(input: string): PhoneResult {
  const stripped = input.replace(SEPARATORS, '')
  if (stripped === '') return { ok: true, value: null }

  if (INTERNATIONAL.test(stripped) || NATIONAL.test(stripped)) {
    return { ok: true, value: stripped }
  }

  return { ok: false }
}

/**
 * `777 123 456`, `+420 123 456 789` — the stored number, spaced so it can be
 * read.
 *
 * Grouped in threes from the end. It deliberately does not try to separate a
 * country code: that needs a dial-code table, and guessing produces
 * `+120 255 501 43` for a number whose code is `+1`. This lands on the
 * conventional grouping for the Czech numbers this serves, and for everyone
 * else it is still only spaces — no digit moves, none is lost.
 */
export function formatPhone(phone: string): string {
  const match = /^(\+?)(\d+)$/.exec(phone)
  if (!match) return phone

  const [, plus = '', digits = ''] = match
  return `${plus}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}
