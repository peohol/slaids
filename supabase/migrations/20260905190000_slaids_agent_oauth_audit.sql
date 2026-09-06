-- Slaids: the audit trail learns that a call can come from an OAuth client.
--
-- Slaids now accepts two credential families at the agent API. An agent token
-- is unchanged — a delegation from the owner, a row in
-- `public.slaids_agent_tokens`, minted in the browser and pasted into a client.
-- The second is a Supabase OAuth 2.1 access token, for the clients that cannot
-- be handed a static string at all: ChatGPT's custom MCP apps authorise over
-- OAuth or not at all.
--
-- The audit has to be able to say which of the two acted. The alternative was
-- to invent a token row for an OAuth call so the existing columns would fit,
-- and that is exactly what this migration exists to avoid: a log that says
-- something false is worse than a log that says less.
--
-- Three changes, all additive and all idempotent:
--
--   * `principal_kind` — which family. Defaulted to `agent_token`, so every row
--     written before today is correctly labelled without being touched.
--   * `client_id` — the OAuth client the owner approved. A `client_id` is a
--     public identifier: it travels in the authorization request and in the
--     browser's address bar. The access token, the refresh token, the
--     authorization code and the PKCE verifier are none of them here, and there
--     is still nowhere to put them.
--   * `token_id` was already nullable (a deleted token leaves its history
--     behind), and `token_name` drops its `not null` for the same reason it
--     could not simply be reused: an OAuth call has no token to name.
--
-- There is deliberately still no column for a request body, a response body,
-- slide text or file bytes.

alter table public.slaids_agent_audit
  add column if not exists principal_kind text not null default 'agent_token';

alter table public.slaids_agent_audit
  add column if not exists client_id text;

-- An OAuth call has no token row and no token name. `token_name` was
-- `not null default ''`, which would have quietly stored an empty string for
-- every OAuth row; nullable says the same thing honestly, and the default stays
-- so nothing that writes the old shape changes.
alter table public.slaids_agent_audit
  alter column token_name drop not null;

-- Named constraints, dropped before they are created, so this file can be run
-- again — in the SQL editor, or against a database whose history is incomplete.
alter table public.slaids_agent_audit
  drop constraint if exists slaids_agent_audit_principal_kind_check;
alter table public.slaids_agent_audit
  add constraint slaids_agent_audit_principal_kind_check
  check (principal_kind in ('agent_token', 'oauth'));

alter table public.slaids_agent_audit
  drop constraint if exists slaids_agent_audit_client_id_check;
alter table public.slaids_agent_audit
  add constraint slaids_agent_audit_client_id_check
  check (client_id is null or length(client_id) <= 200);

-- The two families are read separately far more often than together: "what has
-- the ChatGPT connector been doing" is the question this index answers.
create index if not exists slaids_agent_audit_owner_kind_at_idx
  on public.slaids_agent_audit (owner_id, principal_kind, at desc);

-- The grants and policies from `20260902190000_slaids_agent_api.sql` are
-- unchanged and still apply: `anon` has nothing here, `authenticated` may read
-- its own rows and write none, and the API writes with the server key.
