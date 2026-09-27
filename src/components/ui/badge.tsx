import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Status labels (DESIGN_SYSTEM §6.2).
 *
 * §10: a status is never colour alone. Every badge carries its own words, so
 * the colour repeats the meaning rather than being it.
 */
const badge = cva(
  'inline-flex items-center rounded-badge px-2 text-badge font-bold uppercase tracking-[0.6px]',
  {
    variants: {
      variant: {
        neutral: 'bg-neutral-50 text-muted',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        success: 'bg-success-soft text-success',
      },
      size: { md: 'h-6', sm: 'h-[22px]' },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
)

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span {...props} className={cn(badge({ variant, size }), className)} />
}

/**
 * `Dnes` — its own component rather than a badge variant, because it is the
 * one label that is not a status and not uppercase (§6.2). `Zítra` uses the
 * same shape in neutral, which is why the tone is a prop.
 */
export function TodayChip({
  children,
  tone = 'today',
}: {
  children: React.ReactNode
  tone?: 'today' | 'tomorrow'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-badge px-2 text-[0.75rem] font-bold',
        tone === 'today' ? 'bg-success text-white' : 'bg-neutral-50 text-muted',
      )}
    >
      {children}
    </span>
  )
}
