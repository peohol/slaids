-- Slaids: publishing a whole folder to a secret link.
--
-- A change against the applied schema, additive and idempotent, so the file can
-- be run again in the SQL editor or against a database whose ledger is
-- incomplete. Nothing outside the `slaids_` prefix is touched.
--
-- The model is the one presentation sharing already has, one level up. A
-- folder gets `is_shared` and a `share_token`; while it is shared, every
-- presentation filed in it is *published* — it carries the sanitised
-- `shared_document`, written by the owner's client exactly as it is for a
-- presentation shared on its own — and the `slaids-share` Edge Function lists
-- and serves those, and nothing else, to whoever holds the folder's token.
--
-- The security model is unchanged in one line: `anon` still has no access to
-- any Slaids table at all. There is no new policy and no new grant. The only
-- way in is still the Edge Function, which only reads, and only by token.

-- ---------------------------------------------------------------------------
-- Folders: the share state
-- ---------------------------------------------------------------------------

alter table public.slaids_folders
  add column if not exists is_shared boolean not null default false;

-- A v4 UUID minted by the client on every activation *and* every deactivation,
-- exactly like a presentation's: a link that was turned off never works again,
-- and sharing the folder anew is always a new address. The default only covers
-- the rows that exist today and rows created by an older client.
alter table public.slaids_folders
  add column if not exists share_token uuid not null default gen_random_uuid();

create unique index if not exists slaids_folders_share_token_key
  on public.slaids_folders (share_token);

-- The Edge Function's only folder lookup, over the shared rows alone.
create index if not exists slaids_folders_shared_token_idx
  on public.slaids_folders (share_token)
  where is_shared;

-- ---------------------------------------------------------------------------
-- Presentations: shared on their own, or published through their folder
-- ---------------------------------------------------------------------------

-- Whether anybody but the owner may read this presentation's published copy:
-- because it is shared on its own (`is_shared`), or because the folder it is
-- filed in is shared. Never written by a client — the trigger below derives it
-- on every write, and the folder trigger further down keeps it true when the
-- folder changes instead of the presentation.
alter table public.slaids_presentations
  add column if not exists is_published boolean not null default false;

-- The folder listing's lookup: the published, live decks of one folder.
create index if not exists slaids_presentations_published_folder_idx
  on public.slaids_presentations (folder_id, owner_id)
  where is_published and deleted_at is null;

-- ---------------------------------------------------------------------------
-- Version / updated_at trigger, now also deriving `is_published`
-- ---------------------------------------------------------------------------

-- Replaces the version from the sharing migration. The version rule is
-- unchanged word for word; what is new is *which* rows may keep a published
-- copy.
--
-- 1. `is_published` is derived, never trusted from the payload: shared on its
--    own, or filed in a folder of the same owner that is shared. The folder is
--    looked up with the caller's own rights (`security invoker`), which for the
--    owner and for the service role is the folder itself, and for anybody else
--    is nothing — so nobody can publish a deck by naming a folder they do not
--    own, and nobody but the owner can write this row in the first place.
--
-- 2. A row that is not published drops its copy in the same statement. That is
--    what makes moving a deck *out* of a shared folder, deleting the folder, or
--    turning the folder's sharing off take the deck off the public link at once,
--    with no cleanup step that could be skipped. A published row whose update
--    does not mention `shared_document` keeps the copy it had — which also
--    covers turning a presentation's own sharing off while its folder is still
--    shared: the folder still publishes it.
--
-- 3. `version` moves only when the editable document does. Publishing, revoking
--    and a change of `is_published` are not edits, so an open editor's known
--    version stays valid and its next autosave lands.
create or replace function public.slaids_presentations_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.is_published := new.is_shared or exists (
    select 1
      from public.slaids_folders f
     where f.id = new.folder_id
       and f.owner_id = new.owner_id
       and f.is_shared
  );

  if not new.is_published then
    new.shared_document := null;
  elsif tg_op = 'UPDATE' and new.shared_document is null then
    new.shared_document := old.shared_document;
  end if;

  if tg_op = 'UPDATE' then
    if new.document is distinct from old.document
      or new.title is distinct from old.title
      or new.folder_id is distinct from old.folder_id
      or new.slide_count is distinct from old.slide_count
    then
      new.version := old.version + 1;
      new.updated_at := pg_catalog.now();
    else
      new.version := old.version;
      new.updated_at := old.updated_at;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.slaids_presentations_touch() from public;
revoke all on function public.slaids_presentations_touch() from anon;
revoke all on function public.slaids_presentations_touch() from authenticated;

-- ---------------------------------------------------------------------------
-- Folder trigger: a share toggle reaches the decks inside
-- ---------------------------------------------------------------------------

-- When a folder's sharing changes, every deck filed in it is re-derived. The
-- UPDATE below goes through the presentations trigger above, which reads the
-- folder's *new* state and does the rest: turning sharing on marks the decks
-- published (their copies are then written by the client, which is the only
-- place a sanitised snapshot can be built), and turning it off drops every copy
-- that is not also shared on its own — in the same transaction as the toggle.
--
-- The SET names `is_published` only, so the presentations trigger sees no
-- edit and leaves every deck's `version` and `updated_at` alone.
create or replace function public.slaids_folders_share_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.slaids_presentations p
     set is_published = p.is_shared or new.is_shared
   where p.folder_id = new.id
     and p.owner_id = new.owner_id;
  return null;
end;
$$;

revoke all on function public.slaids_folders_share_touch() from public;
revoke all on function public.slaids_folders_share_touch() from anon;
revoke all on function public.slaids_folders_share_touch() from authenticated;

drop trigger if exists slaids_folders_share_touch on public.slaids_folders;
create trigger slaids_folders_share_touch
  after update of is_shared on public.slaids_folders
  for each row
  when (old.is_shared is distinct from new.is_shared)
  execute function public.slaids_folders_share_touch();

-- ---------------------------------------------------------------------------
-- Backfill, then the invariant
-- ---------------------------------------------------------------------------

-- Every row is derived once by the new trigger. No folder is shared yet, so
-- this makes `is_published` equal `is_shared` everywhere; naming that column
-- alone keeps `version` and `updated_at` exactly where they are.
update public.slaids_presentations
   set is_published = is_shared;

-- Replaces the check from the sharing migration, which tied the copy to
-- `is_shared` alone. Now:
--
--   shared on its own   →  published, with a copy
--   not published       →  no copy
--
-- A deck published only through its folder may be without a copy for a moment
-- — filed there by a write that carried none — and is then simply not listed
-- until the client's follow-up write publishes it. It is never listed without
-- one: the Edge Function serves only what `shared_document` holds.
alter table public.slaids_presentations
  drop constraint if exists slaids_presentations_share_state_check;
alter table public.slaids_presentations
  add constraint slaids_presentations_share_state_check
  check (
    (not is_shared or (is_published and shared_document is not null))
    and (is_published or shared_document is null)
  );

-- ---------------------------------------------------------------------------
-- Row level security is unchanged, deliberately
-- ---------------------------------------------------------------------------

-- Folder sharing adds no policy and no grant. `anon` cannot select, insert,
-- update or delete a folder or a presentation, shared or not. Reading a shared
-- folder is the Edge Function's job, through the exact token, and it can only
-- read.
revoke all on table public.slaids_folders from anon;
revoke all on table public.slaids_presentations from anon;
