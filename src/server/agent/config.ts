/**
 * What the agent API needs from its environment, and what it refuses.
 *
 * Slaids has two storage modes and no fallback between them (see `AGENTS.md`).
 * The REST layer inherits that rule in the sharpest possible form: it exists
 * only in Supabase mode. There is no local mode for it — a server has no
 * IndexedDB to serve from — so a deployment without Supabase credentials
 * answers `503 SERVER_NOT_CONFIGURED` and says what is missing, rather than
 * starting up and appearing to work against nothing.
 *
 * The credential is a **secret key** (or the older service-role key), which
 * bypasses row level security. That is why it lives here and only here:
 *
 *  - it is read from a plain server variable, never a `VITE_`-prefixed one.
 *    Vite inlines `VITE_*` into the browser bundle, so a secret with that
 *    prefix is a secret published to everyone who loads the page;
 *  - the check below is not a comment about that, it is the check. A key that
 *    also appears under a `VITE_` name is refused outright, because by then it
 *    is in the bundle and the only correct answer is "rotate it";
 *  - and because RLS is bypassed, the repository the API builds is pinned to
 *    the token's owner and filters every query on it. See
 *    `SupabaseSlaidsRepository`'s constructor.
 */

import { MAX_ASSET_BYTES } from '../../domain/constants'
import { readOAuthConfig, type OAuthResourceConfig } from './oauth'

export const SUPABASE_URL_VARS = ['SLAIDS_SUPABASE_URL', 'SUPABASE_URL', 'VITE_SUPABASE_URL'] as const

/**
 * The variable the *browser* bundle is built from.
 *
 * Named here as well as in `src/supabase/config.ts`, and for a reason that is
 * this layer's own: it is the value the agent API has to agree with. See
 * `refuseWrongProject`.
 */
export const BROWSER_SUPABASE_URL_VAR = 'VITE_SUPABASE_URL'
export const SUPABASE_SECRET_VARS = ['SLAIDS_SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const
export const MAX_REQUEST_BYTES_VAR = 'SLAIDS_AGENT_MAX_REQUEST_BYTES'

/**
 * The address this deployment calls itself, for OAuth.
 *
 * Optional, and it only matters once OAuth is configured: a resource
 * identifier is a fixed string in OAuth, and pinning it means no request header
 * gets to decide what Slaids is called. Unset, the origin is read off the
 * request — which is correct on Vercel, where the apex redirects to `www.` long
 * before anything reaches this code, and which is what lets a preview
 * deployment describe itself rather than production.
 */
export const PUBLIC_ORIGIN_VAR = 'SLAIDS_PUBLIC_ORIGIN'

/**
 * How much of a request the API will read.
 *
 * Four megabytes because that is roughly where the serverless platforms in
 * front of this cut a request off anyway, and an agent should meet a Slaids
 * error it can read rather than a platform one it cannot. Raise it with
 * `SLAIDS_AGENT_MAX_REQUEST_BYTES` where the host allows more.
 */
export const DEFAULT_MAX_REQUEST_BYTES = 4 * 1024 * 1024

export interface AgentApiConfig {
  supabaseUrl: string
  /** Server-side only. Never logged, never returned, never sent anywhere else. */
  secretKey: string
  maxRequestBytes: number
  /**
   * The origin OAuth metadata speaks about, when the deployment pins one.
   *
   * `null` means "read it off the request". See `resourceOrigin`.
   */
  publicOrigin: string | null
  /**
   * The OAuth resource-server half, when this deployment offers one.
   *
   * `null` is not a degraded mode: it is a deployment that accepts agent tokens
   * and nothing else, exactly as Slaids did before OAuth existed. Turning it on
   * is a deliberate act — see `OAUTH_SWITCH_VAR` — because the API holds a key
   * that bypasses row level security and the Supabase project is shared.
   */
  oauth: OAuthResourceConfig | null
}

export type AgentApiConfigState =
  | { kind: 'configured'; config: AgentApiConfig }
  /** Nothing to serve from: which variables are missing. */
  | { kind: 'unconfigured'; missing: string[] }
  /** Configured with something that must not be used; `problem` says what. */
  | { kind: 'refused'; problem: string }

export type Env = Record<string, string | undefined>

function firstOf(env: Env, names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return { name, value }
  }
  return null
}

export function readAgentApiConfig(env: Env): AgentApiConfigState {
  const url = firstOf(env, SUPABASE_URL_VARS)
  const secret = firstOf(env, SUPABASE_SECRET_VARS)

  if (!url || !secret) {
    return {
      kind: 'unconfigured',
      missing: [
        ...(url ? [] : [SUPABASE_URL_VARS[0]]),
        ...(secret ? [] : [SUPABASE_SECRET_VARS[0]]),
      ],
    }
  }

  const refusal = refuse(env, secret.value, url)
  if (refusal) return { kind: 'refused', problem: refusal }

  return {
    kind: 'configured',
    config: {
      supabaseUrl: url.value,
      secretKey: secret.value,
      maxRequestBytes: readMaxRequestBytes(env[MAX_REQUEST_BYTES_VAR]),
      publicOrigin: env[PUBLIC_ORIGIN_VAR]?.trim().replace(/\/+$/, '') || null,
      oauth: readOAuthConfig(env, { supabaseUrl: url.value }),
    },
  }
}

/**
 * Reasons to stop rather than start.
 *
 * Each of these describes a deployment where the API would appear to work while
 * something is badly wrong — a publishable key that cannot read the tables, or
 * a secret that is already in the browser bundle. Failing loudly at the first
 * request is the only way either gets noticed.
 */
function refuse(env: Env, secret: string, url: { name: string; value: string }): string | null {
  const wrongProject = refuseWrongProject(env, url)
  if (wrongProject) return wrongProject
  if (secret.startsWith('sb_publishable_')) {
    return `${SUPABASE_SECRET_VARS[0]} er satt til en publishable-nøkkel. Agent-API-et trenger prosjektets secret key (eller service_role-nøkkelen), og den skal bare finnes i servermiljøet.`
  }
  if (secret === env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
    return `${SUPABASE_SECRET_VARS[0]} er den samme nøkkelen som VITE_SUPABASE_PUBLISHABLE_KEY. Den er beregnet på nettleseren og kommer ikke forbi row level security.`
  }
  const exposed = Object.keys(env).find(
    (name) => name.startsWith('VITE_') && env[name]?.trim() === secret,
  )
  if (exposed) {
    return `Hemmeligheten ligger også i ${exposed}. Alt som heter VITE_* bygges inn i nettleserbundelen, så nøkkelen er allerede offentlig – roter den i Supabase og sett den bare som en servervariabel.`
  }
  return null
}

/**
 * The agent API and the editor have to be the same database.
 *
 * They are configured separately — the browser reads `VITE_SUPABASE_URL` at
 * build time, this layer reads a server variable at startup — and nothing has
 * ever made them agree. Two values that must match, set in two places, is a way
 * for them to stop matching, and Slaids has just done the thing that makes it
 * likely: it moved to a Supabase project of its own, so both variables changed
 * at once and the old value is still lying around in a dashboard.
 *
 * What that failure looks like from outside is the reason it is worth a
 * refusal rather than a warning. Nothing errors. The editor signs in and shows
 * the owner's decks from project A; an agent authenticates, creates a
 * presentation and reads it back happily — out of project B. Every call
 * succeeds, `list_presentations` is simply empty, and an agent has no way to
 * tell "you have no decks" from "you are looking at the wrong database". The
 * audit rows land in B as well, so even the log agrees with itself.
 *
 * Compared by **project reference** — the first label of `<ref>.supabase.co`,
 * which is what identifies a project in the dashboard, in the issuer and in the
 * key set address. A trailing slash and a capitalised hostname are the same
 * project, and comparing whole strings would call them different.
 *
 * And it only refuses when it can *prove* a mismatch: both sides have to name a
 * project reference, and the two have to differ. A custom domain in front of a
 * project — `db.example.no` for `https://ref.supabase.co` — carries no
 * reference at all, so a deployment where the browser uses one and the server
 * uses the canonical URL is the same project written two ways, and refusing it
 * would take the whole API down over a configuration that is correct. "Cannot
 * tell" is not "different", and a refusal is too heavy a hammer to swing on a
 * guess. What is left is exactly the failure this was written for: two
 * `<ref>.supabase.co` URLs naming two projects, which is what a project move
 * leaves behind.
 */
function refuseWrongProject(env: Env, chosen: { name: string; value: string }): string | null {
  const browser = env[BROWSER_SUPABASE_URL_VAR]?.trim()
  if (!browser || chosen.name === BROWSER_SUPABASE_URL_VAR) return null

  const here = projectRef(chosen.value)
  const there = projectRef(browser)
  if (here === null || there === null || here === there) return null

  return (
    `${chosen.name} og ${BROWSER_SUPABASE_URL_VAR} peker på hvert sitt Supabase-prosjekt ` +
    `(${here} og ${there}). Agent-API-et ville da lest og skrevet ` +
    'i en annen database enn editoren, uten at noe av det feilet: en agent ville opprettet ' +
    'presentasjoner ingen ser i biblioteket, og sett et tomt bibliotek der eieren har dekkene sine. ' +
    'Sett begge til prosjektet Slaids faktisk bruker, og deploy på nytt.'
  )
}

/**
 * Which Supabase project a URL names, or `null` when it does not name one.
 *
 * `null` for anything that is not a `<ref>.supabase.<tld>` hostname: a custom
 * domain, a local stack, a proxy. None of those says which project is behind
 * it, and guessing from the origin would turn two correct spellings of one
 * project into a refusal. See `refuseWrongProject`.
 */
function projectRef(url: string): string | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  return /^([^.]+)\.supabase\.(?:co|in|red)$/.exec(host)?.[1] ?? null
}

/** A configured limit, clamped to something a request could plausibly need. */
function readMaxRequestBytes(raw: string | undefined): number {
  const parsed = Number(raw?.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_REQUEST_BYTES
  return Math.min(Math.max(Math.floor(parsed), 1024), MAX_ASSET_BYTES)
}

/** What a caller is told when the deployment cannot answer at all. */
export function describeUnavailable(state: AgentApiConfigState): string {
  if (state.kind === 'refused') return state.problem
  if (state.kind === 'unconfigured') {
    return `Agent-API-et er ikke satt opp: ${state.missing.join(' og ')} mangler i servermiljøet.`
  }
  return 'Agent-API-et er ikke tilgjengelig.'
}
