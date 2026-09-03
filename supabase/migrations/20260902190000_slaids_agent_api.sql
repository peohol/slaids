-- Slaids: agent tokens and the agent audit trail.
--
-- Two tables, both `slaids_`-prefixed, both idempotent, and both touching
-- nothing the other apps in this shared project own.
--
-- The model, from `IMPLEMENTATION_PLAN.md` §44:
--
--   * an agent token is a delegation from the single Slaids owner, not a second
--     user. The row names the owner, and that is where `owner_id` comes from on
--     every write the agent API makes — a caller never names an owner;
--   * only the hash of a token is stored. The secret is generated in the
--     owner's browser and shown once. No server ever holds a usable token, not
--     even the one that created it;
--   * scopes separate "may edit" from "may publish". Ordinary editing does not
--     carry the right to hand a presentation to the internet;
--   * every agent call leaves a row saying who, when, which operation, which
--     presentation and which error code — and nothing about the content.
--
-- The agent API reaches these tables with the project's secret key, which
-- bypasses row level security. The policies below therefore do two jobs: they
-- are what limits the *browser*, and they are the written-down version of the
-- filter the server pins onto every query (see `SupabaseSlaidsRepository`'s
-- `pinnedOwnerId`).

-- ---------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------

create table if not exists public.slaids_agent_tokens (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  -- What the token is for, so the owner can tell which one to take away.
  name         text not null check (length(name) between 1 and 200),
  -- SHA-256 of the token, hex. Never the token itself, and never a prefix of
  -- it: a hash is enough to recognise a presented token and useless for making
  -- one, which is the whole point.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Authority, as an explicit list. Unknown names are impossible rather than
  -- ignored: a scope the code does not implement must never look granted.
  scopes       text[] not null
                 check (
                   array_length(scopes, 1) >= 1
                   and scopes <@ array[
                     'presentations:read',
                     'presentations:write',
                     'assets:write',
                     'sharing:write'
                   ]::text[]
                 ),
  created_at   timestamptz not null default now(),
  -- Optional. A token with no expiry is a deliberate choice, not a default.
  expires_at   timestamptz,
  last_used_at timestamptz,
  -- Revocation is a fact with a time, not a deleted row: the audit rows that
  -- point at this token keep their name, and the owner can still see that the
  -- token existed and when it was taken away.
  revoked_at   timestamptz
);

-- The API's only lookup: by hash, over the live tokens. `token_hash` is already
-- unique and therefore indexed; this partial index is the one the hot path
-- actually wants, and it is tiny.
create index if not exists slaids_agent_tokens_active_hash_idx
  on public.slaids_agent_tokens (token_hash)
  where revoked_at is null;

create index if not exists slaids_agent_tokens_owner_created_idx
  on public.slaids_agent_tokens (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table if not exists public.slaids_agent_audit (
  id              bigint generated always as identity primary key,
  owner_id        uuid not null references auth.users (id) on delete cascade,
  -- The token is identified, not stored. `on delete set null` so deleting a
  -- token does not erase the history of what it did; `token_name` is copied for
  -- the same reason, so a row stays readable on its own.
  token_id        uuid references public.slaids_agent_tokens (id) on delete set null,
  token_name      text not null default '' check (length(token_name) <= 200),
  at              timestamptz not null default now(),
  operation       text not null check (length(operation) between 1 and 100),
  -- Deliberately *not* a foreign key. An audit row has to be writable for a
  -- presentation that was never created, and has to survive one that is later
  -- deleted — a log that disappears with the thing it describes is not a log.
  presentation_id text check (length(presentation_id) <= 200),
  success         boolean not null,
  error_code      text check (length(error_code) <= 100),
  status          integer,
  duration_ms     integer check (duration_ms >= 0)
);

-- There is deliberately no column for a request body, a response body, slide
-- text or file bytes. §44 asks for that restraint; a schema with nowhere to put
-- them is how it stays true when somebody is in a hurry.

create index if not exists slaids_agent_audit_owner_at_idx
  on public.slaids_agent_audit (owner_id, at desc);

create index if not exists slaids_agent_audit_token_idx
  on public.slaids_agent_audit (token_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.slaids_agent_tokens enable row level security;
alter table public.slaids_agent_audit enable row level security;

-- `anon` has no business here at all, exactly as with every other Slaids table.
revoke all on table public.slaids_agent_tokens from anon;
revoke all on table public.slaids_agent_audit from anon;

grant select, insert, update, delete on table public.slaids_agent_tokens to authenticated;
-- Read only. Agent calls are written by the API with the server key; a log the
-- subject can rewrite is not one.
grant select on table public.slaids_agent_audit to authenticated;
revoke insert, update, delete on table public.slaids_agent_audit from authenticated;

-- The Slaids owner UUID is repeated from `20260902061716_restrict_slaids_to_owner.sql`
-- on purpose, and it matters more here than anywhere else. The Supabase project
-- is shared with Huskis and mdeditz, so without this pin any user of those apps
-- could mint a Slaids agent token — and the API, which holds a key that
-- bypasses RLS, would then act on their behalf. The pin is what keeps an agent
-- token a delegation from *this* owner rather than an account system.

drop policy if exists slaids_agent_tokens_select on public.slaids_agent_tokens;
create policy slaids_agent_tokens_select on public.slaids_agent_tokens
  for select to authenticated
  using (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  );

drop policy if exists slaids_agent_tokens_insert on public.slaids_agent_tokens;
create policy slaids_agent_tokens_insert on public.slaids_agent_tokens
  for insert to authenticated
  with check (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  );

drop policy if exists slaids_agent_tokens_update on public.slaids_agent_tokens;
create policy slaids_agent_tokens_update on public.slaids_agent_tokens
  for update to authenticated
  using (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  )
  with check (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  );

drop policy if exists slaids_agent_tokens_delete on public.slaids_agent_tokens;
create policy slaids_agent_tokens_delete on public.slaids_agent_tokens
  for delete to authenticated
  using (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  );

-- The audit is readable by its owner and writable by nobody with a browser
-- session. There is no insert, update or delete policy, which — with the grants
-- above — means `authenticated` cannot write here at all.
drop policy if exists slaids_agent_audit_select on public.slaids_agent_audit;
create policy slaids_agent_audit_select on public.slaids_agent_audit
  for select to authenticated
  using (
    (select auth.uid()) = owner_id
    and (select auth.uid()) = 'dab4f04f-cc4c-46b1-854e-3c8b17341966'::uuid
  );
