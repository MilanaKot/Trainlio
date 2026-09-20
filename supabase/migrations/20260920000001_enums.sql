-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS
-- 01 — extensions and enumerated types
--
-- Reviewed proposal for Phase 1. Promoted to supabase/migrations/ on approval.
--
-- All enum values are stable internal codes. Czech labels are resolved in the
-- application i18n layer and are never stored as business data (PRD §21).

-- Extensions live in their own schema, not public: anything in public joins the
-- search path of every query, which is the shadowing risk that the pinned
-- search_path on every function exists to prevent. This matches how Supabase
-- provisions a project, where the schema and pgcrypto already exist.
create schema if not exists extensions;
grant usage on schema extensions to postgres, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- D-17: workspace-scoped staff roles. Deliberately excludes any guardian value —
-- guardian authorization runs through athlete access and workspace athlete
-- membership, never through a staff role. Platform administration is a separate
-- table and is never inferred from workspace membership.
create type public.workspace_role as enum ('COACH', 'WORKSPACE_ADMIN');

create type public.access_status as enum ('ACTIVE', 'INVITED', 'REVOKED');

create type public.access_permission_level as enum ('MANAGE', 'VIEW');

create type public.session_status as enum ('DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED');

create type public.booking_status as enum ('CONFIRMED', 'CANCELLED_BY_USER', 'CANCELLED_BY_COACH');

-- Mirrors the role under which the creating operation ran. Fixed by the entry
-- point, never inferred from the caller's memberships (D-14).
create type public.booking_creator_role as enum
  ('USER', 'COACH', 'WORKSPACE_ADMIN', 'PLATFORM_ADMIN');

create type public.eligibility_mode as enum ('ALL', 'BIRTH_YEAR_RANGE');

create type public.coach_session_role as enum ('MAIN', 'ASSISTANT');

create type public.facility_type as enum ('RINK', 'PITCH', 'COURT', 'POOL', 'LANE', 'GYM', 'ROOM', 'OTHER');

-- MVP generates weekly series only. The enum exists so additional patterns do
-- not require a schema change (PRD §16). No calendar-style recurrence editing.
create type public.recurrence_frequency as enum ('WEEKLY');

create type public.notification_delivery_status as enum ('PENDING', 'SENDING', 'SENT', 'FAILED');
