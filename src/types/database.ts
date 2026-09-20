/**
 * Database types.
 *
 * `database.generated.ts` is produced from the migrations and must not be
 * edited by hand. Regenerate it after any migration:
 *
 *   pnpm db:types            # against the local Supabase stack
 *
 * This module re-exports it, plus the aliases application code actually uses,
 * so call sites read as `Tables<'bookings'>` rather than as a four-level index
 * into a generated tree.
 */
import type { Database } from '@/types/database.generated'

export type { Database }

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// The domain enums, so application code never restates a value the database
// owns. A new hockey position is added in one place: a migration.
export type SessionStatus = Enums<'session_status'>
export type BookingStatus = Enums<'booking_status'>
export type BookingCreatorRole = Enums<'booking_creator_role'>
export type EligibilityMode = Enums<'eligibility_mode'>
export type WorkspaceRole = Enums<'workspace_role'>
export type CoachSessionRole = Enums<'coach_session_role'>
export type AccessStatus = Enums<'access_status'>
export type AccessPermissionLevel = Enums<'access_permission_level'>
export type FacilityType = Enums<'facility_type'>
export type NotificationDeliveryStatus = Enums<'notification_delivery_status'>
