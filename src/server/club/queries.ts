import 'server-only'

import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { publicEnv } from '@/lib/env'
import { rows } from '@/server/query-result'
import { toOrganization, type OrganizationWithSport } from '@/server/organization/queries'
import type { MembershipApproval } from '@/types/database'

/**
 * Joining a club by its link and the administrator's approval (migration 50,
 * D-39 to D-41). Every read goes through a function that answers one question
 * for one caller: the code itself is in a column no client role may read.
 */

/** `https://…/klub/D3RM83MF` — what the QR code says and what is shared. */
export function joinUrl(code: string): string {
  return `${publicEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')}/klub/${code}`
}

/** The club a link opens, for the landing page, with or without a session. */
export async function getJoinPreview(code: string): Promise<OrganizationWithSport | null> {
  const supabase = await createClient()
  const row = rows(
    'workspace_join_preview',
    await supabase.rpc('workspace_join_preview', { p_code: code }),
  )[0]
  if (!row) return null
  return { ...toOrganization(row), sportCode: row.sport_code }
}

export type JoinLink = {
  code: string
  url: string
  /** The QR code as an SVG document, drawn on the server. */
  qrSvg: string
  rotatedAt: string | null
}

/** `Přístup do klubu`: the administrator's own link; null for anyone else. */
export async function getJoinLink(workspaceId: string): Promise<JoinLink | null> {
  const supabase = await createClient()
  const { data } = await supabase.rpc('workspace_join_code', { p_workspace_id: workspaceId })
  const result = data as { ok?: boolean; data?: { code: string; rotated_at: string | null } } | null
  if (!result?.ok || !result.data) return null

  const url = joinUrl(result.data.code)
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { code: result.data.code, url, qrSvg, rotatedAt: result.data.rotated_at }
}

export type JoinRequest = {
  membershipId: string
  athleteId: string
  firstName: string
  lastName: string
  dateOfBirth: string
  positionCode: string | null
  approval: MembershipApproval
  requestedAt: string | null
  decidedAt: string | null
  guardians: { name: string | null; phone: string | null; email: string | null }[]
}

/** `Žádosti o přijetí`: who waits, then who was turned away. */
export async function listJoinRequests(workspaceId: string): Promise<JoinRequest[]> {
  const supabase = await createClient()
  return rows(
    'workspace_join_requests',
    await supabase.rpc('workspace_join_requests', { p_workspace_id: workspaceId }),
  ).map((row) => ({
    membershipId: row.membership_id,
    athleteId: row.athlete_id,
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    positionCode: row.position_code,
    approval: row.approval,
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    guardians: Array.isArray(row.guardians)
      ? (row.guardians as { name: string | null; phone: string | null; email: string | null }[])
      : [],
  }))
}

export type GuardianInvitation = {
  id: string
  email: string
  createdAt: string
  invitedByName: string | null
}

/** Open invitations to one child (G8). */
export async function listGuardianInvitations(athleteId: string): Promise<GuardianInvitation[]> {
  const supabase = await createClient()
  return rows(
    'athlete_guardian_invitations',
    await supabase.rpc('athlete_guardian_invitations', { p_athlete_id: athleteId }),
  ).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    invitedByName: row.invited_by_name,
  }))
}
