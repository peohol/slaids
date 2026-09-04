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
import type { SharingRepository, SlaidsRepository } from '../persistence/repository'
import type { SlidePreviewRenderer } from './preview'

/**
 * What an agent token may be allowed to do.
 *
 * Declared here rather than in the REST layer for one reason: the *operation*
 * knows what kind of authority it needs, and every transport that ever exposes
 * it needs the same answer. A second, hand-written table in the transport would
 * be a copy that drifts — and the way it drifts is that a new operation is not
 * in it, which is the failure that matters.
 *
 * Enforcement is still the transport's job (see `src/server/agent/`): Agent
 * Core runs in-process with exactly the access its caller already has, and a
 * check it performed on itself would not be one.
 *
 * The separation between the four is deliberate: editing a deck must not imply
 * publishing it (`sharing:write`), and being allowed to store a file must not
 * imply being allowed to rewrite slides. See `IMPLEMENTATION_PLAN.md` §44,
 * "Autentisering av agenter".
 */
export const AGENT_SCOPES = [
  'presentations:read',
  'presentations:write',
  'assets:write',
  'sharing:write',
] as const

export type AgentScope = (typeof AGENT_SCOPES)[number]

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === 'string' && (AGENT_SCOPES as readonly string[]).includes(value)
}

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
  /**
   * A folder id the library does not have.
   *
   * Only an agent can hit it, which is why it lives here rather than among the
   * domain codes: the library picks a folder from a list, and a document knows
   * nothing about folders beyond the `folderId` it carries. A move into a folder
   * that does not exist would not be visible anywhere — not at the root, not in
   * any folder — so it is refused rather than stored.
   */
  | 'FOLDER_NOT_FOUND'
  | 'STORAGE_FAILED'
  | 'CONFLICT'
  | 'SHARING_UNAVAILABLE'
  /** The deployment has no renderer to draw a preview with; see `preview.ts`. */
  | 'PREVIEW_UNAVAILABLE'
  | 'PREVIEW_FAILED'
  | 'INTERNAL_ERROR'

export type AgentErrorCode = DomainErrorCode | AgentOwnErrorCode

export interface AgentError {
  code: AgentErrorCode
  message: string
  /** Machine-readable context. Always JSON-serialisable. */
  details?: Record<string, unknown>
}

/** The failed half of a result, on its own, for code that only handles failure. */
export interface AgentFailure {
  ok: false
  error: AgentError
}

/**
 * Same shape as `domain/result.ts`, so a caller that already knows how to read
 * a command result does not have to learn a second convention.
 */
export type AgentResult<T> = { ok: true; value: T } | AgentFailure

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
  /**
   * Publishing, when the deployment has somewhere to publish to.
   *
   * Optional for the same reason `activeRepository.ts` makes it a separate
   * interface: local mode has no anonymous reader, so there is nothing to
   * share to. Absent means the sharing operations answer
   * `SHARING_UNAVAILABLE` — never a link that looks live and is not.
   */
  sharing?: SharingRepository
  fits?: ContentFitChecker
  fitsTitle?: TitleFitChecker
  geometry?: GeometryOptions
  /**
   * Rendered visual feedback, when the deployment can draw it.
   *
   * Injected for the same reason the fit checkers are, and one more: drawing a
   * slide the way a viewer sees it means React, a stylesheet and a browser, and
   * Agent Core is required to work without any of the three. Absent means the
   * preview operation answers `PREVIEW_UNAVAILABLE` and says what is missing —
   * an approximate picture would be worse than none, because an agent would
   * correct a composition that is not the one anybody will see.
   */
  preview?: SlidePreviewRenderer
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
  /**
   * The authority a caller must hold for this operation, all of it.
   *
   * Required rather than defaulted, so an operation added later cannot inherit
   * "whatever the least privileged token has" by saying nothing. `registry.test.ts`
   * checks the other half: that a mutating operation always asks for a write scope.
   */
  scopes: readonly [AgentScope, ...AgentScope[]]
  input: z.ZodType
  /**
   * What a transport may publish, when that is narrower than what the function
   * accepts. Only `upload_asset` needs it today: in-process callers may hand
   * over a `Blob` or a `Uint8Array`, and neither of those is a thing a JSON
   * request can contain. Absent means the two are the same.
   */
  transportInput?: z.ZodType
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
