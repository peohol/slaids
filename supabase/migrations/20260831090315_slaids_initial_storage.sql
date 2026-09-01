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
-- This file describes the schema that is already applied remotely. It is what a
-- fresh project is rebuilt from, not a change to make against an existing one.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.slaids_folders (
  id         text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  -- Redundant next to the primary key, and there for one reason: it lets the
  -- foreign keys below carry `owner_id` too.
  constraint slaids_folders_id_owner_key unique (id, owner_id)
);

create table if not exists public.slaids_presentations (
  id          text primary key,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  folder_id   text,
  document    jsonb not null,
  slide_count integer not null default 0 check (slide_count >= 0),
  -- Bumped by the trigger below on every update, so a client can write against
  -- the version it read and be told when it lost a race instead of silently
  -- overwriting a newer copy.
  version     bigint not null default 1 check (version >= 1),
  -- Reserved for the coming sharing feature. Nothing reads them yet, and `anon`
  -- deliberately has no access to this table at all.
  is_shared   boolean not null default false,
  share_token uuid not null default gen_random_uuid() unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint slaids_presentations_id_owner_key unique (id, owner_id),
  -- The owner travels with the reference. Without it, knowing a folder id would
  -- be enough to file your presentation inside someone else's folder.
  constraint slaids_presentations_folder_fkey
    foreign key (folder_id, owner_id)
    references public.slaids_folders (id, owner_id)
    on delete set null (folder_id)
);

create table if not exists public.slaids_templates (
  id         text primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  template   jsonb not null,
  created_at timestamptz not null default now(),
  constraint slaids_templates_id_owner_key unique (id, owner_id)
);

create table if not exists public.slaids_assets (
  id              text primary key,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  presentation_id text not null,
  ref             jsonb not null,
  -- `<owner_id>/<presentation_id>/<asset_id>` in the `slaids-assets` bucket.
  object_path     text not null unique,
  created_at      timestamptz not null default now(),
  -- Assets belong to a presentation and go with it — the owner's presentation,
  -- never one that merely has the id you guessed.
  constraint slaids_assets_presentation_fkey
    foreign key (presentation_id, owner_id)
    references public.slaids_presentations (id, owner_id)
    on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The library lists a user's presentations newest first.
create index if not exists slaids_presentations_owner_updated_idx
  on public.slaids_presentations (owner_id, updated_at desc);

create index if not exists slaids_presentations_owner_folder_idx
  on public.slaids_presentations (owner_id, folder_id);

create index if not exists slaids_folders_owner_idx
  on public.slaids_folders (owner_id);

create index if not exists slaids_templates_owner_idx
  on public.slaids_templates (owner_id);

create index if not exists slaids_assets_owner_presentation_idx
  on public.slaids_assets (owner_id, presentation_id);

-- ---------------------------------------------------------------------------
-- Version / updated_at trigger
-- ---------------------------------------------------------------------------

-- `security invoker` and an empty `search_path`: the function needs no elevated
-- rights and must not be steerable by whatever search path the caller happens
-- to have, which is also why `now()` is spelled out in full.
create or replace function public.slaids_presentations_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Firing a trigger does not check EXECUTE, so nothing needs to be able to call
-- this directly — and nothing should be able to.
revoke all on function public.slaids_presentations_touch() from public;
revoke all on function public.slaids_presentations_touch() from anon;
revoke all on function public.slaids_presentations_touch() from authenticated;

drop trigger if exists slaids_presentations_touch on public.slaids_presentations;
create trigger slaids_presentations_touch
  before update on public.slaids_presentations
  for each row
  execute function public.slaids_presentations_touch();

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
drop policy if exists slaids_folders_select on public.slaids_folders;
create policy slaids_folders_select on public.slaids_folders
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_insert on public.slaids_folders;
create policy slaids_folders_insert on public.slaids_folders
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_update on public.slaids_folders;
create policy slaids_folders_update on public.slaids_folders
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_folders_delete on public.slaids_folders;
create policy slaids_folders_delete on public.slaids_folders
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_presentations
drop policy if exists slaids_presentations_select on public.slaids_presentations;
create policy slaids_presentations_select on public.slaids_presentations
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_insert on public.slaids_presentations;
create policy slaids_presentations_insert on public.slaids_presentations
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_update on public.slaids_presentations;
create policy slaids_presentations_update on public.slaids_presentations
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_presentations_delete on public.slaids_presentations;
create policy slaids_presentations_delete on public.slaids_presentations
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_templates
drop policy if exists slaids_templates_select on public.slaids_templates;
create policy slaids_templates_select on public.slaids_templates
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_insert on public.slaids_templates;
create policy slaids_templates_insert on public.slaids_templates
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_update on public.slaids_templates;
create policy slaids_templates_update on public.slaids_templates
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_templates_delete on public.slaids_templates;
create policy slaids_templates_delete on public.slaids_templates
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- slaids_assets
drop policy if exists slaids_assets_select on public.slaids_assets;
create policy slaids_assets_select on public.slaids_assets
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_insert on public.slaids_assets;
create policy slaids_assets_insert on public.slaids_assets
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_update on public.slaids_assets;
create policy slaids_assets_update on public.slaids_assets
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists slaids_assets_delete on public.slaids_assets;
create policy slaids_assets_delete on public.slaids_assets
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- Private asset storage
-- ---------------------------------------------------------------------------

-- `do update` rather than `do nothing`: the migration is what guarantees the
-- bucket is private, so a bucket that already exists is made private too.
insert into storage.buckets (id, name, public)
values ('slaids-assets', 'slaids-assets', false)
on conflict (id) do update set public = false;

-- The first path segment is the owner's UUID, which is what makes a Storage
-- object reachable by exactly one user.
drop policy if exists slaids_storage_select on storage.objects;
create policy slaids_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_storage_insert on storage.objects;
create policy slaids_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_storage_update on storage.objects;
create policy slaids_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists slaids_storage_delete on storage.objects;
create policy slaids_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'slaids-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
