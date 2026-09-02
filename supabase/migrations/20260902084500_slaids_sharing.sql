-- Slaids: publishing a presentation to a secret link.
--
-- This is a change against the applied schema, not a rewrite of it. The initial
-- migration already reserved `is_shared` and `share_token`; what was missing is
-- the published document itself, the invariant that ties the three together,
-- and a version trigger that can tell a document edit from a share toggle.
--
-- The security model in one line: `anon` still has no access to this table at
-- all. A shared deck is read by the `slaids-share` Edge Function, which holds
-- the service role, looks a row up by its token, and returns `shared_document`
-- and nothing else. The private `document` never leaves the owner's session.

-- ---------------------------------------------------------------------------
-- The published document
-- ---------------------------------------------------------------------------

-- A sanitised copy of the presentation: title, theme, authored slides, the
-- references that are actually cited and metadata for the assets that are
-- actually shown. Never the sandbox, the ideas, the folder, the owner or an
-- asset nothing points at. `src/domain/sharing.ts` is what builds it, and it
-- builds it by listing what goes in rather than by deleting what must not.
alter table public.slaids_presentations
  add column if not exists shared_document jsonb;

-- Shared and published are the same state, and this is what makes them
-- inseparable: a row can never claim to be shared with nothing to show, and can
-- never keep a published copy around after sharing is turned off. Revoking is
-- therefore a single UPDATE, not a cleanup job that could be interrupted.
alter table public.slaids_presentations
  drop constraint if exists slaids_presentations_share_state_check;
alter table public.slaids_presentations
  add constraint slaids_presentations_share_state_check
  check (
    (is_shared and shared_document is not null)
    or ((not is_shared) and shared_document is null)
  );

-- The Edge Function's only lookup. `share_token` is already unique — and so
-- already indexed — but a partial index over the shared rows alone is the one
-- this query actually wants, and it is tiny.
create index if not exists slaids_presentations_shared_token_idx
  on public.slaids_presentations (share_token)
  where is_shared;

-- ---------------------------------------------------------------------------
-- Version / updated_at trigger
-- ---------------------------------------------------------------------------

-- Replaces the version of this function from the initial migration, which
-- bumped `version` on *every* update.
--
-- Two things happen here, and they touch disjoint columns, so one function is
-- one trigger and there is no ordering question between them.
--
-- 1. Share metadata is normalised. Turning sharing off drops the published copy
--    in the same statement, and an update that does not mention
--    `shared_document` keeps the one already there. That is what lets the
--    client send the snapshot on a save without having to be sure, from a
--    possibly stale reading, whether the row is shared: if it is not, the copy
--    is discarded here and nothing private is published by accident.
--
-- 2. `version` is bumped only when the *editable document* changed. Publishing,
--    revoking and rotating a token are not edits to the presentation, and
--    bumping the version for them would make the open editor's known version
--    stale — turning the very next autosave into a false concurrency conflict
--    ("changed somewhere else"), for a change the same user just made in the
--    same tab. Real document changes keep the protection they had: the version
--    still moves on every one of them, and a tab writing against an older one
--    is still told it lost the race.
--
-- `security invoker` and an empty `search_path`: the function needs no elevated
-- rights and must not be steerable by the caller's search path, which is also
-- why `now()` is spelled out in full.
create or replace function public.slaids_presentations_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.is_shared then
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
      -- Not an edit. The version the editor is holding stays valid, and the
      -- library keeps showing when the presentation itself was last changed.
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

-- Now also on insert, so a row that arrives claiming to be shared without a
-- published document is normalised before the check constraint sees it.
drop trigger if exists slaids_presentations_touch on public.slaids_presentations;
create trigger slaids_presentations_touch
  before insert or update on public.slaids_presentations
  for each row
  execute function public.slaids_presentations_touch();

-- ---------------------------------------------------------------------------
-- Row level security is unchanged, deliberately
-- ---------------------------------------------------------------------------

-- Said explicitly because it is the invariant that matters most here: sharing
-- adds no policy and no grant. `anon` cannot select, insert, update or delete
-- `slaids_presentations`, shared or not, and there is no view, function or
-- endpoint that lists shared presentations. The only way to a published deck is
-- the exact token, through the Edge Function, one presentation at a time.
revoke all on table public.slaids_presentations from anon;
