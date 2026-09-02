/**
 * The Agent Core contract.
 *
 * This layer is what an agent talks to, and it is deliberately transport-free:
 * no HTTP, no MCP, no vendor SDK, no model-specific anything. A REST route or
 * an MCP tool is a thin adapter that parses a request, calls `runOperation` and
 * serialises the answer — everything that *decides* lives here and in the
 * domain commands underneath.
 *
 * Operations are semantic ("place this asset in that zone"), never "write this
 * JSON": the same rules that guard the editor — fit, tree invariants, typed
 * errors — are the rules an agent meets, because it is the same code.
 */

import type { z } from 'zod'
import type { ContentFitChecker, TitleFitChecker } from '../domain/fit'
import type { GeometryOptions } from '../domain/geometry'
import type { DomainError, DomainErrorCode } from '../domain/result'
import type { SlaidsRepository } from '../persistence/repository'

/**
 * Errors an agent can be handed.
 *
 * Domain codes pass straight through: an agent that puts too much content in a
 * zone gets exactly the `CONTENT_DOES_NOT_FIT` the editor would have shown. The
 * codes added here are the ones only a headless caller can hit — a request that
 * never reached a command, or a store that refused the write.
 */
export type AgentOwnErrorCode =
  | 'UNKNOWN_OPERATION'
  | 'INVALID_INPUT'
  | 'PRESENTATION_NOT_FOUND'
  | 'STORAGE_FAILED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export type AgentErrorCode = DomainErrorCode | AgentOwnErrorCode

export interface AgentError {
  code: AgentErrorCode
  message: string
  /** Machine-readable context. Always JSON-serialisable. */
  details?: Record<string, unknown>
}

/**
 * Same shape as `domain/result.ts`, so a caller that already knows how to read
 * a command result does not have to learn a second convention.
 */
export type AgentResult<T> = { ok: true; value: T } | { ok: false; error: AgentError }

/**
 * Everything an operation needs from the outside world.
 *
 * The repository is injected rather than imported so the agent layer works
 * against Dexie, Supabase or a test double without knowing which. The fit
 * checkers are injected for the same reason they are on the commands: a caller
 * inside the browser can measure against the real DOM, and a headless caller
 * falls back to the pure estimator.
 */
export interface AgentContext {
  repository: SlaidsRepository
  fits?: ContentFitChecker
  fitsTitle?: TitleFitChecker
  geometry?: GeometryOptions
}

/**
 * One semantic operation.
 *
 * `input` is a Zod schema, which is both the runtime validation and the
 * machine-readable description a transport publishes — JSON Schema for MCP, a
 * request body for REST — so the two can never drift apart. It is typed loosely
 * here and tied to `Input` by `defineOperation`, which is the only way an
 * operation is ever built.
 */
export interface AgentOperation<Input, Output> {
  name: string
  summary: string
  /** Whether the operation writes. A transport maps this to a verb or an annotation. */
  mutates: boolean
  input: z.ZodType
  run(context: AgentContext, input: Input): Promise<AgentResult<Output>>
}

/** An operation with its types erased, as the registry stores them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentOperation = AgentOperation<any, unknown>

export function agentOk<T>(value: T): AgentResult<T> {
  return { ok: true, value }
}

export function agentErr<T = never>(
  code: AgentErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AgentResult<T> {
  return { ok: false, error: details ? { code, message, details } : { code, message } }
}

/** A domain command's error, unchanged, as an agent error. */
export function fromDomainError<T = never>(error: DomainError): AgentResult<T> {
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  }
}
