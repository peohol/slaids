-- Tilbakerulling av 20261113090000_slaids_theme_template_logo_versions.sql. IKKE en migrasjon.
--
-- Ligger utenfor `supabase/migrations/` med vilje, så `deploy-migrations.sh`
-- aldri kjører den. Setter regelen tilbake til at logoen bare kan ligge på
-- `<eier>/<mal>/logo`. Feiler hvis en mal allerede peker på en logo med
-- utgave i stien; slike maler må lagres på nytt (eller logoen fjernes) først.

begin;

alter table public.slaids_theme_templates
  drop constraint if exists slaids_theme_templates_check;

alter table public.slaids_theme_templates
  add constraint slaids_theme_templates_check check (
    logo_path is null or logo_path = owner_id::text || '/' || id || '/logo'
  );

delete from public.slaids_migrations where version = '20261113090000';

commit;
