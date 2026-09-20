-- Trainlio — Sports Training Booking Platform
-- Layer: DATABASE INVARIANTS (verification)
-- 18 — the occupancy reconciliation assert
--
-- The occupancy projection is the load-bearing piece of the whole booking
-- design: it is what a guardian reads instead of other families' bookings
-- (BR-090), what Realtime publishes (S-P2), and what every booking path locks
-- to serialize (AC-022). It is maintained by trigger, so it can in principle
-- drift from the bookings it summarises — and a drift is silent. Too low, and a
-- session refuses parents while places remain; too high, and a coach arrives to
-- more children than the roster promised.
--
-- Nothing here changes behaviour. This exists to be run: by the validation
-- suite after every scenario, and by an operator against production.

create or replace function public.occupancy_reconciliation()
returns table (
  training_session_id uuid,
  projected           integer,
  actual              bigint,
  drift               bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.training_session_id,
    o.confirmed_count,
    count(b.id),
    count(b.id) - o.confirmed_count
  from public.training_session_occupancy o
  left join public.bookings b
    on b.training_session_id = o.training_session_id
   and b.status = 'CONFIRMED'
  group by o.training_session_id, o.confirmed_count
  having count(b.id) <> o.confirmed_count;
$$;

comment on function public.occupancy_reconciliation() is
  'Sessions whose occupancy projection disagrees with a recount of their CONFIRMED bookings. An empty result is the invariant holding. Read-only: it reports drift, it does not repair it, because a silent repair would erase the evidence of how the drift happened.';

-- ---------------------------------------------------------------------------
-- Every session must have exactly one projection row.
--
-- A missing row is the other way the projection can be wrong, and
-- occupancy_reconciliation above cannot see it: it starts from the projection,
-- so a session with no row produces no output at all. A missing row is worse
-- than a wrong count, because SELECT ... FOR UPDATE on a row that does not
-- exist locks nothing and the booking functions silently lose their
-- serialization point.
-- ---------------------------------------------------------------------------

create or replace function public.sessions_without_occupancy()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.training_sessions s
  left join public.training_session_occupancy o on o.training_session_id = s.id
  where o.training_session_id is null;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.occupancy_reconciliation()',
    'public.sessions_without_occupancy()'
  ]
  loop
    -- Operational verification, not a client feature. A guardian reading this
    -- would learn every session's exact booking count across the workspace.
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
