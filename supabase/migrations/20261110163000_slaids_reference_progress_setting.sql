-- Innstillingen gjelder på tvers av eierens presentasjoner.
alter table public.slaids_user_settings
  add column if not exists include_references_in_progress boolean not null default false;
