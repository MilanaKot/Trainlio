/**
 * Series ceiling (coach/SPEC.md §K4b; 52 until migration 40, which raised it
 * once a series could repeat on several weekdays and a season outgrew it).
 *
 * The number is enforced by create_session_series, which refuses
 * SERIES_TOO_LONG, and by a check constraint on session_series.generated_count.
 * This copy exists so the coach's preview can say so before the round trip —
 * it is a courtesy, not the control (principle 5).
 */
export const MAX_SERIES_OCCURRENCES = 200

/** ISO-8601 weekday numbers, Monday first, in the order the toggles render. */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number]

/**
 * Sorted, de-duplicated weekday set — the same normalisation
 * public.canonical_weekdays applies before storing the pattern.
 */
export function canonicalWeekdays(weekdays: readonly number[]): number[] {
  return [...new Set(weekdays)]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
}
