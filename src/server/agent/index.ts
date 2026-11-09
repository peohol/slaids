/**
 * The agent API, wired to its environment.
 *
 * Everything that decides lives in the files next to this one, injected into
 * `handleAgentRequest`. This is the seam where the injections become real: read
 * the environment, build the Supabase client once per warm instance, and hand
 * the handler a token lookup, a repository factory and an audit sink.
 *
 * A deployment without Supabase credentials answers `503` and says which
 * variables are missing. That is the storage-mode invariant from `CLAUDE.md`
 * taken to its conclusion: there is no local mode for a server, so there is
 * nothing to quietly fall back to, and a REST layer that appeared to work
 * against nothing would be the worst of the available answers.
 *
 * This file is also the one place in `src/server/` that reaches into
 * `src/render/`, and the exception is deliberate rather than incidental. A
 * rendered preview has to be drawn by Slaids' own renderer — §44 is explicit
 * that it must not be a separate one — and that renderer is React over the
 * app's own stylesheets, which is exactly the dependency the rest of this
 * directory is forbidden to have. So it is held behind one function, imported
 * at the seam where every other injection also becomes real, and
 * `boundary.test.ts` keeps it to this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SlidePreviewRenderer } from '../../agent/preview'
import { SupabaseAgentTokens } from '../../persistence/agentTokens'
import { readUserAccess } from '../../persistence/slaidsUsers'
import { chromiumSlidePreviewRenderer } from '../../render/preview'
import { sessionUserResolver, supabaseAdminUserStore } from '../admin/supabase'
import {
  readAgentApiConfig,
  describeUnavailable,
  type AgentApiConfig,
  type Env,
  type AgentApiConfigState,
} from './config'
import { handleAgentRequest, type AgentApiDeps } from './handler'
import type { JwksCache } from './oauth'
import { errorResponse } from './protocol'
import {
  agentContextFor,
  authenticateAgentToken,
  createServerClient,
  oauthAuthenticator,
  supabaseAuditSink,
} from './supabase'

export * from './audit'
export * from './body'
export * from './config'
export * from './handler'
export * from './invoke'
export * from './oauth'
export * from './protocol'
export * from './resourceMetadata'
export * from './tokens'
/**
 * The MCP tool catalogue, exported from the deployment's own entry point.
 *
 * Not because the platform calls it — the endpoint is routed through
 * `handleAgentRequest` like everything else — but because it is the one part of
 * the published contract that is *generated* rather than written, inside the
 * bundle, at request time. `scripts/check-agent-bundle.mjs` builds it in plain
 * Node during the build, so a schema that cannot be expressed in JSON Schema
 * fails there instead of turning every client's first `tools/list` into a 500.
 */
export * from '../mcp/tools'

/**
 * The deployment's dependencies, from a Supabase client.
 *
 * Exported so the tests can wire a deployment exactly as production does —
 * every lookup, the access-list check, the repository pinning and the audit —
 * against a stand-in for the database instead of a real one. `depsFor` below is
 * the only production caller, and it only adds the real client and renderer.
 */
export function wireAgentApi(input: {
  client: SupabaseClient
  config: AgentApiConfig
  preview?: SlidePreviewRenderer
  now?: () => Date
  /** The OAuth key cache; built from `config.oauth` when not given. */
  jwks?: JwksCache
}): AgentApiDeps {
  const { client, config, preview } = input
  const now = input.now ?? ((): Date => new Date())
  const tokens = new SupabaseAgentTokens(() => client)
  const audit = supabaseAuditSink(client)
  // Slaids' access list, asked on every request for the owner a verified
  // credential names — never for an id the request supplies.
  const ownerAccess = (ownerId: string) => readUserAccess(client, ownerId)

  return {
    authenticate: (presented) => authenticateAgentToken(tokens, ownerAccess, presented, now()),
    // Present only when this deployment has an authorization server, so "does
    // Slaids take OAuth here?" is one question with one answer: the presence of
    // this function, the metadata document and the `resource_metadata` in the
    // challenge all come from the same `config.oauth`.
    ...(config.oauth
      ? {
          authenticateOAuth: oauthAuthenticator(config.oauth, ownerAccess, now, input.jwks),
          oauth: config.oauth,
        }
      : {}),
    publicOrigin: config.publicOrigin,
    admin: { sessionUser: sessionUserResolver(client), store: supabaseAdminUserStore(client) },
    contextFor: (principal) => agentContextFor(client, principal, preview),
    audit,
    maxRequestBytes: config.maxRequestBytes,
    now,
  }
}

/** The dependencies for a configured deployment. Built once, reused warm. */
function depsFor(
  state: Extract<AgentApiConfigState, { kind: 'configured' }>,
  env: Env,
): AgentApiDeps {
  return wireAgentApi({
    client: createServerClient(state.config),
    config: state.config,
    // One renderer for the instance: it owns a browser, and starting one per
    // request would be most of the request. It holds no caller state, so there
    // is nothing to leak between two tokens.
    preview: chromiumSlidePreviewRenderer({ env }),
  })
}

let cached: { deps: AgentApiDeps } | null = null

/**
 * Handle one request, resolving the environment on the first call.
 *
 * `env` is a parameter so a test can drive the whole thing without touching the
 * process, and so a misconfigured deployment is a value rather than a crash at
 * import time — a module that throws while loading answers every request with a
 * platform error page instead of an error an agent can read.
 */
export async function serveAgentApi(request: Request, env: Env): Promise<Response> {
  if (!cached) {
    const state = readAgentApiConfig(env)
    if (state.kind !== 'configured') {
      return errorResponse({ code: 'SERVER_NOT_CONFIGURED', message: describeUnavailable(state) })
    }
    cached = { deps: depsFor(state, env) }
  }
  return handleAgentRequest(cached.deps, request)
}

/** Test seam: forget the resolved environment, as a cold start would. */
export function resetAgentApi(): void {
  cached = null
}
