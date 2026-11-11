-- Henvisningsformatet følger brukeren på tvers av presentasjoner.
alter table public.slaids_user_settings
  add column if not exists citation_style text not null default 'numbered'
  check (citation_style in ('numbered', 'author-year'));
