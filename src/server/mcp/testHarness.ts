/**
 * A deployment with one token in it, for the MCP tests.
 *
 * Shared between `endpoint.test.ts` and `parity.test.ts` because the second one
 * has to drive *both* transports against the same store: "REST and MCP answer
 * the same thing" is only a claim about the API if it is the same presentation
 * in the same database, read twice.
 *
 * The repository is the real Dexie one rather than a stub, so a claim like
 * "nothing was written" is about stored state instead of about which method a
 * double happened to see. Nothing here is production code; it is `src/`-side for
 * the same reason `src/domain/testImages.ts` is — the tests that need it run
 * under the repository's own module resolution.
 *
 * It imports no test framework on purpose, so this file could never be pulled
 * into the server bundle by an import somebody adds later: the unwrappers below
 * throw rather than assert, which reads the same in a failure and costs nothing.
 */

import type { SlidePreviewRenderer } from '../../agent/preview'
import { runOperation } from '../../agent/registry'
import type { AgentContext, AgentScope } from '../../agent/types'
import { DexieSlaidsRepository } from '../../persistence/dexieRepository'
import { SlaidsDatabase } from '../../persistence/db'
import type { AgentAuditRecord, AgentAuditSink } from '../agent/audit'
import { handleAgentRequest, type AgentApiDeps } from '../agent/handler'
import type { AgentPrincipal, AuthOutcome } from '../agent/tokens'
import { AGENT_API_BASE_PATH, AGENT_MCP_PATH } from '../../routing'
import type { JsonRpcId, JsonRpcResponse } from './jsonrpc'
import { resultText, type McpToolResult } from './result'

export const ORIGIN = 'https://slaids.example'
export const TOKEN = 'slaids_at_0123456789012345678901234567890123456789012'

export const ALL_SCOPES: AgentScope[] = [
  'presentations:read',
  'presentations:write',
  'assets:write',
  'sharing:write',
]

export class MemoryAudit implements AgentAuditSink {
  readonly entries: AgentAuditRecord[] = []

  record(entry: AgentAuditRecord): Promise<void> {
    this.entries.push(entry)
    return Promise.resolve()
  }
}

export interface Harness {
  deps: AgentApiDeps
  audit: MemoryAudit
  context: AgentContext
  database: SlaidsDatabase
}

let counter = 0
const databases: SlaidsDatabase[] = []

export async function closeHarnessDatabases(): Promise<void> {
  while (databases.length > 0) await databases.pop()?.delete()
}

export function harness(
  options: {
    scopes?: AgentScope[]
    /**
     * A preview renderer, for the tests about rendered visual feedback.
     *
     * Absent is the honest default: a deployment without one answers
     * `PREVIEW_UNAVAILABLE`, and a harness that always had one would hide that.
     */
    preview?: SlidePreviewRenderer
  } = {},
): Harness {
  counter += 1
  const database = new SlaidsDatabase(`slaids-mcp-${counter}`)
  databases.push(database)
  const context: AgentContext = {
    repository: new DexieSlaidsRepository(database),
    ...(options.preview ? { preview: options.preview } : {}),
  }
  const audit = new MemoryAudit()

  const principal: AgentPrincipal = {
    tokenId: 'token-1',
    tokenName: 'Testagenten',
    ownerId: 'owner-1',
    scopes: options.scopes ?? ALL_SCOPES,
  }

  return {
    audit,
    context,
    database,
    deps: {
      authenticate: (presented): Promise<AuthOutcome> =>
        Promise.resolve(
          presented === TOKEN ? { ok: true, principal } : { ok: false, reason: 'unknown' },
        ),
      contextFor: () => context,
      audit,
      maxRequestBytes: 1024 * 1024,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    },
  }
}

/* ------------------------------------------------------------------ *
 * Talking MCP
 * ------------------------------------------------------------------ */

let nextId = 0

export function mcpRequest(
  method: string,
  params?: Record<string, unknown>,
  init: RequestInit = {},
): Request {
  nextId += 1
  return new Request(`${ORIGIN}${AGENT_MCP_PATH}`, {
    ...init,
    method: 'POST',
    // Merged last, so a caller can add or override one header without losing
    // the token — which is the whole point of the helper.
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextId,
      method,
      ...(params ? { params } : {}),
    }),
  })
}

export interface McpAnswer {
  status: number
  body: JsonRpcResponse
}

export async function mcp(
  harnessed: Harness,
  method: string,
  params?: Record<string, unknown>,
): Promise<McpAnswer> {
  const response = await handleAgentRequest(harnessed.deps, mcpRequest(method, params))
  return { status: response.status, body: (await response.json()) as JsonRpcResponse }
}

/** Send whatever this is, verbatim, as the body of one MCP request. */
export async function mcpRaw(
  harnessed: Harness,
  body: string,
  init: RequestInit = {},
): Promise<Response> {
  return handleAgentRequest(
    harnessed.deps,
    new Request(`${ORIGIN}${AGENT_MCP_PATH}`, {
      ...init,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      body,
    }),
  )
}

export function resultOf(answer: McpAnswer): Record<string, unknown> {
  if ('error' in answer.body) {
    throw new Error(`Forventet et resultat, fikk JSON-RPC-feil ${JSON.stringify(answer.body.error)}`)
  }
  return answer.body.result as Record<string, unknown>
}

export function jsonRpcFailureOf(answer: McpAnswer): { code: number; message: string; data?: unknown } {
  if (!('error' in answer.body)) throw new Error('Forventet en JSON-RPC-feil, fikk et resultat.')
  return answer.body.error
}

/** One tool call, exactly as sent — envelope and all, for a test that cares. */
export async function toolCall(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpAnswer> {
  const answer = await mcp(harnessed, 'tools/call', { name, arguments: args })
  if (answer.status !== 200) {
    throw new Error(`Forventet 200 fra tools/call, fikk ${answer.status}`)
  }
  return answer
}

/** One tool call that reached a tool, unwrapped to its `CallToolResult`. */
export async function callTool(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> {
  return resultOf(await toolCall(harnessed, name, args)) as unknown as McpToolResult
}

/** A tool call that is expected to have worked, unwrapped to its structured half. */
export async function callOk(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await callTool(harnessed, name, args)
  if (result.isError || !result.structuredContent) {
    throw new Error(`Forventet at «${name}» gikk bra, fikk ${resultText(result) || '(ingenting)'}`)
  }
  return result.structuredContent
}

export interface McpToolError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * A tool call refused by the tool itself, unwrapped to its error.
 *
 * A *result* with `isError`, which is where an operation's own refusals go —
 * content that does not fit, a stale revision, a scope the token lacks. Throws
 * if the refusal came back as a protocol error instead, because then the call
 * never reached a tool and the test is asserting the wrong half of the split.
 */
export async function callError(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolError> {
  const result = await callTool(harnessed, name, args)
  if (!result.isError) {
    throw new Error(`Forventet at «${name}» ble avvist, men den gikk gjennom.`)
  }
  return (result.structuredContent as { error: McpToolError }).error
}

/**
 * A call that was never a valid invocation, unwrapped to its protocol error.
 *
 * An unknown tool, or arguments that do not match the one it named. The
 * JSON-RPC error's `data` is Agent Core's own error object, so the code and
 * details are the same ones REST returns.
 */
export async function callProtocolError(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ code: number; error: McpToolError }> {
  const failure = jsonRpcFailureOf(await toolCall(harnessed, name, args))
  return { code: failure.code, error: failure.data as McpToolError }
}

/** Which envelope a refusal arrived in, and the error inside it. */
export interface ToolFailure {
  envelope: 'result' | 'protocol'
  error: McpToolError
}

/**
 * A refused call, whichever envelope carried it.
 *
 * For the tests that sweep the whole surface: they assert the *payload* is the
 * one REST returns, and report the envelope so a change of side is visible
 * rather than silently absorbed.
 */
export async function callFailure(
  harnessed: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolFailure> {
  const answer = await toolCall(harnessed, name, args)
  if ('error' in answer.body) {
    return { envelope: 'protocol', error: answer.body.error.data as McpToolError }
  }
  const result = answer.body.result as unknown as McpToolResult
  if (!result.isError) throw new Error(`Forventet at «${name}» ble avvist, men den gikk gjennom.`)
  return { envelope: 'result', error: (result.structuredContent as { error: McpToolError }).error }
}

/* ------------------------------------------------------------------ *
 * Talking REST, for the parity tests
 * ------------------------------------------------------------------ */

export interface RestAnswer {
  status: number
  body: {
    ok: boolean
    operation?: string
    revision?: string
    data?: unknown
    error?: McpToolError
  }
}

export async function rest(
  harnessed: Harness,
  operation: string,
  input: Record<string, unknown> = {},
): Promise<RestAnswer> {
  const response = await restRaw(harnessed, operation, input, {
    headers: { Accept: 'application/json' },
  })
  return { status: response.status, body: (await response.json()) as RestAnswer['body'] }
}

/**
 * One REST call, unparsed.
 *
 * `rest` above asks for JSON, which every operation but one answers with
 * anyway. A rendered preview answers with the picture itself unless asked
 * otherwise, so a test about *that* has to see the response rather than a body
 * somebody already decided how to read.
 */
export function restRaw(
  harnessed: Harness,
  operation: string,
  input: Record<string, unknown> = {},
  init: {
    headers?: Record<string, string>
    /** `null` to send no `Authorization` at all, for the unauthenticated cases. */
    token?: string | null
  } = {},
): Promise<Response> {
  const token = init.token === undefined ? TOKEN : init.token
  return handleAgentRequest(
    harnessed.deps,
    new Request(`${ORIGIN}${AGENT_API_BASE_PATH}/operations/${operation}`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        ...init.headers,
      },
      body: JSON.stringify(input),
    }),
  )
}

/**
 * A deck put straight into this harness's store, past the transport.
 *
 * For the tests whose subject is what a *token* may do: a read-only token
 * cannot create the deck it is then supposed to be allowed to render, and
 * creating it in a second harness would put it in a second database. Agent Core
 * runs in-process with its caller's access, so this is the same code with no
 * scope check in front of it — which is exactly what a fixture wants.
 */
export async function seedDeck(
  harnessed: Harness,
  title = 'Seedet dekk',
): Promise<{ presentationId: string; slideId: string; rootNodeId: string; revision: string }> {
  const created = await runOperation(harnessed.context, 'create_presentation', { title })
  if (!created.ok) throw new Error(`Kunne ikke opprette dekket: ${created.error.code}`)
  const deck = created.value as { presentationId: string; slides: { slideId: string }[] }
  const inspected = await runOperation(harnessed.context, 'inspect_slide', {
    presentationId: deck.presentationId,
    slideId: deck.slides[0].slideId,
  })
  if (!inspected.ok) throw new Error(`Kunne ikke inspisere sliden: ${inspected.error.code}`)
  const slide = inspected.value as { rootNodeId: string; revision: string }
  return {
    presentationId: deck.presentationId,
    slideId: deck.slides[0].slideId,
    rootNodeId: slide.rootNodeId,
    revision: slide.revision,
  }
}

/** The id and revision of a fresh presentation, made the way an agent would. */
export async function newPresentation(
  harnessed: Harness,
  title = 'Agentdekk',
): Promise<{ presentationId: string; revision: string; slideId: string; rootNodeId: string }> {
  const created = await callOk(harnessed, 'slaids_create_presentation', { title })
  const presentationId = created.presentationId as string
  const slideId = (created.slides as { slideId: string }[])[0].slideId
  const inspected = await callOk(harnessed, 'slaids_inspect_slide', { presentationId, slideId })
  return {
    presentationId,
    slideId,
    revision: inspected.revision as string,
    rootNodeId: inspected.rootNodeId as string,
  }
}

export type { JsonRpcId }
