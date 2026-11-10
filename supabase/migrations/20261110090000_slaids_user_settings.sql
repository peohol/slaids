-- Slaids: each user's own settings, starting with their autoerstatt rules.
--
-- One row per user, keyed by the user. A setting is a column, so a later
-- setting is a later migration rather than a key nobody validates. A missing
-- row, or a null column, means "never chosen" — the app then uses its default
-- (`DEFAULT_AUTOCORRECT_RULES` in `src/domain/autocorrect.ts`); an empty list
-- is a choice and is stored as one.
--
-- Same access rule as every other Slaids table (`IMPLEMENTATION_PLAN.md`
-- § 43.1): an active Slaids user reaches exactly their own row. Only
-- `slaids_`-prefixed objects are created; nothing global is touched.

create table if not exists public.slaids_user_settings (
  owner_id    uuid primary key references auth.users (id) on delete cascade,
  -- `[{ "from": " - ", "to": " – " }, …]`, repaired by the app on every read
  -- and write.
  autocorrect jsonb check (autocorrect is null or jsonb_typeof(autocorrect) = 'array'),
  updated_at  timestamptz not null default now()
);

alter table public.slaids_user_settings enable row level security;

revoke all on table public.slaids_user_settings from anon;
revoke all on table public.slaids_user_settings from authenticated;
grant select, insert, update, delete on table public.slaids_user_settings to authenticated;
grant select, insert, update, delete on table public.slaids_user_settings to service_role;

drop policy if exists slaids_user_settings_select on public.slaids_user_settings;
create policy slaids_user_settings_select on public.slaids_user_settings
  for select to authenticated
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

drop policy if exists slaids_user_settings_insert on public.slaids_user_settings;
create policy slaids_user_settings_insert on public.slaids_user_settings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

drop policy if exists slaids_user_settings_update on public.slaids_user_settings;
create policy slaids_user_settings_update on public.slaids_user_settings
  for update to authenticated
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

drop policy if exists slaids_user_settings_delete on public.slaids_user_settings;
create policy slaids_user_settings_delete on public.slaids_user_settings
  for delete to authenticated
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
