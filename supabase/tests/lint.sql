-- Trainlio — database lint
--
-- The rules the Supabase database linter enforces, written out so they can run
-- against any PostgreSQL instance, in CI, and before a project exists. Every
-- rule here corresponds to a real way this schema could be made unsafe by a
-- later change.
--
-- Each finding is prefixed ERROR or INFO.
--
--   ERROR — a security or correctness defect. CI fails. Must be zero.
--   INFO  — a performance advisory to weigh, not a defect.
--
-- The split matches how the Supabase linter grades its own rules, and it
-- matters here: blanket-indexing every foreign key would slow every insert to
-- speed up deletions that ON DELETE RESTRICT exists to refuse.
\set QUIET 1
\pset format unaligned
\pset tuples_only on

-- RLS disabled on an exposed table. The single most consequential omission:
-- PostgREST would serve every row of it to anyone with the anon key.
select 'ERROR rls_disabled_in_public: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- RLS enabled but no policy, on a table clients can reach. Denies everything,
-- which is correct for the outbox and audit tables and a bug anywhere else —
-- so this only reports tables that also carry a grant.
select 'ERROR rls_enabled_no_policy: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  and exists (
    select 1 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = c.relname
      and g.grantee in ('anon', 'authenticated')
  );

-- SECURITY DEFINER function without a pinned search_path. A privilege
-- escalation vector: an attacker-controlled schema earlier in the caller's
-- search_path can shadow an object the function body resolves.
select 'ERROR function_search_path_mutable: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
    where cfg like 'search_path=%'
  );

-- Any function of ours without a pinned search_path, definer or not. Trigger
-- functions run with the caller's path too. Extension-owned functions are
-- excluded: pinning them is not ours to do, and their placement is covered by
-- the extension rule below.
select 'ERROR function_search_path_unpinned: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and not p.prosecdef
  and p.prokind = 'f'
  and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
    where cfg like 'search_path=%'
  )
  and not exists (
    select 1 from pg_depend d
    where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
  );

-- An extension installed into public. Its functions join the search path of
-- every query, which is exactly the shadowing risk the pinned search_path rule
-- exists to prevent. Supabase installs extensions into `extensions`.
select 'ERROR extension_in_public: ' || e.extname
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where n.nspname = 'public';

-- SECURITY DEFINER function still carrying the PUBLIC execute default. Every
-- one of these is callable by the anon role unless revoked.
select 'ERROR definer_function_executable_by_public: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('public', p.oid, 'execute');

-- A policy that references auth.uid() directly instead of resolving the actor
-- through current_profile_id(). Would break attribution after a login is
-- severed (D-18).
select 'ERROR policy_uses_auth_uid_directly: ' || c.relname || '.' || p.polname
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (pg_get_expr(p.polqual, p.polrelid) like '%auth.uid()%'
       or pg_get_expr(p.polwithcheck, p.polrelid) like '%auth.uid()%');

-- A DELETE policy anywhere. Operational history is never hard-deleted, and the
-- absence of these policies is the enforcement mechanism.
select 'ERROR delete_policy_exists: ' || c.relname || '.' || p.polname
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and p.polcmd = 'd';

-- A DELETE grant to a client role, same reason.
select 'ERROR delete_granted_to_client: ' || g.table_name || ' -> ' || g.grantee
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.privilege_type = 'DELETE'
  and g.grantee in ('anon', 'authenticated');

-- A write grant on bookings or training_sessions. Mutations are RPC-only, so
-- that capacity, deadlines, the outbox and the audit trail cannot be bypassed.
select 'ERROR write_granted_on_rpc_only_table: ' || g.table_name || ' -> ' || g.grantee || ' (' || g.privilege_type || ')'
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.table_name in ('bookings', 'training_sessions', 'training_session_occupancy')
  and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  and g.grantee in ('anon', 'authenticated');

-- Any grant at all on the tables that hold email addresses or the audit trail.
select 'ERROR client_grant_on_restricted_table: ' || g.table_name || ' -> ' || g.grantee
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.table_name in ('notification_events', 'notification_deliveries', 'audit_log', 'platform_admins')
  and g.grantee in ('anon', 'authenticated');

-- Anything granted to anon. Every screen requires an authenticated session.
select 'ERROR grant_to_anon: ' || g.table_name || ' (' || g.privilege_type || ')'
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'anon';

-- A foreign key with no supporting index. Every one of these sits on a join
-- that an RLS predicate walks on each request.
-- INFO. An unindexed foreign key costs a sequential scan when the parent row is
-- deleted. Every parent here is protected by ON DELETE RESTRICT and is never
-- deleted, so these are weighed individually rather than fixed in bulk: an
-- index that serves no query still slows every insert. Indexes that do serve a
-- query are in migration 05.
--
-- An index supports a foreign key when its leading key columns are exactly the
-- constraint's columns, in order. A partial index does not count: it cannot
-- serve the referential integrity check for rows outside its predicate.
select 'INFO  unindexed_foreign_key: ' || c.relname || '.' || con.conname
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and con.contype = 'f'
  and not exists (
    select 1
    from pg_index i
    where i.indrelid = con.conrelid
      and i.indpred is null
      and i.indnkeyatts >= cardinality(con.conkey)
      -- indkey casts to an array with lower bound 0, so the leading N columns
      -- are the slice [0 : N-1], not [1 : N].
      and (
        select array_agg(k order by ord)
        from unnest((i.indkey::int2[])[0:cardinality(con.conkey) - 1]) with ordinality t(k, ord)
      ) = con.conkey
  );

-- A table exposed to clients with no primary key.
select 'ERROR no_primary_key: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p');

-- bookings must never be in the Realtime publication: row level security means
-- a guardian could not receive those events anyway, and publishing them is the
-- mistake that would leak one family's activity to another.
select 'ERROR bookings_in_realtime_publication'
where exists (
  select 1 from pg_publication_tables t
  where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename = 'bookings'
);

-- ---------------------------------------------------------------------------
-- Further security rules from the Supabase linter.
-- ---------------------------------------------------------------------------

-- A view owned by a privileged role runs with that role's rights, bypassing the
-- policies of every table it reads.
select 'ERROR security_definer_view: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and (pg_catalog.pg_get_viewdef(c.oid) is not null)
  and coalesce((select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'true';

-- Anything in public that exposes auth.users. Emails would become readable
-- through PostgREST by anyone the view's grants allow.
select 'ERROR auth_users_exposed: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
  and pg_catalog.pg_get_viewdef(c.oid) like '%auth.users%';

-- Policies on a table with RLS switched off are inert and give false assurance.
select 'ERROR policy_exists_rls_disabled: ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not c.relrowsecurity
  and exists (select 1 from pg_policy p where p.polrelid = c.oid);

-- A policy reading user_metadata. That field is editable by the user it
-- describes, so authorizing on it lets anyone grant themselves anything.
select 'ERROR rls_references_user_metadata: ' || c.relname || '.' || p.polname
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (pg_get_expr(p.polqual, p.polrelid) like '%user_metadata%'
       or pg_get_expr(p.polwithcheck, p.polrelid) like '%user_metadata%');

-- A SECURITY DEFINER function granted to anon. It would run with the owner's
-- rights for an unauthenticated caller.
select 'ERROR definer_function_granted_to_anon: ' || p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute');

-- INFO. Several permissive policies for the same role and command are all
-- evaluated on every row.
select 'INFO  multiple_permissive_policies: ' || c.relname || ' (' || p.polcmd::text || ', ' || count(*) || ')'
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and p.polpermissive
group by c.relname, p.polcmd
having count(*) > 1;
