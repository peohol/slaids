-- Deleting a folder, in one transaction.
--
-- What the repository promises (`SlaidsRepository.deleteFolder`) is that the
-- folder goes and the presentations in it stay, at the root, with the folder
-- cleared from *both* places it is written down: the `folder_id` column the
-- library filters on, and the `folderId` field inside the `document` JSON.
--
-- Dexie keeps that promise in a single `rw` transaction. Supabase could not,
-- because PostgREST gives the client statements and not transactions, and the
-- client-side version of this had a hole no number of re-reads could close:
--
--   1. the client lists the presentations in the folder and moves them out;
--   2. *another writer files a presentation into the folder* — the folder row
--      still exists, so the foreign key is happy to accept it;
--   3. the client deletes the folder row;
--   4. `on delete set null (folder_id)` clears that presentation's column, and
--      its `document.folderId` is left naming a folder that is gone.
--
-- Step 4 is the damage: the library filters on the column and would show the
-- deck at the root, but its next save writes `folder_id` back from the document
-- and is refused by the foreign key. The deck becomes unsaveable, and the call
-- that caused it reported success.
--
-- There is no client-side fix, because there is always a gap between the last
-- emptiness check and the DELETE. So the whole act moves into the database,
-- where it is one statement to the caller and one transaction to Postgres.
--
-- `for update` on the folder row is what closes step 2, and it is the reason
-- this is a function rather than three statements sent in a row. A foreign key
-- check takes a `FOR KEY SHARE` lock on the parent it references, and `FOR
-- UPDATE` conflicts with it — so a concurrent write that wants to file
-- something into this folder must wait here, and when it resumes the folder is
-- gone and its foreign key refuses it. Either the move lands before this
-- transaction and is cleared by it, or it lands after and is rejected. There is
-- no third outcome, which is exactly what the client version could not say.
--
-- It is also all-or-nothing, which the client version was not: it emptied the
-- folder one guarded write at a time, and a row that lost its race left some
-- presentations already at the root with the folder still standing.
--
-- The rows it changed come back with their new `version`, because the caller
-- caches versions for its optimistic saves. Without them, an editor holding a
-- presentation from the deleted folder would have a stale version and its next
-- autosave would be refused as a lost race — for a change nobody made by hand.
--
-- `security invoker` (the default) on purpose: in the browser this runs as the
-- signed-in user with row level security applying inside the function, so the
-- owner argument cannot be used to reach somebody else's rows. The server-side
-- client holds a secret key and has no row level security to stop it, and the
-- explicit `owner_id` filter below is the same limit `scoped()` writes onto
-- every other statement it sends.

create or replace function public.slaids_delete_folder(
  p_folder_id text,
  p_owner_id uuid
)
returns table (presentation_id text, version bigint)
language plpgsql
as $$
begin
  -- Blocks a concurrent write that wants to reference this folder; see above.
  -- A folder that is not there locks nothing and the rest is a no-op, which is
  -- the idempotence `deleteFolder` promises.
  perform 1
    from public.slaids_folders f
   where f.id = p_folder_id
     and f.owner_id = p_owner_id
     for update;

  -- Both places the folder is named, cleared by the same statement. `version`
  -- comes back after the touch trigger has bumped it.
  return query
    update public.slaids_presentations p
       set folder_id = null,
           document = jsonb_set(p.document, '{folderId}', 'null'::jsonb, true)
     where p.folder_id = p_folder_id
       and p.owner_id = p_owner_id
    returning p.id, p.version;

  delete from public.slaids_folders f
   where f.id = p_folder_id
     and f.owner_id = p_owner_id;
end;
$$;

-- `anon` has no business here, exactly as with every Slaids table. The default
-- EXECUTE grant on a new function goes to PUBLIC, so it is revoked rather than
-- assumed absent.
revoke all on function public.slaids_delete_folder(text, uuid) from public;
revoke all on function public.slaids_delete_folder(text, uuid) from anon;
grant execute on function public.slaids_delete_folder(text, uuid) to authenticated;
grant execute on function public.slaids_delete_folder(text, uuid) to service_role;
