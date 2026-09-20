export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_profiles: {
        Row: {
          anonymized_at: string | null
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      athlete_sport_profiles: {
        Row: {
          athlete_id: string
          attributes: Json
          club_name: string | null
          created_at: string
          id: string
          is_active: boolean
          jersey_number: string | null
          sport_id: string
          team_or_category: string | null
          updated_at: string
        }
        Insert: {
          athlete_id: string
          attributes?: Json
          club_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jersey_number?: string | null
          sport_id: string
          team_or_category?: string | null
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          attributes?: Json
          club_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          jersey_number?: string | null
          sport_id?: string
          team_or_category?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_sport_profiles_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_sport_profiles_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          created_at: string
          date_of_birth: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          photo_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_of_birth: string
          first_name: string
          id?: string
          is_active?: boolean
          last_name: string
          photo_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          photo_path?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_profile_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: number
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_profile_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_profile_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          athlete_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          coach_capacity_override: boolean
          created_at: string
          created_by: string
          created_by_role: Database["public"]["Enums"]["booking_creator_role"]
          eligibility_narrowed_at: string | null
          id: string
          status: Database["public"]["Enums"]["booking_status"]
          training_session_id: string
          updated_at: string
        }
        Insert: {
          athlete_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coach_capacity_override?: boolean
          created_at?: string
          created_by: string
          created_by_role: Database["public"]["Enums"]["booking_creator_role"]
          eligibility_narrowed_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          training_session_id: string
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          coach_capacity_override?: boolean
          created_at?: string
          created_by?: string
          created_by_role?: Database["public"]["Enums"]["booking_creator_role"]
          eligibility_narrowed_at?: string | null
          id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          training_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          code: string
          created_at: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          id: string
          is_active: boolean
          location_id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          id?: string
          is_active?: boolean
          location_id: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          facility_type?: Database["public"]["Enums"]["facility_type"]
          id?: string
          is_active?: boolean
          location_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_athlete_access: {
        Row: {
          athlete_id: string
          created_at: string
          id: string
          invited_by: string | null
          permission_level: Database["public"]["Enums"]["access_permission_level"]
          profile_id: string
          relationship_code: string
          status: Database["public"]["Enums"]["access_status"]
          updated_at: string
        }
        Insert: {
          athlete_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          permission_level?: Database["public"]["Enums"]["access_permission_level"]
          profile_id: string
          relationship_code?: string
          status?: Database["public"]["Enums"]["access_status"]
          updated_at?: string
        }
        Update: {
          athlete_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          permission_level?: Database["public"]["Enums"]["access_permission_level"]
          profile_id?: string
          relationship_code?: string
          status?: Database["public"]["Enums"]["access_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_athlete_access_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_athlete_access_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_athlete_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          event_id: string
          id: string
          last_error: string | null
          payload: Json
          provider_message_id: string | null
          recipient_email: string | null
          recipient_profile_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_delivery_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          event_id: string
          id?: string
          last_error?: string | null
          payload?: Json
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_profile_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          event_id?: string
          id?: string
          last_error?: string | null
          payload?: Json
          provider_message_id?: string | null
          recipient_email?: string | null
          recipient_profile_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          created_at: string
          dispatched_at: string | null
          event_type: string
          id: string
          payload: Json
          training_session_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dispatched_at?: string | null
          event_type: string
          id?: string
          payload?: Json
          training_session_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          dispatched_at?: string | null
          event_type?: string
          id?: string
          payload?: Json
          training_session_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          profile_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          profile_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_admins_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_series: {
        Row: {
          birth_year_from: number | null
          birth_year_to: number | null
          by_weekday: number
          capacity: number
          changing_room: string | null
          created_at: string
          created_by: string
          eligibility_mode: Database["public"]["Enums"]["eligibility_mode"]
          facility_id: string
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generated_at: string | null
          generated_count: number
          generated_in_timezone: string
          id: string
          internal_notes: string | null
          local_date_from: string
          local_date_to: string
          local_end_time: string
          local_start_time: string
          location_id: string
          main_coach_profile_id: string
          public_notes: string | null
          sport_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          birth_year_from?: number | null
          birth_year_to?: number | null
          by_weekday: number
          capacity?: number
          changing_room?: string | null
          created_at?: string
          created_by: string
          eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          facility_id: string
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generated_at?: string | null
          generated_count?: number
          generated_in_timezone: string
          id?: string
          internal_notes?: string | null
          local_date_from: string
          local_date_to: string
          local_end_time: string
          local_start_time: string
          location_id: string
          main_coach_profile_id: string
          public_notes?: string | null
          sport_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          birth_year_from?: number | null
          birth_year_to?: number | null
          by_weekday?: number
          capacity?: number
          changing_room?: string | null
          created_at?: string
          created_by?: string
          eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          facility_id?: string
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generated_at?: string | null
          generated_count?: number
          generated_in_timezone?: string
          id?: string
          internal_notes?: string | null
          local_date_from?: string
          local_date_to?: string
          local_end_time?: string
          local_start_time?: string
          location_id?: string
          main_coach_profile_id?: string
          public_notes?: string | null
          sport_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_series_facility_at_location"
            columns: ["facility_id", "location_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id", "location_id"]
          },
          {
            foreignKeyName: "session_series_location_in_workspace"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "session_series_main_coach_profile_id_fkey"
            columns: ["main_coach_profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_series_sport_matches_workspace"
            columns: ["workspace_id", "sport_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "primary_sport_id"]
          },
          {
            foreignKeyName: "session_series_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sports: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      training_session_coaches: {
        Row: {
          created_at: string
          profile_id: string
          role: Database["public"]["Enums"]["coach_session_role"]
          training_session_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          role: Database["public"]["Enums"]["coach_session_role"]
          training_session_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["coach_session_role"]
          training_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_session_coaches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_coaches_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      training_session_internal_notes: {
        Row: {
          notes: string | null
          training_session_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          notes?: string | null
          training_session_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          notes?: string | null
          training_session_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_session_internal_notes_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: true
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_session_internal_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      training_session_occupancy: {
        Row: {
          confirmed_count: number
          training_session_id: string
          updated_at: string
        }
        Insert: {
          confirmed_count?: number
          training_session_id: string
          updated_at?: string
        }
        Update: {
          confirmed_count?: number
          training_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_session_occupancy_training_session_id_fkey"
            columns: ["training_session_id"]
            isOneToOne: true
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      training_sessions: {
        Row: {
          birth_year_from: number | null
          birth_year_to: number | null
          cancelled_at: string | null
          cancelled_by: string | null
          capacity: number
          changing_room: string | null
          created_at: string
          created_by: string
          eligibility_mode: Database["public"]["Enums"]["eligibility_mode"]
          end_at: string
          facility_id: string
          id: string
          location_id: string
          main_coach_profile_id: string
          public_notes: string | null
          series_id: string | null
          significant_changed_at: string | null
          sport_id: string
          start_at: string
          status: Database["public"]["Enums"]["session_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          birth_year_from?: number | null
          birth_year_to?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          capacity?: number
          changing_room?: string | null
          created_at?: string
          created_by: string
          eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          end_at: string
          facility_id: string
          id?: string
          location_id: string
          main_coach_profile_id: string
          public_notes?: string | null
          series_id?: string | null
          significant_changed_at?: string | null
          sport_id: string
          start_at: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          birth_year_from?: number | null
          birth_year_to?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          capacity?: number
          changing_room?: string | null
          created_at?: string
          created_by?: string
          eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          end_at?: string
          facility_id?: string
          id?: string
          location_id?: string
          main_coach_profile_id?: string
          public_notes?: string | null
          series_id?: string | null
          significant_changed_at?: string | null
          sport_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_facility_at_location"
            columns: ["facility_id", "location_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id", "location_id"]
          },
          {
            foreignKeyName: "training_sessions_location_in_workspace"
            columns: ["location_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "training_sessions_main_coach_profile_id_fkey"
            columns: ["main_coach_profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "session_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_sessions_sport_matches_workspace"
            columns: ["workspace_id", "sport_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "primary_sport_id"]
          },
          {
            foreignKeyName: "training_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_athlete_memberships: {
        Row: {
          athlete_id: string
          athlete_sport_profile_id: string
          created_at: string
          id: string
          is_active: boolean
          sport_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          athlete_id: string
          athlete_sport_profile_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          sport_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          athlete_id?: string
          athlete_sport_profile_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          sport_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wam_profile_belongs_to_athlete"
            columns: ["athlete_sport_profile_id", "athlete_id"]
            isOneToOne: false
            referencedRelation: "athlete_sport_profiles"
            referencedColumns: ["id", "athlete_id"]
          },
          {
            foreignKeyName: "wam_profile_sport_matches"
            columns: ["athlete_sport_profile_id", "sport_id"]
            isOneToOne: false
            referencedRelation: "athlete_sport_profiles"
            referencedColumns: ["id", "sport_id"]
          },
          {
            foreignKeyName: "wam_workspace_sport_matches"
            columns: ["workspace_id", "sport_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id", "primary_sport_id"]
          },
          {
            foreignKeyName: "workspace_athlete_memberships_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          profile_id: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          profile_id: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          profile_id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "app_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          cancellation_deadline_hours: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          primary_sport_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          cancellation_deadline_hours?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          primary_sport_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          cancellation_deadline_hours?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          primary_sport_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_primary_sport_id_fkey"
            columns: ["primary_sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_profile_is_workspace_staff: {
        Args: { p_profile_id: string; p_workspace_id: string }
        Returns: undefined
      }
      athlete_eligibility_for_session: {
        Args: { p_athlete_id: string; p_training_session_id: string }
        Returns: string
      }
      book_athlete_as_coach: {
        Args: {
          p_athlete_id: string
          p_confirm_over_capacity?: boolean
          p_training_session_id: string
        }
        Returns: Json
      }
      book_athletes_as_guardian: {
        Args: { p_athlete_ids: string[]; p_training_session_id: string }
        Returns: Json
      }
      bookings_outside_birth_year_range: {
        Args: {
          p_birth_year_from: number
          p_birth_year_to: number
          p_training_session_id: string
        }
        Returns: string[]
      }
      cancel_booking_as_coach: {
        Args: { p_booking_id: string; p_reason?: string }
        Returns: Json
      }
      cancel_booking_as_guardian: {
        Args: { p_booking_id: string }
        Returns: Json
      }
      cancel_training_session: {
        Args: { p_reason?: string; p_training_session_id: string }
        Returns: Json
      }
      coach_can_see_athlete: {
        Args: { p_athlete_id: string }
        Returns: boolean
      }
      coach_session_candidates: {
        Args: { p_training_session_id: string }
        Returns: {
          athlete_id: string
          birth_year: number
          booking_status: Database["public"]["Enums"]["booking_status"]
          can_add: boolean
          eligibility: string
          first_name: string
          last_name: string
          position_code: string
        }[]
      }
      create_athlete_with_guardian: {
        Args: {
          p_attributes?: Json
          p_club_name?: string
          p_date_of_birth: string
          p_first_name: string
          p_jersey_number?: string
          p_last_name: string
          p_sport_code: string
          p_team_or_category?: string
          p_workspace_id: string
        }
        Returns: Json
      }
      create_session_series: {
        Args: {
          p_birth_year_from?: number
          p_birth_year_to?: number
          p_by_weekday: number
          p_capacity?: number
          p_changing_room?: string
          p_eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          p_facility_id: string
          p_internal_notes?: string
          p_local_date_from: string
          p_local_date_to: string
          p_local_end_time: string
          p_local_start_time: string
          p_main_coach_profile_id?: string
          p_public_notes?: string
          p_status?: Database["public"]["Enums"]["session_status"]
          p_workspace_id: string
        }
        Returns: Json
      }
      create_training_session: {
        Args: {
          p_birth_year_from?: number
          p_birth_year_to?: number
          p_capacity?: number
          p_changing_room?: string
          p_eligibility_mode?: Database["public"]["Enums"]["eligibility_mode"]
          p_facility_id: string
          p_internal_notes?: string
          p_local_date: string
          p_local_end_time: string
          p_local_start_time: string
          p_main_coach_profile_id?: string
          p_public_notes?: string
          p_status?: Database["public"]["Enums"]["session_status"]
          p_workspace_id: string
        }
        Returns: Json
      }
      current_profile_id: { Args: never; Returns: string }
      duplicate_training_session: {
        Args: {
          p_local_date: string
          p_local_end_time?: string
          p_local_start_time?: string
          p_status?: Database["public"]["Enums"]["session_status"]
          p_training_session_id: string
        }
        Returns: Json
      }
      ensure_current_profile: { Args: never; Returns: string }
      facility_location_for_workspace: {
        Args: { p_facility_id: string; p_workspace_id: string }
        Returns: string
      }
      guardian_can_see_workspace: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      guardian_rebooking_blocked: {
        Args: { p_athlete_id: string; p_training_session_id: string }
        Returns: boolean
      }
      guardian_session_athletes: {
        Args: { p_training_session_id: string }
        Returns: {
          athlete_id: string
          booking_status: Database["public"]["Enums"]["booking_status"]
          can_book: boolean
          date_of_birth: string
          eligibility: string
          first_name: string
          last_name: string
          removed_by_coach: boolean
        }[]
      }
      has_athlete_access: { Args: { p_athlete_id: string }; Returns: boolean }
      has_athlete_manage_access: {
        Args: { p_athlete_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_visible_staff_profile: {
        Args: { p_profile_id: string }
        Returns: boolean
      }
      is_workspace_admin: { Args: { p_workspace_id: string }; Returns: boolean }
      is_workspace_coach: { Args: { p_workspace_id: string }; Returns: boolean }
      is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      joinable_workspaces: {
        Args: never
        Returns: {
          id: string
          name: string
          primary_sport_id: string
          sport_code: string
          timezone: string
        }[]
      }
      session_confirmed_count: {
        Args: { p_training_session_id: string }
        Returns: number
      }
      session_roster: {
        Args: { p_training_session_id: string }
        Returns: {
          athlete_id: string
          birth_year: number
          booked_at: string
          booked_by_name: string
          booking_id: string
          cancellation_reason: string
          cancelled_at: string
          capacity_override: boolean
          club_name: string
          created_by_role: Database["public"]["Enums"]["booking_creator_role"]
          first_name: string
          jersey_number: string
          last_name: string
          position_code: string
          status: Database["public"]["Enums"]["booking_status"]
          stick_side_code: string
        }[]
      }
      set_session_booking_state: {
        Args: { p_open: boolean; p_training_session_id: string }
        Returns: Json
      }
      update_training_session: {
        Args: {
          p_birth_year_from?: number
          p_birth_year_to?: number
          p_capacity: number
          p_changing_room?: string
          p_confirm_ineligible_bookings?: boolean
          p_confirm_over_capacity?: boolean
          p_eligibility_mode: Database["public"]["Enums"]["eligibility_mode"]
          p_facility_id: string
          p_internal_notes?: string
          p_local_date: string
          p_local_end_time: string
          p_local_start_time: string
          p_main_coach_profile_id?: string
          p_public_notes?: string
          p_training_session_id: string
        }
        Returns: Json
      }
      upsert_athlete_sport_profile: {
        Args: {
          p_athlete_id: string
          p_attributes?: Json
          p_club_name?: string
          p_jersey_number?: string
          p_sport_code: string
          p_team_or_category?: string
          p_workspace_id?: string
        }
        Returns: Json
      }
      weekly_occurrence_dates: {
        Args: {
          p_by_weekday: number
          p_local_date_from: string
          p_local_date_to: string
        }
        Returns: string[]
      }
    }
    Enums: {
      access_permission_level: "MANAGE" | "VIEW"
      access_status: "ACTIVE" | "INVITED" | "REVOKED"
      booking_creator_role:
        | "USER"
        | "COACH"
        | "WORKSPACE_ADMIN"
        | "PLATFORM_ADMIN"
      booking_status: "CONFIRMED" | "CANCELLED_BY_USER" | "CANCELLED_BY_COACH"
      coach_session_role: "MAIN" | "ASSISTANT"
      eligibility_mode: "ALL" | "BIRTH_YEAR_RANGE"
      facility_type:
        | "RINK"
        | "PITCH"
        | "COURT"
        | "POOL"
        | "LANE"
        | "GYM"
        | "ROOM"
        | "OTHER"
      notification_delivery_status: "PENDING" | "SENDING" | "SENT" | "FAILED"
      recurrence_frequency: "WEEKLY"
      session_status: "DRAFT" | "OPEN" | "CLOSED" | "COMPLETED" | "CANCELLED"
      workspace_role: "COACH" | "WORKSPACE_ADMIN"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_permission_level: ["MANAGE", "VIEW"],
      access_status: ["ACTIVE", "INVITED", "REVOKED"],
      booking_creator_role: [
        "USER",
        "COACH",
        "WORKSPACE_ADMIN",
        "PLATFORM_ADMIN",
      ],
      booking_status: ["CONFIRMED", "CANCELLED_BY_USER", "CANCELLED_BY_COACH"],
      coach_session_role: ["MAIN", "ASSISTANT"],
      eligibility_mode: ["ALL", "BIRTH_YEAR_RANGE"],
      facility_type: [
        "RINK",
        "PITCH",
        "COURT",
        "POOL",
        "LANE",
        "GYM",
        "ROOM",
        "OTHER",
      ],
      notification_delivery_status: ["PENDING", "SENDING", "SENT", "FAILED"],
      recurrence_frequency: ["WEEKLY"],
      session_status: ["DRAFT", "OPEN", "CLOSED", "COMPLETED", "CANCELLED"],
      workspace_role: ["COACH", "WORKSPACE_ADMIN"],
    },
  },
} as const

