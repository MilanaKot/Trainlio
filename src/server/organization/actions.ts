'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { LOGO_BUCKET, STORED_LOGO_TYPE, checkStoredLogo, logoPath } from '@/lib/domain/logo'
import type { LogoBackground } from '@/lib/domain/org'

/**
 * The club's name and mark (admin/SPEC.md §A4, migration 30).
 *
 * An administrator holds no UPDATE grant on `workspaces`: that row also
 * carries the timezone and the cancellation deadline, and the person who may
 * rename the club has no business writing next to those. Both halves go
 * through domain functions that check the role themselves, so a request built
 * by hand is refused by the database rather than by this file.
 *
 * One save rather than two. The spec allows either; this one uploads the
 * cropped mark and commits it in the same action that saves the name, so a
 * sheet closed without pressing Uložit leaves nothing behind in the bucket.
 */

export type OrganizationResult =
  { ok: true } | { ok: false; code: string; field?: 'name' | 'shortName' | 'logo' | undefined }

type RpcResult = { ok?: boolean; code?: string }

function readRpc(value: unknown): RpcResult {
  if (typeof value !== 'object' || value === null) return { ok: false, code: 'generic' }
  return value as RpcResult
}

function refresh() {
  revalidatePath('/trener/vice/organizace')
  // The club's name and mark are in the coach's header, the parent's list
  // header, and above the e-mail field on the sign-in screen.
  revalidatePath('/trener')
  revalidatePath('/treninky')
  revalidatePath('/prihlaseni')
}

const NAME_FIELDS: Record<string, 'name' | 'shortName'> = {
  NAME_REQUIRED: 'name',
  NAME_TOO_LONG: 'name',
  SHORT_NAME_TOO_LONG: 'shortName',
}

export async function saveOrganization(input: {
  workspaceId: string
  name: string
  shortName: string
  logoBackground: LogoBackground
  /** The 512px PNG the adjust sheet produced, when the mark is being changed. */
  logo: File | null
  removeLogo: boolean
}): Promise<OrganizationResult> {
  const supabase = await createClient()

  // What is there now, so a background-only change keeps the file and a
  // replaced mark can have its predecessor removed afterwards.
  const { data: current } = await supabase
    .from('workspaces')
    .select('logo_path')
    .eq('id', input.workspaceId)
    .maybeSingle()

  const previousPath = current?.logo_path ?? null

  const identity = await supabase.rpc('set_workspace_identity', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_short_name: input.shortName,
  })

  if (identity.error) return { ok: false, code: 'generic' }
  const named = readRpc(identity.data)
  if (!named.ok) {
    const code = named.code ?? 'generic'
    return { ok: false, code, ...(NAME_FIELDS[code] ? { field: NAME_FIELDS[code] } : {}) }
  }

  let uploadedPath: string | null = null

  if (input.logo && input.logo.size > 0) {
    const bytes = new Uint8Array(await input.logo.arrayBuffer())
    // The browser cropped this to a 512px PNG; that claim is checked against
    // the bytes here, because the browser is not what this has to be true of.
    const rejection = checkStoredLogo(input.logo, bytes)
    if (rejection) return { ok: false, code: rejection, field: 'logo' }

    uploadedPath = logoPath(input.workspaceId, crypto.randomUUID())
    const uploaded = await supabase.storage.from(LOGO_BUCKET).upload(uploadedPath, bytes, {
      contentType: STORED_LOGO_TYPE,
      // A fresh name each time, so nothing is ever overwritten and no cache can
      // serve the previous emblem.
      upsert: false,
    })
    if (uploaded.error) return { ok: false, code: 'LOGO_UPLOAD_FAILED', field: 'logo' }
  }

  const keptPath = input.removeLogo ? null : (uploadedPath ?? previousPath)

  const logo = await supabase.rpc('set_workspace_logo', {
    p_workspace_id: input.workspaceId,
    ...(keptPath ? { p_logo_path: keptPath } : {}),
    p_logo_background: input.logoBackground,
  })

  const stored = readRpc(logo.data)
  if (logo.error || !stored.ok) {
    // Nothing half-uploaded is left in a public bucket.
    if (uploadedPath) await supabase.storage.from(LOGO_BUCKET).remove([uploadedPath])
    return { ok: false, code: stored.code ?? 'generic', field: 'logo' }
  }

  // Only once the row no longer points at it. A failed delete costs an orphan
  // object, which is cheaper than a live page pointing at nothing.
  if (previousPath && previousPath !== keptPath) {
    await supabase.storage.from(LOGO_BUCKET).remove([previousPath])
  }

  refresh()
  return { ok: true }
}
