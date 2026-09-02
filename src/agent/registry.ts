/**
 * The operation registry and the one way in.
 *
 * A transport does three things: work out which operation was asked for, hand
 * the raw input to `runOperation`, and serialise what comes back. It never
 * validates, never maps errors and never reaches past this file into the
 * domain — which is what keeps REST, MCP and a test calling the same code with
 * the same rules.
 */

import { z } from 'zod'
import { RepositoryConflictError, RepositoryError } from '../persistence/repository'
import { assetOperations } from './operations/assets'
import { contentOperations } from './operations/content'
import { deckOperations } from './operations/deck'
import { layoutOperations } from './operations/layout'
import { referenceOperations } from './operations/references'
import { slideOperations } from './operations/slides'
import { validationOperations } from './operations/validation'
import { agentErr, type AgentContext, type AgentResult, type AnyAgentOperation } from './types'

/**
 * What an MCP server prefixes its tool names with.
 *
 * The operations themselves are named without it: a REST route is
 * `POST /operations/upload_asset`, and only the MCP adapter needs
 * `slaids_upload_asset` to stay unambiguous among other servers' tools.
 */
export const AGENT_TOOL_PREFIX = 'slaids_'

export const operations: readonly AnyAgentOperation[] = [
  ...deckOperations,
  ...slideOperations,
  ...layoutOperations,
  ...contentOperations,
  ...referenceOperations,
  ...assetOperations,
  ...validationOperations,
]

const byName = new Map<string, AnyAgentOperation>(
  operations.map((operation) => [operation.name, operation]),
)

export function findOperation(name: string): AnyAgentOperation | null {
  return byName.get(name) ?? null
}

/** One operation, as a transport would publish it. */
export interface OperationDescription {
  name: string
  toolName: string
  summary: string
  mutates: boolean
  /**
   * JSON Schema for what may be sent over a wire.
   *
   * Generated from the operation's `transportInput` when it has one, and from
   * its `input` otherwise — and generated with `unrepresentable: 'throw'`, so a
   * schema that cannot be expressed in JSON Schema fails loudly here instead of
   * being published as an empty, unconstrained `{}` that promises nothing and
   * accepts everything.
   */
  inputSchema: Record<string, unknown>
}

export function describeOperations(): OperationDescription[] {
  return operations.map((operation) => ({
    name: operation.name,
    toolName: `${AGENT_TOOL_PREFIX}${operation.name}`,
    summary: operation.summary,
    mutates: operation.mutates,
    inputSchema: z.toJSONSchema(operation.transportInput ?? operation.input, {
      io: 'input',
      unrepresentable: 'throw',
    }) as Record<string, unknown>,
  }))
}

/**
 * Run one operation by name.
 *
 * Nothing here throws: an unknown name, input that does not match the schema, a
 * store that refused the write and an outright bug all come back as the same
 * `{ ok: false, error: { code, message } }` envelope, because an agent can only
 * act on what it can read.
 */
export async function runOperation(
  context: AgentContext,
  name: string,
  input: unknown,
): Promise<AgentResult<unknown>> {
  const operation = findOperation(name)
  if (!operation) {
    return agentErr('UNKNOWN_OPERATION', `Slaids har ingen operasjon som heter «${name}».`, {
      name,
      available: operations.map((entry) => entry.name),
    })
  }

  const parsed = operation.input.safeParse(input ?? {})
  if (!parsed.success) {
    return agentErr('INVALID_INPUT', 'Inndataene passer ikke operasjonens skjema.', {
      operation: name,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    })
  }

  try {
    return await operation.run(context, parsed.data)
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      return agentErr('CONFLICT', error.message, { operation: name })
    }
    if (error instanceof RepositoryError) {
      return agentErr('STORAGE_FAILED', error.message, { operation: name })
    }
    return agentErr('INTERNAL_ERROR', messageOf(error), { operation: name })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Operasjonen feilet uventet.'
}
