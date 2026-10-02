import { buttonVariants } from '@/components/ui/button'
import { messages } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const t = messages.myTrainings

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={cn('size-5 shrink-0', className)}
      aria-hidden="true"
    >
      <path
        d="M5.5 3.5h2.2l1.1 2.8-1.5 1.1a8.4 8.4 0 004.3 4.3l1.1-1.5 2.8 1.1v2.2a1.5 1.5 0 01-1.6 1.5A11.5 11.5 0 014 5.1 1.5 1.5 0 015.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SmsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={cn('size-5 shrink-0', className)}
      aria-hidden="true"
    >
      <path
        d="M4 5.5A1.5 1.5 0 015.5 4h9A1.5 1.5 0 0116 5.5v6A1.5 1.5 0 0114.5 13H9l-3.5 2.5V13h-.0A1.5 1.5 0 014 11.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Ringing a person from the screen that mentions them (DESIGN_SYSTEM §6.31).
 *
 * Two shapes, because two screens need different weights: `buttons` is the pair
 * of outline buttons in the G6d footer, where calling the coach is the only
 * thing left to do; `icons` is the pair at the end of a guardian row on K13,
 * where the point of the row is the name.
 *
 * Both are real `tel:` and `sms:` links. A button that opens the dialler is not
 * a button — middle-click, long-press and "copy link" all belong to an anchor,
 * and a screen reader lists them where a parent looks for them.
 *
 * Without a number it renders nothing at all. A disabled `Zavolat` would be a
 * promise the screen cannot keep, and the row above it already says the number
 * is missing.
 */
export function ContactActions({
  phone,
  name,
  layout = 'buttons',
}: {
  phone: string | null
  name: string
  layout?: 'buttons' | 'icons'
}) {
  if (!phone) return null

  const callLabel = name === '' ? t.call : t.callAria.replace('{name}', name)
  const smsLabel = name === '' ? t.sendSms : t.smsAria.replace('{name}', name)
  // The dialler takes the digits, the parent reads the spaces.
  const href = phone.replace(/\s/g, '')

  if (layout === 'icons') {
    return (
      <span className="flex shrink-0 items-center gap-2">
        <a
          href={`tel:${href}`}
          aria-label={callLabel}
          className="flex size-11 items-center justify-center rounded-control bg-primary-100 text-primary active:bg-primary-200"
        >
          <PhoneIcon />
        </a>
        <a
          href={`sms:${href}`}
          aria-label={smsLabel}
          className="flex size-11 items-center justify-center rounded-control bg-primary-100 text-primary active:bg-primary-200"
        >
          <SmsIcon />
        </a>
      </span>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <a
        href={`tel:${href}`}
        aria-label={callLabel}
        className={buttonVariants({ variant: 'outline', size: 'lg' })}
      >
        <PhoneIcon />
        {t.call}
      </a>
      <a
        href={`sms:${href}`}
        aria-label={smsLabel}
        className={buttonVariants({ variant: 'outline', size: 'lg' })}
      >
        <SmsIcon />
        {t.sendSms}
      </a>
    </div>
  )
}
