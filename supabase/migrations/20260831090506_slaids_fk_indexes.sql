-- Index the two foreign keys Slaids actually joins and filters on.
--
-- Owner is the second column in both: every query is already scoped to one user
-- by RLS, so `(fk, owner_id)` serves both the foreign-key lookup and the
-- owner-scoped read from the same index.

create index if not exists slaids_presentations_folder_id_owner_id_idx
  on public.slaids_presentations (folder_id, owner_id);

create index if not exists slaids_assets_presentation_id_owner_id_idx
  on public.slaids_assets (presentation_id, owner_id);
