'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestCode, verifyCode } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
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
export function SignInForm() {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ name: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [pending, startTransition] = useTransition()

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

  function onVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await verifyCode(email, code)
      if (!result.ok) {
        setError(result.message)
        return
      }
      router.replace('/')
      router.refresh()
    })
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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page font-bold text-ink">
          {stage.name === 'email' ? t.signInTitle : t.codeTitle}
        </h1>
        <p className="text-body text-muted">
          {stage.name === 'email' ? t.signInIntro : t.codeSentTo.replace('{email}', stage.email)}
        </p>
      </header>

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
          <Field label={t.code} {...(error ? { error } : {})}>
            {(props) => (
              <input
                {...props}
                type="text"
                name="code"
                // A numeric keypad and no autocorrect: the code is six digits
                // and is usually typed with one thumb from another app.
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${props.className} text-center font-display text-sheet-title tracking-[0.4em] nums`}
              />
            )}
          </Field>

          <Button
            type="submit"
            size="lg"
            disabled={pending || code.length !== 6}
            {...(pending ? { loadingLabel: t.verifying } : {})}
          >
            {t.verify}
          </Button>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onResend}
              disabled={pending || cooldown > 0}
              className="flex min-h-11 items-center text-hint font-semibold text-primary disabled:text-muted"
            >
              {cooldown > 0 ? t.resendIn.replace('{seconds}', String(cooldown)) : t.resend}
            </button>

            <button
              type="button"
              onClick={() => {
                setStage({ name: 'email' })
                setCode('')
                setError(null)
              }}
              className="flex min-h-11 items-center text-hint font-semibold text-primary"
            >
              {t.useAnotherEmail}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
