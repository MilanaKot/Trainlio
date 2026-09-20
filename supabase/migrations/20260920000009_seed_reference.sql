-- Trainlio — Sports Training Booking Platform
-- 09 — reference seed for the MVP workspace
--
-- Idempotent. Contains no personal data and no fixtures.

insert into public.sports (code, name)
values ('HOCKEY', 'Lední hokej')
on conflict (code) do nothing;

insert into public.workspaces (name, primary_sport_id, timezone, cancellation_deadline_hours)
select 'Příbram — hokejový trénink',
       s.id,
       'Europe/Prague',        -- approved finding 2
       12                      -- MVP guardian cancellation deadline
from public.sports s
where s.code = 'HOCKEY'
  and not exists (select 1 from public.workspaces);

insert into public.locations (workspace_id, name)
select w.id, 'Příbram'
from public.workspaces w
where not exists (
  select 1 from public.locations l where l.workspace_id = w.id and l.name = 'Příbram'
);

insert into public.facilities (location_id, code, name, facility_type)
select l.id, v.code, v.name, 'RINK'::public.facility_type
from public.locations l
cross join (values ('MH', 'Malá hala'), ('VH', 'Velká hala')) as v(code, name)
where l.name = 'Příbram'
  and not exists (
    select 1 from public.facilities f where f.location_id = l.id and f.code = v.code
  );
