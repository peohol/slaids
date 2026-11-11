-- Slaids: temamaler (IMPLEMENTATION_PLAN.md § 15.4).
--
-- En temamal er et øyeblikksbilde av temaet, forsidens to farger og logoen med
-- innstillingene. Den er privat (bare eieren ser, bruker og sletter den) eller
-- delt (alle aktive Slaids-brukere ser og bruker den). Bare den som laget en
-- mal, kan endre eller slette den.
--
-- Malens innhold er JSON uten filer. Logofilen ligger for seg i en egen, privat
-- bucket, under `<eier>/<mal>/logo`, og raden peker på den. En delt mals logo
-- kan leses av alle aktive brukere; alt annet i bucketen bare av eieren.
--
-- Hver bruker kan peke ut én mal som standard for nye presentasjoner
-- (`slaids_user_settings.default_theme_template_id`). Slettes malen, blir valget
-- tomt, og nye presentasjoner starter i standardtemaet.
--
-- Samme tilgangsregel som alle andre Slaids-tabeller (§ 43.1): alt krever en
-- aktiv Slaids-bruker. Bare objekter med `slaids_`-prefiks opprettes eller
-- endres; ingenting globalt berøres.

create table if not exists public.slaids_theme_templates (
  id          text primary key check (length(id) between 1 and 100),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  visibility  text not null default 'private' check (visibility in ('private', 'shared')),
  -- `{ theme, front, logo }`, kontrollert av appen ved hver lesing og skriving.
  -- Aldri bildedata: filen ligger i Storage, og en mal er liten.
  template    jsonb not null check (
    jsonb_typeof(template) = 'object'
    and octet_length(template::text) <= 65536
    and position(';base64,' in template::text) = 0
  ),
  -- Logofilen, når malen har en. Stien er alltid eierens egen, så en rad aldri
  -- kan peke på en annens fil.
  logo_path   text unique check (logo_path is null or logo_path = owner_id::text || '/' || id || '/logo'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists slaids_theme_templates_owner_idx
  on public.slaids_theme_templates (owner_id);
create index if not exists slaids_theme_templates_shared_idx
  on public.slaids_theme_templates (visibility) where visibility = 'shared';

alter table public.slaids_theme_templates enable row level security;

revoke all on table public.slaids_theme_templates from anon;
revoke all on table public.slaids_theme_templates from authenticated;
grant select, insert, update, delete on table public.slaids_theme_templates to authenticated;
grant select, insert, update, delete on table public.slaids_theme_templates to service_role;

drop policy if exists slaids_theme_templates_select on public.slaids_theme_templates;
create policy slaids_theme_templates_select on public.slaids_theme_templates
  for select to authenticated
  using (
    ((select auth.uid()) = owner_id or visibility = 'shared')
    and (select public.slaids_is_active_user())
  );

drop policy if exists slaids_theme_templates_insert on public.slaids_theme_templates;
create policy slaids_theme_templates_insert on public.slaids_theme_templates
  for insert to authenticated
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

drop policy if exists slaids_theme_templates_update on public.slaids_theme_templates;
create policy slaids_theme_templates_update on public.slaids_theme_templates
  for update to authenticated
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

drop policy if exists slaids_theme_templates_delete on public.slaids_theme_templates;
create policy slaids_theme_templates_delete on public.slaids_theme_templates
  for delete to authenticated
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

-- ---------------------------------------------------------------------------
-- Standardmalen for nye presentasjoner
-- ---------------------------------------------------------------------------

alter table public.slaids_user_settings
  add column if not exists default_theme_template_id text
    references public.slaids_theme_templates (id) on delete set null;

create index if not exists slaids_user_settings_default_theme_template_idx
  on public.slaids_user_settings (default_theme_template_id);

-- ---------------------------------------------------------------------------
-- Logoene i malene
-- ---------------------------------------------------------------------------

-- `do update`: migrasjonen er det som sikrer at bucketen er privat.
insert into storage.buckets (id, name, public)
values ('slaids-theme-templates', 'slaids-theme-templates', false)
on conflict (id) do update set public = false;

-- Lese: egne filer, og logoen til en delt mal. Malraden leses med den
-- innloggede brukerens egne rettigheter, så regelen over for delte maler er
-- den samme her.
drop policy if exists slaids_theme_template_storage_select on storage.objects;
create policy slaids_theme_template_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'slaids-theme-templates'
    and (select public.slaids_is_active_user())
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.slaids_theme_templates template
        where template.logo_path = storage.objects.name
          and template.visibility = 'shared'
      )
    )
  );

drop policy if exists slaids_theme_template_storage_insert on storage.objects;
create policy slaids_theme_template_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'slaids-theme-templates'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_theme_template_storage_update on storage.objects;
create policy slaids_theme_template_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'slaids-theme-templates'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'slaids-theme-templates'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_theme_template_storage_delete on storage.objects;
create policy slaids_theme_template_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'slaids-theme-templates'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
