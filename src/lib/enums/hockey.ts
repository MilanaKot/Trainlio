/**
 * Hockey sport-profile enums.
 *
 * The codes are the stable values stored in
 * `athlete_sport_profiles.attributes` and validated by database trigger. The
 * Czech labels live only here.
 */
export const HOCKEY_POSITIONS = [
  'GOALIE',
  'DEFENSE',
  'CENTER',
  'LEFT_WING',
  'RIGHT_WING',
  'UTILITY',
] as const

export type HockeyPosition = (typeof HOCKEY_POSITIONS)[number]

export const HOCKEY_POSITION_LABELS: Record<HockeyPosition, string> = {
  GOALIE: 'Brankář',
  DEFENSE: 'Obránce',
  CENTER: 'Centr',
  LEFT_WING: 'Levé křídlo',
  RIGHT_WING: 'Pravé křídlo',
  UTILITY: 'Univerzál',
}

export const STICK_SIDES = ['LEFT', 'RIGHT', 'UNKNOWN'] as const

export type StickSide = (typeof STICK_SIDES)[number]

export const STICK_SIDE_LABELS: Record<StickSide, string> = {
  LEFT: 'Levé',
  RIGHT: 'Pravé',
  UNKNOWN: 'Nevím',
}
