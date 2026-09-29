'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestCode, verifyCode } from '@/server/auth/actions'
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
  const countdown = `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, '0')}`

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-page font-bold text-ink">
          {stage.name === 'email' ? t.signInTitle : t.codeTitle}
        </h1>
        {stage.name === 'email' ? (
          <p className="text-body text-muted">{t.signInIntro}</p>
        ) : (
          <p className="text-body text-muted">
            {t.codeSentTo.split('{email}')[0]}
            <span className="font-semibold text-ink">{stage.email}</span>
            {t.codeSentTo.split('{email}')[1]}
          </p>
        )}
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
          <CodeInput value={code} onChange={setCode} label={t.code} autoFocus />

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
