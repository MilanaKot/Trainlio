/**
 * What the statistics screens print (K20, K20b; handoff v3.5, decision 48).
 * The counting is the database's (`workspace_statistics`, migration 47); this
 * only turns its counts into the percentages, colours and labels drawn.
 */

/** A whole percentage, or null when there is nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** K20 `NEJNIŽŠÍ DOCHÁZKA`: red under 60 %, orange under 80 %. */
export function attendanceTone(value: number): 'danger' | 'warning' | 'ink' {
  if (value < 60) return 'danger'
  if (value < 80) return 'warning'
  return 'ink'
}

/** K20b chart: green at 80 % and above, orange below. */
export function barTone(value: number): 'success' | 'warning' {
  return value >= 80 ? 'success' : 'warning'
}

const MONTHS_SHORT = [
  'led',
  'úno',
  'bře',
  'dub',
  'kvě',
  'čvn',
  'čvc',
  'srp',
  'zář',
  'říj',
  'lis',
  'pro',
]

/**
 * The label under a K20b bar. Weeks of a month are `1.–7.`, `8.–14.`,
 * `15.–21.` and `22.–{last day}.`; months of a season their short name.
 */
export function bucketLabel(key: string, lastDayOfMonth: number): string {
  const month = key.match(/^\d{4}-(\d{2})$/)
  if (month) return MONTHS_SHORT[Number(month[1]) - 1] ?? key
  const week = Number(key)
  const from = (week - 1) * 7 + 1
  const to = week === 4 ? lastDayOfMonth : week * 7
  return `${from}.–${to}.`
}

/** Every bucket of the period, empty ones included, so the chart has a gap. */
export function bucketKeys(kind: 'month' | 'season', seasonYear: number): string[] {
  if (kind === 'month') return ['1', '2', '3', '4']
  return Array.from({ length: 12 }, (_, index) => {
    const month = ((7 + index) % 12) + 1
    const year = month >= 8 ? seasonYear : seasonYear + 1
    return `${year}-${String(month).padStart(2, '0')}`
  })
}
