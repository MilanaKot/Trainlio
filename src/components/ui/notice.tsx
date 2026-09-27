import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * An inline explanation that stays (DESIGN_SYSTEM §6.15).
 *
 * Not dismissible, because everything it says is a consequence the reader has
 * not accepted yet: what a change will email to whom, why a booking cannot go
 * through, what a cancelled training means.
 *
 * `role` is a choice the caller makes: `status` for something that has
 * happened, `alert` for something blocking what they were about to do.
 */
const notice = cva('flex gap-3 rounded-control-lg p-3.5', {
  variants: {
    variant: {
      warning: 'bg-warning-soft text-warning',
      info: 'bg-primary-100 text-primary',
      danger: 'bg-danger-soft text-danger',
      neutral: 'bg-bg text-muted',
    },
  },
  defaultVariants: { variant: 'warning' },
})

type NoticeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof notice> & {
    icon?: React.ReactNode
    title?: string
    role?: 'status' | 'alert'
  }

export function Notice({
  className,
  variant,
  icon,
  title,
  role = 'status',
  children,
  ...props
}: NoticeProps) {
  return (
    <div {...props} role={role} className={cn(notice({ variant }), className)}>
      {icon ? (
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        {title ? <p className="text-row font-bold">{title}</p> : null}
        {children ? <div className="text-meta">{children}</div> : null}
      </div>
    </div>
  )
}
