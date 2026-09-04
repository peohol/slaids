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
import type { AgentContext, AgentOperation, AgentResult, AgentScope } from './types'

export function defineOperation<Schema extends z.ZodType, Output>(operation: {
  name: string
  summary: string
  mutates: boolean
  /** Every scope a caller must hold. Not optional — see `AgentOperation`. */
  scopes: readonly [AgentScope, ...AgentScope[]]
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

export const subfieldIdSchema = z
  .string()
  .min(1)
  .describe('Id-en til tekstfeltet inne i innholdet, fra inspect_slide.')

/**
 * The reading a mutation is written against.
 *
 * Optional, because a caller that reads and writes in one go has nothing to be
 * stale about. A caller that reads, thinks and comes back sends the revision it
 * read: if the presentation moved on in the meantime it gets a `CONFLICT` and
 * can read again, instead of quietly overwriting whoever wrote first.
 */
export const expectedRevisionSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Revisjonen fra get_presentation eller inspect_slide. Er presentasjonen endret siden da, avvises kallet med CONFLICT i stedet for å overskrive.',
  )

/** What happens to content a structural change would otherwise destroy. */
export const dispositionSchema = z
  .enum(['sandbox', 'delete'])
  .default('sandbox')
  .describe('`sandbox` tar vare på innhold som fortrenges, `delete` forkaster det.')

/**
 * Where in the library a presentation lives.
 *
 * `null` is the root, and it is a value rather than an absence: a move has to be
 * able to say "out of every folder", and an omitted field would say "leave it
 * where it is". Which of the two an operation wants is the operation's own
 * choice — `create_presentation` allows the omission, `move_presentation` does
 * not — so this schema carries the id and the two of them add the rest.
 */
export const folderIdSchema = z
  .string()
  .min(1)
  .describe('Id-en til en mappe i biblioteket, fra list_folders.')

export const assetIdSchema = z.string().min(1).describe('Id-en til en fil i presentasjonen.')

export const assetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Filnavnet som vises i Slaids.')
