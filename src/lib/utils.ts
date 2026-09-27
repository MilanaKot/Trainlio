import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Class name composition, as every shadcn/ui component expects to find it at
 * the `utils` alias in components.json.
 *
 * clsx resolves the conditionals; tailwind-merge then drops the losers of any
 * Tailwind conflict, so a caller's `px-6` replaces a component's `px-4` instead
 * of both landing in the class list and the outcome depending on stylesheet
 * order. Both packages were already dependencies — this is the first thing to
 * use them.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
