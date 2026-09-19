export const SESSION_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const ELIGIBILITY_MODES = ['ALL', 'BIRTH_YEAR_RANGE'] as const
export type EligibilityMode = (typeof ELIGIBILITY_MODES)[number]

export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED_BY_USER', 'CANCELLED_BY_COACH'] as const
export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const WORKSPACE_ROLES = ['COACH', 'WORKSPACE_ADMIN'] as const
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

/** Error codes returned by the domain functions (DOMAIN_OPERATIONS.md). */
export const DOMAIN_ERROR_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'NOT_AUTHORIZED_FOR_ATHLETE',
  'SESSION_NOT_FOUND',
  'SESSION_NOT_OPEN',
  'SESSION_ALREADY_STARTED',
  'SESSION_CANCELLED',
  'NOT_ELIGIBLE',
  'ALREADY_BOOKED',
  'REMOVED_BY_COACH',
  'INSUFFICIENT_CAPACITY',
  'DUPLICATE_ATHLETE_IN_REQUEST',
  'EMPTY_SELECTION',
  'BOOKING_NOT_FOUND',
  'BOOKING_NOT_CONFIRMED',
  'CANCELLATION_DEADLINE_PASSED',
  'CAPACITY_BELOW_OCCUPANCY',
  'BOOKINGS_WOULD_BECOME_INELIGIBLE',
  'SERIES_EMPTY',
] as const
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]
