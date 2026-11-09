-- Rollback for 20261109090000_slaids_multi_user.sql. NOT a migration.
--
-- Lives outside `supabase/migrations/` on purpose, so `deploy-migrations.sh`
-- never runs it. Run it only if the multi-user migration has to be undone in
-- production, in one transaction (Supabase SQL editor or the Management API).
--
-- It puts every Slaids policy back on the single fixed owner, exactly as
-- `20260902061716_restrict_slaids_to_owner.sql` and
-- `20260902190000_slaids_agent_api.sql` left them, and removes the ledger row
-- so the migration can be applied again later. The access list, its functions
-- and the object-path check are left in place: they grant nothing on their own
-- once no policy asks them, and dropping `slaids_users` would throw away the
-- list of users an administrator has built. No data is touched.

begin;

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

alter policy slaids_agent_tokens_select on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_agent_tokens_insert on public.slaids_agent_tokens
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_agent_tokens_update on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid)
  with check ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);
alter policy slaids_agent_tokens_delete on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid);

alter policy slaids_agent_audit_select on public.slaids_agent_audit
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

delete from public.slaids_migrations where version = '20261109090000';

commit;
