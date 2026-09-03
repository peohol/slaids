/**
 * The tool catalogue, which is the operation catalogue with a prefix on it.
 *
 * §44 asks for MCP to be an adapter over Agent Core rather than a second
 * implementation, and the sharpest form of that is this file: there is no list
 * of tools in it. `describeOperations()` is the same call the REST catalogue
 * makes, so a tool's name, its description and its JSON Schema are the
 * operation's own — and an operation added tomorrow is a tool tomorrow, without
 * anyone remembering to come here.
 *
 * `tools.test.ts` holds the other half of that claim: no operation name appears
 * as a literal anywhere in this directory.
 *
 * What this file *does* decide is the handful of things MCP asks for that an
 * operation does not know it has:
 *
 *  - the **prefix**. A client holds every server's tools in one flat namespace,
 *    and short verbs like "add a slide" or "store this file" are names two
 *    servers could both pick; `slaids_` in front of the operation's own name
 *    settles it. It is a namespace, not part of the name, which is why
 *    `operationNameForTool` accepts the bare name too: an agent that read the
 *    REST catalogue is not wrong about which operation it means.
 *  - the **annotations**, both derived rather than declared. `readOnlyHint` is
 *    `!mutates`, and `openWorldHint` is false because every operation acts on
 *    the owner's own decks and nothing else. `destructiveHint` is deliberately
 *    absent: telling a delete from an insert would take a per-operation field
 *    that does not exist, and inventing one here as a list of names is exactly
 *    the second contract this file is built to avoid. Its own default — "a
 *    write may be destructive" — is the honest answer instead.
 *  - the **protocol version**, negotiated in `initialize`.
 */

import { AGENT_TOOL_PREFIX, describeOperations } from '../../agent/registry'
import type { AgentScope } from '../../agent/types'

/**
 * The one revision this server implements — and therefore the only one it
 * announces.
 *
 * The list used to be longer, and that was a bug rather than generosity. A
 * server that answers `2025-03-26` is promising a peer that it accepts JSON-RPC
 * batches, which this endpoint refuses outright; one that answers `2024-11-05`
 * is promising the older HTTP+SSE transport, with a separate SSE endpoint and a
 * separate POST endpoint, neither of which exists here. Announcing either would
 * be telling a client it may do things that would then fail — and negotiation
 * exists precisely so a client can learn what a server actually implements.
 *
 * So it is one entry, and it stays a list because the *rule* — answer with the
 * requested revision when we implement it, otherwise with one we do — is what
 * survives the day a second revision is implemented.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_MCP_PROTOCOL_VERSIONS: readonly string[] = [MCP_PROTOCOL_VERSION]

export interface McpToolAnnotations {
  readOnlyHint: boolean
  openWorldHint: boolean
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: McpToolAnnotations
  /**
   * The scopes, published so an agent can tell in advance which of its calls a
   * token will refuse. Off `operation.scopes`, the same field the server
   * enforces — the catalogue and the check cannot disagree, because there is
   * only one of them.
   */
  _meta: Record<string, unknown>
}

/**
 * A tool's description.
 *
 * The operation's own summary, and then two facts an MCP client cannot read off
 * anything else: what the call costs in authority, and whether it writes. Both
 * are derived from the operation, so this is a rendering of the contract rather
 * than a second copy of it.
 */
function describeTool(summary: string, scopes: readonly AgentScope[], mutates: boolean): string {
  const kind = mutates ? 'Endrer presentasjonen.' : 'Leser bare.'
  return `${summary}\n\n${kind} Krever ${scopes.join(' + ')}.`
}

/**
 * Built once per warm instance.
 *
 * `describeOperations()` runs every operation's schema through JSON Schema
 * generation, which is pure and identical on every call — so a client that
 * lists tools on each reconnection should not pay for it each time. Frozen so
 * "the catalogue is the registry" cannot quietly stop being true because a
 * caller edited what it was handed.
 */
let cached: readonly McpToolDefinition[] | null = null

export function mcpTools(): readonly McpToolDefinition[] {
  if (!cached) {
    cached = Object.freeze(
      describeOperations().map((operation) =>
        Object.freeze({
          name: operation.toolName,
          description: describeTool(operation.summary, operation.requiredScopes, operation.mutates),
          inputSchema: operation.inputSchema,
          annotations: { readOnlyHint: !operation.mutates, openWorldHint: false },
          _meta: {
            'slaids/operation': operation.name,
            'slaids/requiredScopes': operation.requiredScopes,
          },
        }),
      ),
    )
  }
  return cached
}

/** Test seam: forget the built catalogue, as a cold start would. */
export function resetMcpTools(): void {
  cached = null
}

/**
 * The operation a tool name refers to.
 *
 * Total on purpose: whether the name exists is the registry's answer, not this
 * function's, so an unknown tool produces Agent Core's own `UNKNOWN_OPERATION`
 * — with the real names in it — rather than a second not-found written here.
 */
export function operationNameForTool(toolName: string): string {
  return toolName.startsWith(AGENT_TOOL_PREFIX)
    ? toolName.slice(AGENT_TOOL_PREFIX.length)
    : toolName
}

/**
 * The revision to answer `initialize` with, given what the client asked for.
 *
 * The specification's rule, and nothing else: the same revision back when this
 * server implements it, and otherwise one it does implement — which the client
 * then accepts or disconnects over. What it must never do is echo a revision
 * this server has not implemented, because the client would believe it and
 * proceed to use it.
 *
 * With one entry in the list that means it always answers `MCP_PROTOCOL_VERSION`.
 * That is the honest answer to a newer client too: it asked for something this
 * server does not speak, and it is told what this server does speak.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION
}

/** Whether a client may present this revision in `MCP-Protocol-Version`. */
export function isSupportedProtocolVersion(version: string): boolean {
  return SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(version)
}
