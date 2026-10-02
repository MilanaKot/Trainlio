'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { logoUrl } from '@/lib/domain/logo'
import { emailProvider } from '@/lib/email/provider'
import { composeInvitationEmail } from '@/lib/notifications/invitation'

/**
 * Managing the coaching staff (D-11, DESIGN_BRIEF §34).
 *
 * A workspace administrator holds no UPDATE grant on anyone else's profile and
 * no INSERT grant on `workspace_members`: `app_profiles` grants
 * `UPDATE (first_name, last_name)` to the row's own owner and to nobody else.
 * Every operation here goes through a domain function that checks the
 * administrator's role, scopes itself to that one workspace, and records what
 * it did in the audit log (migration 21).
 */

export type StaffResult =
  | { ok: true; displayName?: string | undefined; profileId?: string | undefined }
  | { ok: false; code: string; futureSessions?: number | undefined }

type RpcResult = {
  ok?: boolean
  code?: string
  display_name?: string | null
  profile_id?: string | null
  details?: { future_sessions?: number }
}

function readRpc(value: unknown): RpcResult {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'generic' }
  return value as RpcResult
}

function refresh() {
  // The name a guardian reads is on the session pages, not only here.
  revalidatePath('/trener/vice/treneri')
  revalidatePath('/trener')
  revalidatePath('/treninky')
  revalidatePath('/moje-treninky')
}

export async function setMemberName(
  workspaceId: string,
  profileId: string,
  firstName: string,
  lastName: string,
): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_member_name', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
    p_first_name: firstName.slice(0, 100),
    p_last_name: lastName.slice(0, 100),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true, displayName: result.display_name ?? undefined }
}

/**
 * A coach who has never signed in.
 *
 * The club's first coach exists on the ice before they exist in a database, so
 * the profile is created without a login and can lead sessions from the start
 * (migration 21).
 */
export async function addCoach(
  workspaceId: string,
  firstName: string,
  lastName: string,
  contact: { email?: string; phone?: string } = {},
): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_workspace_coach', {
    p_workspace_id: workspaceId,
    p_first_name: firstName.slice(0, 100),
    p_last_name: lastName.slice(0, 100),
    p_role: 'COACH',
    p_email: contact.email?.slice(0, 160) ?? '',
    p_phone: contact.phone?.slice(0, 40) ?? '',
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return {
    ok: true,
    displayName: result.display_name ?? undefined,
    profileId: result.profile_id ?? undefined,
  }
}

/**
 * The number a parent is given when this coach removes their child (§A3, §G6d).
 *
 * Its own action rather than part of the rename, because it is written to its
 * own table through its own check: an administrator of this workspace, and the
 * audit entry records that a number changed without recording the number
 * (migration 33).
 */
export async function setMemberPhone(
  workspaceId: string,
  profileId: string,
  phone: string,
): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_member_phone', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
    p_phone: phone.slice(0, 40),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true }
}

/**
 * A coach leaves, or comes back. Never a delete: a coach who led a training
 * last winter is part of that training's record.
 *
 * `confirm` is a server-side gate, not a dialog this action decides to show:
 * without it the domain function refuses a coach who still leads future
 * trainings and returns the count the warning has to quote (AC-251), exactly as
 * an over-capacity booking does.
 */
export async function setMemberActive(
  workspaceId: string,
  profileId: string,
  isActive: boolean,
  confirm = false,
): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_member_active', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
    p_is_active: isActive,
    p_confirm: confirm,
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) {
    return {
      ok: false,
      code: result.code ?? 'generic',
      futureSessions: result.details?.future_sessions,
    }
  }

  refresh()
  return { ok: true }
}

/**
 * The address a coach signs in with (§A2, §A3, §A3c).
 *
 * Refused when anybody else in the application already holds it — not only
 * another coach. A guardian signing in with an address recorded here would be
 * attached to this coach's profile by the trigger in migration 36, and would
 * find themselves looking at the club's trainings.
 */
export async function setMemberEmail(
  workspaceId: string,
  profileId: string,
  email: string,
): Promise<StaffResult & { changed?: boolean }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('set_member_email', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
    p_email: email.slice(0, 160),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = data as { ok?: boolean; code?: string; data?: { changed?: boolean } } | null
  if (!result?.ok) return { ok: false, code: result?.code ?? 'generic' }

  refresh()
  return { ok: true, changed: result.data?.changed ?? false }
}

/**
 * Sending the invitation (§A6).
 *
 * Three steps, and the order is the point: the database checks (an
 * administrator, an address, not signed in yet, not within the hour) and hands
 * back what the message needs; the message goes; and only then is the send
 * recorded. Stamping first would lock an administrator out for an hour over a
 * message that never left.
 */
export async function inviteCoach(
  workspaceId: string,
  profileId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('prepare_coach_invitation', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
  })

  if (error) return { ok: false, code: 'generic' }

  const prepared = data as {
    ok?: boolean
    code?: string
    data?: {
      email?: string
      coach_name?: string | null
      admin_name?: string | null
      organization_name?: string
      organization_logo_path?: string | null
    }
  } | null

  if (!prepared?.ok || !prepared.data?.email) {
    return { ok: false, code: prepared?.code ?? 'generic' }
  }

  const message = composeInvitationEmail(
    {
      email: prepared.data.email,
      coachName: prepared.data.coach_name ?? null,
      adminName: prepared.data.admin_name ?? null,
      organizationName: prepared.data.organization_name ?? '',
      organizationLogoUrl: logoUrl(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        prepared.data.organization_logo_path ?? null,
      ),
    },
    publicEnv.NEXT_PUBLIC_SITE_URL,
  )

  const sent = await emailProvider().send(message)
  if (!sent.ok) return { ok: false, code: 'SEND_FAILED' }

  const { data: recorded } = await supabase.rpc('record_coach_invitation', {
    p_workspace_id: workspaceId,
    p_profile_id: profileId,
  })

  const result = readRpc(recorded)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  refresh()
  return { ok: true }
}

/**
 * §K0, once. The phone is optional and goes in the same call, so a coach who
 * types it does not have to find the account screen to save it.
 */
export async function completeWelcome(phone: string): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('complete_staff_welcome', {
    p_phone: phone.slice(0, 40),
  })

  if (error) return { ok: false, code: 'generic' }

  const result = readRpc(data)
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }

  return { ok: true }
}

/**
 * `Naposledy v aplikaci` on §A3.
 *
 * Called from the coach's own list, not from the layout: once per visit to the
 * screen a coach opens the app for is enough, and the database writes at most
 * hourly anyway. A failure is silent — this is a line on an administrative
 * screen, and nothing a coach does should fail because of it.
 */
export async function touchStaffSeen(): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc('touch_staff_seen')
}
