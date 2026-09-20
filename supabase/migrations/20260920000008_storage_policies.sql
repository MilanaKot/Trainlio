-- Trainlio — Sports Training Booking Platform
-- Layer: RLS AUTHORIZATION (storage)
-- 08 — private athlete photo bucket
--
-- A private bucket is not by itself authorization (S-R8): storage.objects needs
-- its own policies. Access is derived from the path, which is pinned by the
-- athletes_photo_path_scoped CHECK constraint to:
--
--     athletes/{athlete_id}/{filename}
--
-- so (storage.foldername(name))[2] is always the athlete id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'athlete-photos',
  'athlete-photos',
  false,                                        -- BR-093, AC-092
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy athlete_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'athlete-photos'
    and (
      public.has_athlete_access(((storage.foldername(name))[2])::uuid)
      or public.coach_can_see_athlete(((storage.foldername(name))[2])::uuid)
    )
  );

create policy athlete_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'athlete-photos'
    and (storage.foldername(name))[1] = 'athletes'
    and public.has_athlete_manage_access(((storage.foldername(name))[2])::uuid)
  );

create policy athlete_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'athlete-photos'
    and public.has_athlete_manage_access(((storage.foldername(name))[2])::uuid)
  );

-- Replacing a photo overwrites the object. Objects are not domain history, so a
-- delete policy for the managing guardian is consistent with the no-hard-delete
-- rule, which protects booking and session records.
create policy athlete_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'athlete-photos'
    and public.has_athlete_manage_access(((storage.foldername(name))[2])::uuid)
  );

-- D-19: signed URLs are issued server-side with a 60 minute TTL. The client is
-- never given a long-lived or public URL.
