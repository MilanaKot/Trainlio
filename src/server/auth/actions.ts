'use server'

import { z } from 'zod'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { normalisePhone } from '@/lib/domain/phone'
import { messages } from '@/lib/i18n'

/**
 * Email one-time-code authentication (PRD §7), and Google. No password.
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
  // A second parent signing in with the address they were invited at gets
  // the children now (migration 50). Signing in proves the address.
  await supabase.rpc('accept_guardian_invitations')

  return { ok: true }
}

/**
 * `Pokračovat přes Google` (decided 13 November 2026: Google and the e-mail
 * code, no password). Supabase builds Google's address with a PKCE challenge
 * and keeps the verifier in a cookie; Google sends the person back to
 * `/auth/callback`, which finishes the sign-in.
 *
 * The return address is this site's own, from configuration — never the
 * request's Host header, which a client can set.
 */
export async function signInWithGoogle(next?: string): Promise<AuthResult> {
  if (publicEnv.NEXT_PUBLIC_AUTH_GOOGLE !== 'on') {
    return { ok: false, message: messages.auth.errors.generic }
  }

  const supabase = await createClient()
  const callback = new URL('/auth/callback', publicEnv.NEXT_PUBLIC_SITE_URL)
  callback.searchParams.set('next', safeNext(next))

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      // Always the account chooser: a family tablet signed into one parent's
      // Google account should not sign the other parent in silently.
      queryParams: { prompt: 'select_account' },
    },
  })

  if (error || !data.url) return { ok: false, message: messages.auth.errors.generic }

  // Google's address, not one of ours: typed routes cannot know it.
  redirect(data.url as Route)
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
}

/**
 * A person's own details — how the coach sees them on a roster, and how they
 * reach the family when a training moves at short notice.
 *
 * Two columns, as athletes have always had, and only those two are writable:
 * `app_profiles` grants `UPDATE (first_name, last_name)` and nothing else, so a
 * client cannot move its profile to another login, mark itself anonymised, or
 * write the composed `display_name` the trigger derives (migrations 10 and 21).
 *
 * A surname alone is refused by a CHECK constraint rather than here; this maps
 * that refusal to something a parent can act on, because "uložení se nezdařilo"
 * would leave them retyping the same thing.
 */
export async function updateOwnProfile(
  firstName: string,
  lastName: string,
  phone: string,
): Promise<AuthResult> {
  const first = firstName.trim().slice(0, 100)
  const last = lastName.trim().slice(0, 100)

  if (first.length === 0 && last.length > 0) {
    return { ok: false, message: messages.account.errors.lastNameNeedsFirst }
  }

  // A national number is as welcome as an international one (migration 22),
  // so the only refusal left is a number that is not a number.
  const number = normalisePhone(phone)
  if (!number.ok) {
    return { ok: false, message: messages.account.errors.phoneFormat }
  }

  const supabase = await createClient()

  const { data: profileId } = await supabase.rpc('current_profile_id')
  if (!profileId) return { ok: false, message: messages.auth.errors.generic }

  const { error } = await supabase
    .from('app_profiles')
    .update({
      first_name: first.length > 0 ? first : null,
      last_name: last.length > 0 ? last : null,
      phone: number.value,
    })
    .eq('id', profileId)

  if (error) return { ok: false, message: messages.auth.errors.generic }

  return { ok: true }
}
