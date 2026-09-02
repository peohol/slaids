/**
 * How an operation is declared.
 *
 * One helper so every operation is described the same way: a name, a line a
 * tool listing can show, whether it writes, a Zod schema and an implementation
 * that only ever sees input that already matched the schema.
 *
 * The shared id schemas below carry their own descriptions, which is what makes
 * a generated MCP tool definition readable without a second, hand-written copy
 * of the same documentation.
 */

import { z } from 'zod'
import type { AgentContext, AgentOperation, AgentResult } from './types'

export function defineOperation<Schema extends z.ZodType, Output>(operation: {
  name: string
  summary: string
  mutates: boolean
  input: Schema
  /** Only when the published contract is narrower than what the function takes. */
  transportInput?: z.ZodType
  run: (context: AgentContext, input: z.output<Schema>) => Promise<AgentResult<Output>>
}): AgentOperation<z.output<Schema>, Output> {
  return operation
}

export const presentationIdSchema = z
  .string()
  .min(1)
  .describe('Id-en til presentasjonen operasjonen gjelder.')

export const slideIdSchema = z.string().min(1).describe('Id-en til sliden.')

export const nodeIdSchema = z
  .string()
  .min(1)
  .describe('Id-en til sonen i slidens layouttre. En sone med innhold er alltid et blad.')

export const assetIdSchema = z.string().min(1).describe('Id-en til en fil i presentasjonen.')

export const assetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Filnavnet som vises i Slaids.')
