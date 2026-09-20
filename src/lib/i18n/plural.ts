/**
 * Czech plural categories.
 *
 * Czech distinguishes one / few (2–4) / many, which rules out building count
 * messages by concatenation. The booking flow needs this immediately: the
 * insufficient-capacity message reports how many places remain, and
 * "zbývá 1 volné místo" / "zbývají 2 volná místa" / "zbývá 5 volných míst"
 * differ in the verb, the adjective and the noun at once.
 */
export type PluralCategory = 'one' | 'few' | 'many'

export type PluralForms = Record<PluralCategory, string>

export function czechPluralCategory(count: number): PluralCategory {
  if (!Number.isInteger(count)) return 'many'
  if (count === 1) return 'one'
  if (count >= 2 && count <= 4) return 'few'
  return 'many'
}

/**
 * Picks the form and substitutes every `{count}`.
 *
 * replaceAll, not replace: the insufficient-capacity message names the number
 * twice ("zbývají 2 volná místa … nejvýše 2 sportovce") and a single
 * substitution would leave a raw placeholder on screen.
 */
export function plural(count: number, forms: PluralForms): string {
  return forms[czechPluralCategory(count)].replaceAll('{count}', String(count))
}
