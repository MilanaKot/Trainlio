import { cn } from '@/lib/utils'
import { messages } from '@/lib/i18n'

export type SessionRole = 'MAIN' | 'ASSISTANT'

/**
 * The signed-in coach's part in a training, on its row (DESIGN_SYSTEM §6.34,
 * coach/SPEC.md §K1, v3.2).
 *
 * Sentence case, unlike a status badge: it is not a state the training is in
 * but who you are on it. `Hlavní trenér` in cobalt, `Asistent` neutral. Not
 * interactive, and absent on trainings the coach has no part in.
 */
export function RoleLabel({ role, className }: { role: SessionRole; className?: string }) {
  return (
    <span
      className={cn(
        'mt-1 inline-flex h-[22px] items-center self-start rounded-badge px-[7px] text-[0.6875rem] font-bold',
        role === 'MAIN' ? 'bg-primary-100 text-primary' : 'bg-neutral-50 text-muted',
        className,
      )}
    >
      {role === 'MAIN' ? messages.coach.roleMain : messages.coach.roleAssistant}
    </span>
  )
}
