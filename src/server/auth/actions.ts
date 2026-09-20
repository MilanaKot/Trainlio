'use server'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { messages } from '@/lib/i18n'

/**
 * Email one-time-code authentication (PRD §7). No password.
 *
 * Both actions run on the server so the Supabase response, and in particular
 * whether an address is already registered, never reaches the client. The
 * messages returned are deliberately identical whether or not the email is
 * known: an OTP form that distinguishes them is an account-enumeration oracle,
 * and here the accounts belong to parents of identifiable children.
 */

const emailSchema = z.email()
const codeSchema = z.string().regex(/^\d{6}$/)

export type AuthResult = { ok: true } | { ok: false; message: string }

function mapError(error: {
  status?: number | undefined
  code?: string | undefined
  message: string
}): string {
  const e = messages.auth.errors

  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return e.tooManyRequests
  }
  if (error.code === 'otp_expired' || error.status === 403) {
    return e.wrongCode
  }
  return e.generic
}

export async function requestCode(email: string): Promise<AuthResult> {
  const parsed = emailSchema.safeParse(email.trim())
  if (!parsed.success) return { ok: false, message: messages.auth.errors.invalidEmail }

  const supabase = await createClient()

  // shouldCreateUser stays true: registration is open, and D-01 is what makes
  // that safe — an authenticated user with no athlete sees no workspace data,
  // so a stranger who signs up reaches an empty app.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: true },
  })

  if (error) return { ok: false, message: mapError(error) }

  return { ok: true }
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  const parsedEmail = emailSchema.safeParse(email.trim())
  if (!parsedEmail.success) return { ok: false, message: messages.auth.errors.invalidEmail }

  const parsedCode = codeSchema.safeParse(code.trim())
  if (!parsedCode.success) return { ok: false, message: messages.auth.errors.invalidCode }

  const supabase = await createClient()

  const { error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token: parsedCode.data,
    type: 'email',
  })

  if (error) return { ok: false, message: mapError(error) }

  // The profile that every policy authorizes against is created by the trigger
  // in migration 10. This call covers the case where it did not fire — a user
  // imported by an administrator, or a project where the trigger was added
  // later — so a signed-in user is never left without an actor record.
  await supabase.rpc('ensure_current_profile')

  return { ok: true }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}
