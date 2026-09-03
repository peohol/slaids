/**
 * The agent API's side of Supabase: the only impure part of this layer.
 *
 * Three things live here, and each of them is a round trip the rules in the
 * neighbouring files deliberately do not know how to make:
 *
 *  - the server-side client, built from the secret key. It bypasses row level
 *    security, which is exactly why the repository it feeds is pinned to the
 *    token's owner and filters every query on it. Nothing here ever takes an
 *    owner from a caller.
 *  - looking a presented token up by its hash and marking it used;
 *  - writing one audit row per call.
 *
 * The client is memoised at module scope so a warm serverless instance reuses
 * it. The *repository* deliberately is not: it remembers which database version
 * each reading came from, and that memory is what makes a guarded save a guard.
 * Sharing it between requests would let one request's write be guarded by
 * another request's reading, which is the exact overwrite the guard exists to
 * stop.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AgentContext } from '../../agent/types'
import { AGENT_AUDIT_TABLE, hashAgentToken } from '../../persistence/agentTokens'
import type { SupabaseAgentTokens } from '../../persistence/agentTokens'
import { SupabaseSlaidsRepository } from '../../persistence/supabaseRepository'
import type { AgentAuditRecord, AgentAuditSink } from './audit'
import type { AgentApiConfig } from './config'
import { tokenValidity, type AgentPrincipal, type AuthOutcome } from './tokens'

export function createServerClient(config: AgentApiConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.secretKey, {
    // There is no browser here and no session to keep: the agent token is the
    // credential, and it is presented on every request.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/**
 * Resolve a presented token.
 *
 * The lookup is by hash, which is both the security property and the reason
 * this is a single indexed equality: nothing compares two secrets in
 * JavaScript, so there is no timing signal to read.
 *
 * `last_used_at` is written only for a token that was accepted, and a failure to
 * write it is swallowed: the owner losing a timestamp is a smaller problem than
 * an agent losing a request over bookkeeping.
 */
export async function authenticateAgentToken(
  tokens: SupabaseAgentTokens,
  presentedToken: string,
  now: Date,
): Promise<AuthOutcome> {
  let outcome: AuthOutcome
  try {
    outcome = tokenValidity(await tokens.findByHash(await hashAgentToken(presentedToken)), now)
  } catch (error) {
    // A store that did not answer is not a caller who presented a bad token,
    // and the log should say so — but the answer outward is the same 401, so a
    // probe cannot tell the difference either.
    console.error('slaids-agent: kunne ikke slå opp agenttokenet', error)
    return { ok: false, reason: 'unavailable' }
  }

  if (outcome.ok) {
    try {
      await tokens.touch(outcome.principal.tokenId, now)
    } catch (error) {
      console.warn('slaids-agent: kunne ikke oppdatere last_used_at', error)
    }
  }
  return outcome
}

/**
 * Agent Core's context for one request.
 *
 * A fresh repository every time, pinned to the token's owner. It is the same
 * class the editor uses, with the same commands and the same fit checkers
 * underneath — an agent gets Slaids' rules because it is Slaids' code, not
 * because the REST layer reimplements them.
 *
 * `sharing` is the same object: `SupabaseSlaidsRepository` implements both
 * interfaces, and publishing needs the public backend that only exists here.
 */
export function agentContextFor(client: SupabaseClient, principal: AgentPrincipal): AgentContext {
  const repository = new SupabaseSlaidsRepository(() => client, principal.ownerId)
  return { repository, sharing: repository }
}

/**
 * One row per call.
 *
 * The insert lists the columns explicitly, from a record whose shape is fixed in
 * `audit.ts`. There is no `payload` column and no object spread that could grow
 * one — which is what keeps §44's "ikke logg slideinnhold, binærfiler eller
 * komplette payloads" a property of the schema rather than a habit.
 */
export function supabaseAuditSink(client: SupabaseClient): AgentAuditSink {
  return {
    async record(entry: AgentAuditRecord): Promise<void> {
      const { error } = await client.from(AGENT_AUDIT_TABLE).insert({
        owner_id: entry.ownerId,
        token_id: entry.tokenId,
        token_name: entry.tokenName,
        at: entry.at,
        operation: entry.operation,
        presentation_id: entry.presentationId,
        success: entry.success,
        error_code: entry.errorCode,
        status: entry.status,
        duration_ms: entry.durationMs,
      })
      if (error) throw new Error(error.message)
    },
  }
}
