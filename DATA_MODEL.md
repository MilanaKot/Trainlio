# Data Model

## Design principle

The athlete identity is sport-independent.

Sport-specific attributes live in sport profiles.

Workspace membership is separate from sports club membership.

## Entity relationships

```text
USER
  |
  | M:N
  v
GUARDIAN_ATHLETE_ACCESS
  |
  v
ATHLETE
  |
  | 1:N
  v
ATHLETE_SPORT_PROFILE ----> SPORT
  |
  | M:N through workspace memberships
  v
WORKSPACE_ATHLETE_MEMBERSHIP ----> WORKSPACE
                                     |
                                     v
                              TRAINING_SESSION
                                     |
                                     v
                                  BOOKING
```

## users
Backed by Supabase Auth.

Application profile table:
- id UUID, FK auth.users
- display_name
- created_at
- updated_at

## user_roles
- user_id
- workspace_id nullable/global depending role model
- role: USER | COACH | ADMIN

A user may have multiple roles.

## athletes
- id UUID
- first_name
- last_name
- date_of_birth DATE
- photo_path nullable
- is_active boolean
- created_at
- updated_at

No hockey-specific columns.

## guardian_athlete_access
- id
- user_id
- athlete_id
- relationship_code
- permission_level
- status
- invited_by_user_id nullable
- created_at
- updated_at

Expected statuses:
- ACTIVE
- INVITED
- REVOKED

## sports
- id
- code unique
- name

Initial:
- HOCKEY

Future:
- FOOTBALL
- SWIMMING
- TENNIS
- etc.

## athlete_sport_profiles
- id
- athlete_id
- sport_id
- club_name nullable
- team_or_category nullable
- jersey_number nullable
- attributes JSONB
- is_active
- created_at
- updated_at

### Hockey attributes
```json
{
  "position": "CENTER",
  "stick_side": "LEFT"
}
```

Application validation must enforce allowed values.

## workspaces
- id
- name
- primary_sport_id
- status
- created_at
- updated_at

Current:
Příbram hockey coach workspace.

## workspace_members
For coach/admin membership:
- id
- workspace_id
- user_id
- member_role
- active

## workspace_athlete_memberships
- id
- workspace_id
- athlete_id
- athlete_sport_profile_id
- active
- created_at

One athlete may be a member of multiple workspaces.

## locations
- id
- workspace_id
- name
- address nullable
- active

Current:
Příbram.

## facilities
- id
- location_id
- code
- name
- facility_type
- active

Current:
- MH / Malá hala / RINK
- VH / Velká hala / RINK

Future facility types:
- RINK
- PITCH
- COURT
- POOL
- LANE
- GYM
- ROOM
- OTHER

## training_sessions
- id
- workspace_id
- sport_id
- location_id
- facility_id
- main_coach_user_id
- start_at timestamptz
- end_at timestamptz
- changing_room nullable
- capacity integer default 10
- eligibility_mode
- birth_year_from nullable
- birth_year_to nullable
- status
- notes nullable
- updated_marker boolean
- created_by_user_id
- created_at
- updated_at
- cancelled_at nullable
- cancelled_by_user_id nullable

Eligibility modes:
- ALL
- BIRTH_YEAR_RANGE

## training_session_coaches
- training_session_id
- user_id
- coach_role: MAIN | ASSISTANT

Main coach may be mirrored in training_sessions for simple querying, but association table is canonical for multiple coaches.

## bookings
- id
- training_session_id
- athlete_id
- status
- created_by_user_id
- created_by_role
- coach_capacity_override boolean
- created_at
- cancelled_at nullable
- cancelled_by_user_id nullable

Statuses:
- CONFIRMED
- CANCELLED_BY_USER
- CANCELLED_BY_COACH

A partial unique index must prevent more than one CONFIRMED booking for the same athlete/session.

## notification_events
Recommended for reliable email sending:
- id
- workspace_id
- training_session_id nullable
- event_type
- payload jsonb
- created_at

## notification_deliveries
- id
- event_id
- recipient_user_id
- recipient_email
- status
- provider_message_id nullable
- created_at
- sent_at nullable

This supports deduplication and audit.

## future tables
Not required for MVP:
- attendance
- payments
- waiting_list
- athlete_performance
- push_subscriptions
