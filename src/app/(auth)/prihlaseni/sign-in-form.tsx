'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestCode, verifyCode } from '@/server/auth/actions'
import { messages } from '@/lib/i18n'

const RESEND_SECONDS = 60

type Stage = { name: 'email' } | { name: 'code'; email: string }

/**
 * Two-step OTP sign-in (PRD §7, USER_FLOWS §1).
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
        <h1 className="text-2xl font-semibold">{t.signInTitle}</h1>
        <p className="text-sm opacity-70">
          {stage.name === 'email' ? t.signInIntro : t.codeSentTo.replace('{email}', stage.email)}
        </p>
      </header>

      {stage.name === 'email' ? (
        <form onSubmit={onRequest} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t.email}
            <input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-black/15 px-3 py-3 text-base dark:border-white/20"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {pending ? t.sending : t.sendCode}
          </button>
        </form>
      ) : (
        <form onSubmit={onVerify} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2 text-sm font-medium">
            {t.code}
            <input
              type="text"
              name="code"
              // A numeric keypad and no autocorrect: the code is six digits and
              // is usually typed with one thumb from another app.
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="rounded-lg border border-black/15 px-3 py-3 text-center text-2xl tracking-[0.4em] dark:border-white/20"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending || code.length !== 6}
            className="rounded-lg bg-black px-4 py-3 text-base font-medium text-white disabled:opacity-60 dark:bg-white dark:text-black"
          >
            {pending ? t.verifying : t.verify}
          </button>

          <button
            type="button"
            onClick={onResend}
            disabled={pending || cooldown > 0}
            className="text-sm underline disabled:no-underline disabled:opacity-60"
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
            className="text-sm underline"
          >
            {t.useAnotherEmail}
          </button>
        </form>
      )}
    </div>
  )
}
