'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestCode, signInWithGoogle, verifyCode } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { CodeInput } from '@/components/ui/code-input'
import { Field } from '@/components/ui/field'

const RESEND_SECONDS = 60

type Stage = { name: 'email' } | { name: 'code'; email: string }

/**
 * Two-step OTP sign-in (PRD §7, USER_FLOWS §1, guardian/SPEC.md §G11/§G12).
 *
 * Mobile-first: one field per step, a large tap target, and the numeric keypad
 * on the code step. A parent opening the coach's link on a phone should reach
 * the app in two taps and six digits.
 */
export function SignInForm({
  initialEmail = '',
  google = false,
  googleFailed = false,
}: {
  initialEmail?: string
  /** `Pokračovat přes Google` above the e-mail, once the provider is set up. */
  google?: boolean
  /** Back from Google without a session (`/auth/callback`). */
  googleFailed?: boolean
}) {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ name: 'email' })
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  // §6.26: the code itself was refused, rather than sending a new one failing.
  const [refused, setRefused] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [pending, startTransition] = useTransition()
  const [leaving, startLeaving] = useTransition()
  const [googleError, setGoogleError] = useState<string | null>(
    googleFailed ? messages.auth.errors.google : null,
  )

  function onGoogle() {
    setGoogleError(null)
    startLeaving(async () => {
      // On success the action redirects to Google and never returns.
      const result = await signInWithGoogle()
      if (!result.ok) setGoogleError(messages.auth.errors.google)
    })
  }

  function startCooldown() {
    setCooldown(RESEND_SECONDS)
    const timer = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          clearInterval(timer)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  function onRequest(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await requestCode(email)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStage({ name: 'code', email: email.trim() })
      startCooldown()
    })
  }

  /**
   * The code, verified. Takes the digits rather than reading state, because the
   * sixth one submits (§6.26) and the state holding it has not been applied yet
   * when that happens.
   */
  function verify(digits: string) {
    setError(null)
    startTransition(async () => {
      const result = await verifyCode(email, digits)
      if (!result.ok) {
        // Emptied, not left full: six refused digits in the field would take
        // no seventh, and a parent typing the right code would see nothing
        // happen. The boxes stay red until the first new digit.
        setCode('')
        setRefused(true)
        setError(result.message)
        return
      }
      router.replace('/')
      router.refresh()
    })
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault()
    verify(code)
  }

  function onResend() {
    setError(null)
    startTransition(async () => {
      const result = await requestCode(email)
      if (!result.ok) {
        setError(result.message)
        return
      }
      startCooldown()
    })
  }

  const t = messages.auth
  const countdown = `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page font-bold text-ink">
          {stage.name === 'email' ? t.signInTitle : t.codeTitle}
        </h1>
        {stage.name === 'email' ? (
          <p className="text-body text-muted">{google ? t.signInIntroGoogle : t.signInIntro}</p>
        ) : (
          <p className="text-body text-muted">
            {t.codeSentTo.split('{email}')[0]}
            <span className="font-semibold text-ink">{stage.email}</span>
            {t.codeSentTo.split('{email}')[1]}
          </p>
        )}
      </header>

      {stage.name === 'email' && google ? (
        <div className="flex flex-col gap-4">
          {googleError ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {googleError}
            </p>
          ) : null}
          <Button
            size="lg"
            variant="outline"
            onClick={onGoogle}
            disabled={pending}
            {...(leaving ? { loadingLabel: t.googleRedirecting } : {})}
          >
            <GoogleMark />
            {t.google}
          </Button>
          <p className="flex items-center gap-3 text-hint text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            {t.or}
            <span className="h-px flex-1 bg-line" />
          </p>
        </div>
      ) : null}

      {stage.name === 'email' ? (
        <form onSubmit={onRequest} className="flex flex-col gap-4">
          {/* The error belongs to the field, not to the form: it is about what
              was typed in it (§6.10). */}
          <Field label={t.email} {...(error ? { error } : {})}>
            {(props) => (
              <input
                {...props}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t.emailPlaceholder}
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>

          <Button
            type="submit"
            size="lg"
            disabled={pending}
            {...(pending ? { loadingLabel: t.sending } : {})}
          >
            {t.sendCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          {/* §6.26: the sixth digit submits. */}
          <CodeInput
            value={code}
            onChange={(digits) => {
              setCode(digits)
              if (digits !== '') {
                setError(null)
                setRefused(false)
              }
            }}
            onComplete={(digits) => verify(digits)}
            label={t.code}
            invalid={refused}
            autoFocus
          />

          {error ? (
            <p role="alert" className="text-hint font-semibold text-danger">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={pending || code.length !== 6}
            {...(pending ? { loadingLabel: t.verifying } : {})}
          >
            {t.verify}
          </Button>

          <div className="flex items-center justify-between gap-3">
            {/* A countdown rather than a dead link: a parent who did not get
                the code should see when they may ask again, not a button that
                refuses. */}
            {cooldown > 0 ? (
              <span className="flex min-h-11 items-center text-hint text-muted">
                {t.resendIn.replace('{time}', countdown)}
              </span>
            ) : (
              <button
                type="button"
                onClick={onResend}
                disabled={pending}
                className="flex min-h-11 items-center text-hint font-semibold text-primary disabled:text-muted"
              >
                {t.resendNow}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setStage({ name: 'email' })
                setCode('')
                setError(null)
              }}
              className="flex min-h-11 items-center text-hint font-semibold text-primary"
            >
              {t.changeEmail}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/**
 * Google's own four-colour mark, as its branding guidelines require on a
 * sign-in button — never recoloured.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}
