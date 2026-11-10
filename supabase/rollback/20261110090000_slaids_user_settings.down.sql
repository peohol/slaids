-- Rollback for 20261110090000_slaids_user_settings.sql. NOT a migration.
--
-- Lives outside `supabase/migrations/` on purpose, so `deploy-migrations.sh`
-- never runs it. Removes the per-user settings table, and with it every user's
-- saved autoerstatt rules — the app then reads its default rules again — and
-- the ledger row, so the migration can be applied again later.

begin;

drop table if exists public.slaids_user_settings;

delete from public.slaids_migrations where version = '20261110090000';

commit;
