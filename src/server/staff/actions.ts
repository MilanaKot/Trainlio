'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

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
  | { ok: true; displayName?: string | undefined }
  | { ok: false; code: string; futureSessions?: number | undefined }

type RpcResult = {
  ok?: boolean
  code?: string
  display_name?: string | null
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
): Promise<StaffResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_workspace_coach', {
    p_workspace_id: workspaceId,
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
