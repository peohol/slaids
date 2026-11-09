-- Slaids: from one fixed owner to an access list of users.
--
-- Until now every Slaids policy carried the same hard-coded Auth UUID next to
-- the ownership check (`20260902061716_restrict_slaids_to_owner.sql`,
-- `20260902190000_slaids_agent_api.sql`). Ownership was already per user —
-- every table has `owner_id`, every policy compares it with `auth.uid()`, the
-- composite foreign keys keep references inside one owner, and Storage paths
-- start with the owner's UUID. What this migration changes is only *who may be
-- an owner at all*: the UUID literal becomes `slaids_is_active_user()`, which
-- asks Slaids' own access list.
--
-- The project is shared with other apps and open for sign-up, so an Auth
-- account on its own grants nothing here. The access list is Slaids' alone,
-- under its own prefix, and nothing in this file touches another app's objects
-- or a global Auth setting. See `IMPLEMENTATION_PLAN.md` § 43.1.
--
-- Backwards compatible on purpose: the existing owner is bootstrapped as an
-- active administrator in the same transaction, so the client that is deployed
-- today — with its own fixed-UUID gate — keeps working the moment this runs.
-- No data moves.

-- ---------------------------------------------------------------------------
-- The access list
-- ---------------------------------------------------------------------------

create table if not exists public.slaids_users (
  -- The Auth user's stable UUID. Never the email: an email is a name for a
  -- credential, not an identity, and it can change.
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user' check (role in ('user', 'admin')),
  -- Deactivation is a state, not a deleted row: the user's data stays, and
  -- reactivating gives it back exactly as it was.
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  -- Which administrator added the user. `set null` so removing an
  -- administrator's Auth account never takes other users' rows with it.
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists slaids_users_created_by_idx
  on public.slaids_users (created_by);

alter table public.slaids_users enable row level security;

-- Supabase's default privileges hand every new public table to `anon` and
-- `authenticated`. Take that back first and grant exactly what is meant.
revoke all on table public.slaids_users from anon;
revoke all on table public.slaids_users from authenticated;
-- Read only, and only the caller's own row (the policy below). Role and status
-- are written by the server with the service role, after it has checked that
-- the caller is an active administrator — never by a browser, and never from a
-- JWT claim a user can influence.
grant select on table public.slaids_users to authenticated;
grant select, insert, update, delete on table public.slaids_users to service_role;

drop policy if exists slaids_users_select_own on public.slaids_users;
create policy slaids_users_select_own on public.slaids_users
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The one question every policy asks
-- ---------------------------------------------------------------------------

-- `security definer` so policies on other tables can ask it without being able
-- to read `slaids_users` themselves; empty `search_path` so the caller cannot
-- steer what `slaids_users` resolves to. `stable`, and called as
-- `(select public.slaids_is_active_user())` in the policies, so the planner
-- evaluates it once per statement rather than once per row.
create or replace function public.slaids_is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.slaids_users u
     where u.user_id = (select auth.uid())
       and u.active
  );
$$;

revoke all on function public.slaids_is_active_user() from public;
revoke all on function public.slaids_is_active_user() from anon;
grant execute on function public.slaids_is_active_user() to authenticated;
grant execute on function public.slaids_is_active_user() to service_role;

-- ---------------------------------------------------------------------------
-- There is always an active administrator
-- ---------------------------------------------------------------------------

-- Enforced here rather than only in the server, because the database is the
-- one place every path goes through. The advisory lock serialises the check:
-- two administrators demoting each other at the same moment would otherwise
-- each see the other still in place, and both commit. Under read committed the
-- second one, once it has the lock, reads the first one's committed change and
-- is refused.
create or replace function public.slaids_users_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
  then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.slaids_users.admins'));
    if not exists (
      select 1
        from public.slaids_users u
       where u.role = 'admin'
         and u.active
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'SLAIDS_LAST_ACTIVE_ADMIN',
        detail = 'Slaids må ha minst én aktiv administrator.';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.slaids_users_keep_admin() from public;
revoke all on function public.slaids_users_keep_admin() from anon;
revoke all on function public.slaids_users_keep_admin() from authenticated;

drop trigger if exists slaids_users_keep_admin on public.slaids_users;
create trigger slaids_users_keep_admin
  after update or delete on public.slaids_users
  for each row
  execute function public.slaids_users_keep_admin();

-- ---------------------------------------------------------------------------
-- What the administration server needs from auth.users
-- ---------------------------------------------------------------------------

-- Both functions read `auth.users`, which no Slaids role can read directly,
-- and both are for the service role alone. A browser — administrator or not —
-- cannot call them; administration goes through the server, which checks the
-- caller first.

create or replace function public.slaids_admin_list_users()
returns table (
  user_id         uuid,
  email           text,
  role            text,
  active          boolean,
  created_at      timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id, a.email::text, u.role, u.active, u.created_at, a.last_sign_in_at
    from public.slaids_users u
    join auth.users a on a.id = u.user_id
   order by pg_catalog.lower(a.email::text), u.user_id;
$$;

revoke all on function public.slaids_admin_list_users() from public;
revoke all on function public.slaids_admin_list_users() from anon;
revoke all on function public.slaids_admin_list_users() from authenticated;
grant execute on function public.slaids_admin_list_users() to service_role;

-- An existing Auth account for this address, whichever app created it. Adding
-- someone who already has an account in the project reuses it — one person,
-- one identity — instead of failing on a duplicate email.
create or replace function public.slaids_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
    from auth.users a
   where pg_catalog.lower(a.email::text) = pg_catalog.lower(pg_catalog.btrim(p_email))
   order by a.created_at
   limit 1;
$$;

revoke all on function public.slaids_auth_user_id_by_email(text) from public;
revoke all on function public.slaids_auth_user_id_by_email(text) from anon;
revoke all on function public.slaids_auth_user_id_by_email(text) from authenticated;
grant execute on function public.slaids_auth_user_id_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- A file row can only point at its own owner's file
-- ---------------------------------------------------------------------------

-- `object_path` was free text. With one user that did not matter; with several
-- it would let a user register a row naming somebody else's file, which the
-- server and the share function — both holding the service role — would then
-- download. The path is derived in exactly one place
-- (`SupabaseSlaidsRepository.objectPath`), and this makes the derivation the
-- rule.
alter table public.slaids_assets
  drop constraint if exists slaids_assets_object_path_check;
alter table public.slaids_assets
  add constraint slaids_assets_object_path_check
  check (object_path = owner_id::text || '/' || presentation_id || '/' || id);

-- ---------------------------------------------------------------------------
-- Bootstrap: the existing owner is the first administrator
-- ---------------------------------------------------------------------------

-- Only when both the UUID and the email match — a project where either is
-- different gets no administrator from here, and that is visible rather than
-- silently granting someone else. `do nothing` on conflict: re-running this
-- file must never undo a later decision about the account.
insert into public.slaids_users (user_id, role, active)
select a.id, 'admin', true
  from auth.users a
 where a.id = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
   and pg_catalog.lower(a.email::text) = 'peder.holman@gmail.com'
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Every Slaids policy: own rows, and an active Slaids user
-- ---------------------------------------------------------------------------

alter policy slaids_folders_select on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_folders_insert on public.slaids_folders
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_folders_update on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_folders_delete on public.slaids_folders
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_presentations_select on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_presentations_insert on public.slaids_presentations
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_presentations_update on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_presentations_delete on public.slaids_presentations
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_templates_select on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_templates_insert on public.slaids_templates
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_templates_update on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_templates_delete on public.slaids_templates
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_assets_select on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_assets_insert on public.slaids_assets
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_assets_update on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_assets_delete on public.slaids_assets
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_agent_tokens_select on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_agent_tokens_insert on public.slaids_agent_tokens
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_agent_tokens_update on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));
alter policy slaids_agent_tokens_delete on public.slaids_agent_tokens
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_agent_audit_select on public.slaids_agent_audit
  using ((select auth.uid()) = owner_id and (select public.slaids_is_active_user()));

alter policy slaids_storage_select on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_insert on storage.objects
  with check (
    bucket_id = 'slaids-assets'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_update on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'slaids-assets'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy slaids_storage_delete on storage.objects
  using (
    bucket_id = 'slaids-assets'
    and (select public.slaids_is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
