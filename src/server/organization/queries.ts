import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logoUrl } from '@/lib/domain/logo'
import { publicEnv } from '@/lib/env'
import { isLogoBackground, type Organization } from '@/lib/domain/org'

/**
 * The club, as each side of the application is allowed to read it
 * (migration 30).
 *
 * Three callers, three routes to the same row, and the difference between them
 * is authorization rather than shape:
 *
 *   * the sign-in screen, where there is no session at all and the answer comes
 *     from a function written for exactly that;
 *   * the parent, through `joinable_workspaces()` — see athletes/queries.ts;
 *   * the administrator, who additionally needs to know whether they may change
 *     it, which the database answers with the same predicate the write uses.
 */

export type OrganizationWithSport = Organization & { sportCode: string }

type IdentityRow = {
  id: string
  name: string
  short_name: string | null
  sport_code: string
  logo_path: string | null
  logo_background: string
  logo_updated_at: string | null
}

export function toOrganization(row: {
  id: string
  name: string
  short_name: string | null
  logo_path: string | null
  logo_background: string
  logo_updated_at: string | null
}): Organization {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    logoUrl: logoUrl(publicEnv.NEXT_PUBLIC_SUPABASE_URL, row.logo_path, row.logo_updated_at),
    // A column constraint already allows only these two. Read defensively all
    // the same, because the alternative is an undrawable component.
    logoBackground: isLogoBackground(row.logo_background) ? row.logo_background : 'white',
  }
}

/**
 * The club shown above the e-mail field on the sign-in screen (G11).
 *
 * Null when the database declines to answer — with more than one active
 * workspace there is nothing in an anonymous request to say which club the
 * visitor came for, and the screen falls back to the product's own wordmark
 * rather than showing the wrong crest.
 */
export async function getPublicOrganization(): Promise<OrganizationWithSport | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('organization_identity')

  if (error || !data) return null
  const row = (data as unknown as IdentityRow[])[0]
  if (!row) return null

  return { ...toOrganization(row), sportCode: row.sport_code }
}

export type ManagedOrganization = OrganizationWithSport & {
  /** The database's own answer to "may this person change it" (D-17). */
  canEdit: boolean
}

/**
 * The club as its own staff sees it, for the administration screen.
 *
 * `canEdit` is `is_workspace_admin`, which is the predicate the storage policy
 * and both domain functions use. A coach who reached this screen would be shown
 * no controls, and would be refused by the database if they built the request
 * by hand.
 */
export async function getManagedOrganization(): Promise<ManagedOrganization | null> {
  const supabase = await createClient()

  const { data: membership } = await supabase
    .from('workspace_members')
    .select(
      'workspaces ( id, name, short_name, logo_path, logo_background, logo_updated_at, sports ( code ) )',
    )
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const workspace = membership?.workspaces
  if (!workspace) return null

  const { data: isAdmin } = await supabase.rpc('is_workspace_admin', {
    p_workspace_id: workspace.id,
  })

  return {
    ...toOrganization(workspace),
    sportCode: workspace.sports?.code ?? '',
    canEdit: isAdmin === true,
  }
}
