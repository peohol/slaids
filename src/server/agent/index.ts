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
 */

import { SupabaseAgentTokens } from '../../persistence/agentTokens'
import { readAgentApiConfig, describeUnavailable, type Env, type AgentApiConfigState } from './config'
import { handleAgentRequest, type AgentApiDeps } from './handler'
import { errorResponse } from './protocol'
import { agentContextFor, authenticateAgentToken, createServerClient, supabaseAuditSink } from './supabase'

export * from './audit'
export * from './body'
export * from './config'
export * from './handler'
export * from './protocol'
export * from './tokens'

/** The dependencies for a configured deployment. Built once, reused warm. */
function depsFor(state: Extract<AgentApiConfigState, { kind: 'configured' }>): AgentApiDeps {
  const client = createServerClient(state.config)
  const tokens = new SupabaseAgentTokens(() => client)
  const audit = supabaseAuditSink(client)

  return {
    authenticate: (presented) => authenticateAgentToken(tokens, presented, new Date()),
    contextFor: (principal) => agentContextFor(client, principal),
    audit,
    maxRequestBytes: state.config.maxRequestBytes,
    now: () => new Date(),
  }
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
    cached = { deps: depsFor(state) }
  }
  return handleAgentRequest(cached.deps, request)
}

/** Test seam: forget the resolved environment, as a cold start would. */
export function resetAgentApi(): void {
  cached = null
}
