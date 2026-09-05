/**
 * What the agent API needs from its environment, and what it refuses.
 *
 * Slaids has two storage modes and no fallback between them (see `CLAUDE.md`).
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
   * is a deliberate act — see `OAUTH_OWNERS_VAR` — because the API holds a key
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

  const refusal = refuse(env, secret.value)
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
function refuse(env: Env, secret: string): string | null {
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
