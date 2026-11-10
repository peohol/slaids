alter table public.slaids_user_settings
  add column if not exists fewer_dialogs boolean not null default false;
