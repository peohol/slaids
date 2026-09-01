-- Slaids: tables, row level security and private asset storage.
--
-- The Supabase project is shared with Huskis (and mdeditz), so everything here
-- is prefixed `slaids_` and touches nothing outside that prefix.
--
-- A presentation is one row with the whole document in `jsonb`. Slides, zones
-- and references are deliberately *not* normalised into tables: the document is
-- the domain model Slaids already validates and migrates, and splitting it
-- would put a second, weaker copy of those invariants in the database.
--
-- Every statement is written to be re-runnable, so the file can rebuild this
-- schema from scratch on a fresh project.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.slaids_folders (
  id         text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.slaids_presentations (
  id          text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  folder_id   text references public.slaids_folders (id) on delete set null,
  document    jsonb not null,
  slide_count integer not null default 0,
  -- Bumped by the trigger below on every update, so a client can write against
  -- the version it read and be told when it lost a race instead of silently
  -- overwriting a newer copy.
  version     bigint not null default 1,
  -- Reserved for the coming sharing feature. Nothing reads them yet, and `anon`
  -- deliberately has no access to this table at all.
  is_shared   boolean not null default false,
  share_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.slaids_templates (
  id         text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  template   jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.slaids_assets (
  id              text primary key,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  -- Assets belong to a presentation and go with it.
  presentation_id text not null references public.slaids_presentations (id) on delete cascade,
  ref             jsonb not null,
  -- `<owner_id>/<presentation_id>/<asset_id>` in the `slaids-assets` bucket.
  object_path     text not null unique,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists slaids_folders_owner_id_idx
  on public.slaids_folders (owner_id);

-- The library lists a user's presentations newest first.
create index if not exists slaids_presentations_owner_id_updated_at_idx
  on public.slaids_presentations (owner_id, updated_at desc);

create index if not exists slaids_presentations_owner_id_folder_id_idx
  on public.slaids_presentations (owner_id, folder_id);

create index if not exists slaids_templates_owner_id_idx
  on public.slaids_templates (owner_id);

create index if not exists slaids_assets_owner_id_idx
  on public.slaids_assets (owner_id);

-- ---------------------------------------------------------------------------
-- Version / updated_at trigger
-- ---------------------------------------------------------------------------

-- `security invoker` and an empty `search_path`: the function needs no elevated
-- rights and must not be steerable by whatever search path the caller happens
-- to have. `now()` lives in pg_catalog, which is always implicitly in scope.
create or replace function public.slaids_touch_presentation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Firing a trigger does not check EXECUTE, so nothing needs to be able to call
-- this directly — and nothing should be able to.
revoke all on function public.slaids_touch_presentation() from public;
revoke all on function public.slaids_touch_presentation() from anon;
revoke all on function public.slaids_touch_presentation() from authenticated;

drop trigger if exists slaids_presentations_touch on public.slaids_presentations;
create trigger slaids_presentations_touch
  before update on public.slaids_presentations
  for each row
  execute function public.slaids_touch_presentation();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.slaids_folders enable row level security;
alter table public.slaids_presentations enable row level security;
alter table public.slaids_templates enable row level security;
alter table public.slaids_assets enable row level security;

revoke all on table public.slaids_folders from anon;
revoke all on table public.slaids_presentations from anon;
revoke all on table public.slaids_templates from anon;
revoke all on table public.slaids_assets from anon;

grant select, insert, update, delete on table public.slaids_folders to authenticated;
grant select, insert, update, delete on table public.slaids_presentations to authenticated;
grant select, insert, update, delete on table public.slaids_templates to authenticated;
grant select, insert, update, delete on table public.slaids_assets to authenticated;

-- `(select auth.uid())` rather than a bare `auth.uid()`: the planner evaluates
-- it once per statement instead of once per row.

-- slaids_folders
drop policy if exists slaids_folders_select_own on public.slaids_folders;
create policy slaids_folders_select_own on public.slaids_folders
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_insert_own on public.slaids_folders;
create policy slaids_folders_insert_own on public.slaids_folders
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_update_own on public.slaids_folders;
create policy slaids_folders_update_own on public.slaids_folders
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_delete_own on public.slaids_folders;
create policy slaids_folders_delete_own on public.slaids_folders
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_presentations
drop policy if exists slaids_presentations_select_own on public.slaids_presentations;
create policy slaids_presentations_select_own on public.slaids_presentations
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_insert_own on public.slaids_presentations;
create policy slaids_presentations_insert_own on public.slaids_presentations
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_update_own on public.slaids_presentations;
create policy slaids_presentations_update_own on public.slaids_presentations
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_delete_own on public.slaids_presentations;
create policy slaids_presentations_delete_own on public.slaids_presentations
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_templates
drop policy if exists slaids_templates_select_own on public.slaids_templates;
create policy slaids_templates_select_own on public.slaids_templates
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_insert_own on public.slaids_templates;
create policy slaids_templates_insert_own on public.slaids_templates
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_update_own on public.slaids_templates;
create policy slaids_templates_update_own on public.slaids_templates
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_delete_own on public.slaids_templates;
create policy slaids_templates_delete_own on public.slaids_templates
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_assets
drop policy if exists slaids_assets_select_own on public.slaids_assets;
create policy slaids_assets_select_own on public.slaids_assets
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_insert_own on public.slaids_assets;
create policy slaids_assets_insert_own on public.slaids_assets
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_update_own on public.slaids_assets;
create policy slaids_assets_update_own on public.slaids_assets
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_delete_own on public.slaids_assets;
create policy slaids_assets_delete_own on public.slaids_assets
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- Private asset storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('slaids-assets', 'slaids-assets', false)
on conflict (id) do nothing;

-- The first path segment is the owner's UUID, which is what makes a Storage
-- object reachable by exactly one user.
drop policy if exists slaids_assets_objects_select_own on storage.objects;
create policy slaids_assets_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_assets_objects_insert_own on storage.objects;
create policy slaids_assets_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_assets_objects_update_own on storage.objects;
create policy slaids_assets_objects_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_assets_objects_delete_own on storage.objects;
create policy slaids_assets_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
