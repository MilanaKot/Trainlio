import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The button, in the five variants the design defines (DESIGN_SYSTEM §6.1).
 *
 * Red is deliberately scarce: `danger` exists for cancelling a training and
 * nothing else, so a parent who sees it knows what it means. Everything a
 * coach does that is merely irreversible — closing registration, removing an
 * athlete — is an outline button plus a confirmation that says what follows.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap ' +
    'transition-colors select-none disabled:cursor-not-allowed ' +
    // Disabled is one appearance for every variant: the design gives it a flat
    // neutral fill, so a disabled primary and a disabled outline look alike and
    // neither looks like it is waiting to be pressed.
    'disabled:bg-neutral-50 disabled:text-subtle disabled:shadow-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white active:bg-primary-600',
        secondary: 'bg-primary-100 text-primary active:bg-primary-200',
        outline:
          'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)] active:bg-neutral-50',
        danger: 'bg-danger text-white active:bg-danger-600',
        'danger-outline':
          'bg-transparent text-danger shadow-[inset_0_0_0_1.5px_var(--color-danger-border)] active:bg-danger-soft',
      },
      size: {
        md: 'h-touch rounded-control px-4 text-row',
        lg: 'h-btn-block w-full rounded-control-lg px-5 text-body font-bold',
        // Every button on a training or booking card is this wide, so a column
        // of cards has one straight edge instead of a ragged one (§6.1).
        card: 'h-touch w-card-btn rounded-control text-row',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & {
    /** Shown in place of the label while the server is deciding. */
    loadingLabel?: string
  }

export function Button({
  className,
  variant,
  size,
  loadingLabel,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const loading = loadingLabel !== undefined

  return (
    <button
      type="button"
      {...props}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size }), className)}
    >
      {loading ? <Spinner /> : null}
      {loading ? loadingLabel : children}
    </button>
  )
}

/**
 * The wait, drawn rather than animated with a library.
 *
 * `motion-reduce:animate-none` is not decoration: §10 asks for motion to be
 * optional, and a spinner is the one piece of motion that carries meaning, so
 * it keeps its shape when the animation stops.
 */
function Spinner() {
  return (
    <svg
      className="size-[18px] animate-spin motion-reduce:animate-none"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M16 9a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
