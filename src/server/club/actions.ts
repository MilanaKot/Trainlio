'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { logoUrl } from '@/lib/domain/logo'
import { emailProvider } from '@/lib/email/provider'
import { composeGuardianInvitationEmail } from '@/lib/notifications/invitation'

/**
 * Joining a club, the administrator's decision, and the second parent
 * (migration 50). Each calls one domain function; none of them is reachable
 * by a table write — the join code, the grants and the invitations are in
 * tables no client role holds a grant on.
 */

export type ClubResult = { ok: true } | { ok: false; code: string }

type Rpc = { ok?: boolean; code?: string; data?: Record<string, unknown> }

function read(value: unknown): Rpc {
  return typeof value === 'object' && value !== null ? (value as Rpc) : { ok: false }
}

const id = z.uuid()

/**
 * `Pokračovat` on `/klub/[kod]`: the caller may now register a child into
 * that club, and goes straight to the form.
 */
export async function joinClub(code: string): Promise<ClubResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('join_workspace', { p_code: code })
  const result = read(data)
  if (error || !result.ok) return { ok: false, code: result.code ?? 'generic' }
  redirect('/moji-sportovci/novy')
}

/** `Vytvořit nový odkaz`: the old link stops working at once. */
export async function rotateJoinCode(workspaceId: string): Promise<ClubResult> {
  if (!id.safeParse(workspaceId).success) return { ok: false, code: 'VALIDATION' }
  const supabase = await createClient()
  const result = read(
    (await supabase.rpc('rotate_workspace_join_code', { p_workspace_id: workspaceId })).data,
  )
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }
  revalidatePath('/trener/vice/pristup')
  return { ok: true }
}

/** `Schválit` / `Zamítnout`; the family is e-mailed either way (E12). */
export async function decideJoinRequest(
  membershipId: string,
  approve: boolean,
): Promise<ClubResult> {
  if (!id.safeParse(membershipId).success) return { ok: false, code: 'VALIDATION' }
  const supabase = await createClient()
  const result = read(
    (
      await supabase.rpc('decide_join_request', {
        p_membership_id: membershipId,
        p_approve: approve,
      })
    ).data,
  )
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }
  revalidatePath('/trener/vice/zadosti')
  revalidatePath('/trener/vice')
  return { ok: true }
}

/** `Požádat znovu` after a rejection. */
export async function requestJoinAgain(membershipId: string): Promise<ClubResult> {
  if (!id.safeParse(membershipId).success) return { ok: false, code: 'VALIDATION' }
  const supabase = await createClient()
  const result = read(
    (await supabase.rpc('request_join_again', { p_membership_id: membershipId })).data,
  )
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }
  revalidatePath('/moji-sportovci')
  return { ok: true }
}

const inviteSchema = z.object({
  email: z.email(),
  athleteIds: z.array(z.uuid()).min(1).max(20),
})

/**
 * `Pozvat dalšího rodiče` (PRD §6). Recorded first, then e-mailed: an
 * invitation that exists but whose e-mail failed can be sent again by
 * inviting again; one e-mailed but not recorded would be a link to nothing.
 */
export async function inviteGuardian(email: string, athleteIds: string[]): Promise<ClubResult> {
  const parsed = inviteSchema.safeParse({ email: email.trim().toLowerCase(), athleteIds })
  if (!parsed.success) return { ok: false, code: 'INVALID_EMAIL' }

  const supabase = await createClient()
  const result = read(
    (
      await supabase.rpc('invite_guardian', {
        p_email: parsed.data.email,
        p_athlete_ids: parsed.data.athleteIds,
      })
    ).data,
  )
  if (!result.ok || !result.data) return { ok: false, code: result.code ?? 'generic' }

  const data = result.data as {
    email: string
    inviter_name: string | null
    athlete_names: string[] | null
    organization_name: string | null
    organization_logo_path: string | null
  }

  const sent = await emailProvider().send(
    composeGuardianInvitationEmail(
      {
        email: data.email,
        inviterName: data.inviter_name,
        athleteNames: data.athlete_names ?? [],
        organizationName: data.organization_name ?? '',
        organizationLogoUrl: logoUrl(
          publicEnv.NEXT_PUBLIC_SUPABASE_URL,
          data.organization_logo_path ?? null,
        ),
      },
      publicEnv.NEXT_PUBLIC_SITE_URL,
    ),
  )
  if (!sent.ok) return { ok: false, code: 'SEND_FAILED' }

  revalidatePath('/moji-sportovci')
  return { ok: true }
}

export async function revokeGuardianInvitation(invitationId: string): Promise<ClubResult> {
  if (!id.safeParse(invitationId).success) return { ok: false, code: 'VALIDATION' }
  const supabase = await createClient()
  const result = read(
    (await supabase.rpc('revoke_guardian_invitation', { p_invitation_id: invitationId })).data,
  )
  if (!result.ok) return { ok: false, code: result.code ?? 'generic' }
  revalidatePath('/moji-sportovci')
  return { ok: true }
}
