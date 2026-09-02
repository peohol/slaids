-- Slaids is intentionally a single-user app even though its Supabase project
-- is shared infrastructure. Authorization is tied to the immutable Auth user
-- UUID, not to an email claim or to user-editable metadata.

alter policy slaids_folders_select on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_folders_insert on public.slaids_folders
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_folders_update on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid)
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_folders_delete on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);

alter policy slaids_presentations_select on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_presentations_insert on public.slaids_presentations
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_presentations_update on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid)
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_presentations_delete on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);

alter policy slaids_templates_select on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_templates_insert on public.slaids_templates
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_templates_update on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid)
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_templates_delete on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);

alter policy slaids_assets_select on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_assets_insert on public.slaids_assets
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_assets_update on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid)
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_assets_delete on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);

alter policy slaids_storage_select on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_insert on storage.objects
  with check (
    bucket_id = 'slaids-assets'
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_update on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'slaids-assets'
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_delete on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
