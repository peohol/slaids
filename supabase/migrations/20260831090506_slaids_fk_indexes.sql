-- Index the two composite foreign keys Slaids joins and filters on.
--
-- The owner-first indexes from the previous migration serve the library's own
-- reads; these lead with the referencing column, which is what a foreign-key
-- check and a cascade look up by.

create index if not exists slaids_presentations_folder_owner_fk_idx
  on public.slaids_presentations (folder_id, owner_id);

create index if not exists slaids_assets_presentation_owner_fk_idx
  on public.slaids_assets (presentation_id, owner_id);
