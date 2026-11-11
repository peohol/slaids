-- Tilbakerulling av 20261111120000_slaids_theme_templates.sql. IKKE en migrasjon.
--
-- Ligger utenfor `supabase/migrations/` med vilje, så `deploy-migrations.sh`
-- aldri kjører den. Fjerner temamalene, standardvalget og Storage-reglene for
-- malenes logoer, og raden i migrasjonsloggen, så migrasjonen kan legges inn
-- igjen senere. Presentasjoner som har brukt en mal, berøres ikke: de har sin
-- egen kopi av logoen.
--
-- Bucketen fjernes bare når den er tom. Filer i den slettes gjennom Storage,
-- ikke med SQL.

begin;

drop policy if exists slaids_theme_template_storage_select on storage.objects;
drop policy if exists slaids_theme_template_storage_insert on storage.objects;
drop policy if exists slaids_theme_template_storage_update on storage.objects;
drop policy if exists slaids_theme_template_storage_delete on storage.objects;

delete from storage.buckets
 where id = 'slaids-theme-templates'
   and not exists (select 1 from storage.objects where bucket_id = 'slaids-theme-templates');

alter table public.slaids_user_settings drop column if exists default_theme_template_id;

drop table if exists public.slaids_theme_templates;

delete from public.slaids_migrations where version = '20261111120000';

commit;
