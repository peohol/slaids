/**
 * A deck built the way an agent builds one, for the tests that need one.
 *
 * Everything goes through `runOperation` against a real `DexieSlaidsRepository`
 * rather than through the domain commands directly, for the reason
 * `workflow.test.ts` gives: the dispatch path is where an agent actually enters,
 * schema defaults and error envelopes included, and a fixture assembled by hand
 * is a fixture no caller could have produced. It also means these helpers cannot
 * build a deck the rules would have refused — which is exactly what a test about
 * rendering should not be able to do.
 *
 * Like `src/server/mcp/testHarness.ts`, it imports no test framework: the
 * unwrappers throw, which reads the same in a failure and keeps this file
 * harmless if an import ever pulls it somewhere else. It is deliberately not
 * exported from `src/agent/index.ts`.
 */

import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import type { Presentation } from '../domain/types'
import { runOperation } from './registry'
import type { AgentContext, AgentError } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

export interface TestDeckContext extends AgentContext {
  database: SlaidsDatabase
}

/** A context with its own empty database. Close them all in `afterEach`. */
export function testAgentContext(extra: Partial<AgentContext> = {}): TestDeckContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-preview-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database), database, ...extra }
}

export async function closeTestDatabases(): Promise<void> {
  while (databases.length > 0) await databases.pop()?.delete()
}

/** One operation, expected to succeed. Throws with the code if it did not. */
export async function agentOperation<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown>,
): Promise<T> {
  const result = await runOperation(context, name, input)
  if (!result.ok) {
    throw new Error(`«${name}» feilet: ${result.error.code}: ${result.error.message}`)
  }
  return result.value as T
}

/** One operation, expected to be refused. Throws if it went through. */
export async function agentRefusal(
  context: AgentContext,
  name: string,
  input: Record<string, unknown>,
): Promise<AgentError> {
  const result = await runOperation(context, name, input)
  if (result.ok) throw new Error(`Forventet at «${name}» ble avvist, men den gikk gjennom.`)
  return result.error
}

export interface NewDeck {
  presentationId: string
  slideId: string
  /** The slide's single root zone, before anything has been split. */
  rootNodeId: string
  revision: string
}

export async function newAgentDeck(
  context: AgentContext,
  title = 'Previewdekk',
): Promise<NewDeck> {
  const created = await agentOperation<{
    presentationId: string
    slides: { slideId: string }[]
  }>(context, 'create_presentation', { title })
  const slideId = created.slides[0].slideId
  const inspected = await agentOperation<{ rootNodeId: string; revision: string }>(
    context,
    'inspect_slide',
    { presentationId: created.presentationId, slideId },
  )
  return {
    presentationId: created.presentationId,
    slideId,
    rootNodeId: inspected.rootNodeId,
    revision: inspected.revision,
  }
}

/**
 * The leaf zone ids of a slide, in the order `inspect_slide` reports them.
 *
 * Leaves only: `inspect_slide` reports the whole tree, and a split node is not
 * somewhere content goes — asking for one back is how a test ends up placing
 * text on a node the commands would refuse.
 */
export async function zoneIdsOf(
  context: AgentContext,
  presentationId: string,
  slideId: string,
): Promise<string[]> {
  const inspected = await agentOperation<{ zones: { nodeId: string; kind: 'split' | 'leaf' }[] }>(
    context,
    'inspect_slide',
    { presentationId, slideId },
  )
  return inspected.zones.filter((zone) => zone.kind === 'leaf').map((zone) => zone.nodeId)
}

/** The stored document, for a test that asserts on what the store holds. */
export function storedPresentation(
  context: AgentContext,
  presentationId: string,
): Promise<Presentation> {
  return context.repository.loadPresentation(presentationId)
}
