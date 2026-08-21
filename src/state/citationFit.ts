/**
 * The deck-wide half of the fit rule for text editing.
 *
 * Typing is validated against the live DOM inside `RichTextEditor`: that is
 * what keeps IME composition safe, and it answers the only question that
 * matters for ordinary keystrokes — does this zone still show its text?
 *
 * Inserting a citation is not an ordinary keystroke. Citation labels are
 * derived from first-occurrence order across the whole presentation, so putting
 * one into slide 2 can turn `9` into `10` on slide 9 and push a paragraph out
 * of sight in a zone nobody touched. The local measurement cannot see that.
 *
 * So: when an edit leaves the document's citations exactly as they were — every
 * keystroke, every paste of plain text — this costs one walk of a small
 * document and answers "no problem". When the citations actually change, it
 * builds the document the edit would produce and measures the consequences
 * everywhere else.
 */

import { findFitRegressions } from '../domain/commands'
import { collectCitationIds } from '../domain/richdoc'
import type { Presentation, RichDoc } from '../domain/types'
import type { Result } from '../domain/result'
import { domFitCheckers } from './measure'
import { useEditorStore } from './store'

function citationSignature(doc: RichDoc): string {
  // Order matters as well as membership: moving a citation ahead of another
  // inside the same document swaps their numbers.
  return collectCitationIds(doc).join('|')
}

export interface DocEditGuardInput {
  /** The zone being edited; its own overflow is the live editor's business. */
  nodeId: string
  currentDoc: RichDoc
  nextDoc: RichDoc
  /** How this document is written back, so the prospective deck can be built. */
  commit: (presentation: Presentation, doc: RichDoc) => Result<Presentation>
}

/**
 * A message when this edit would hide content *elsewhere* in the deck, or
 * `null` when it is safe.
 */
export function docEditRenumberProblem(input: DocEditGuardInput): string | null {
  if (citationSignature(input.currentDoc) === citationSignature(input.nextDoc)) return null

  const before = useEditorStore.getState().presentation
  if (!before) return null
  const after = input.commit(before, input.nextDoc)
  if (!after.ok) return after.error.message

  const regressions = findFitRegressions(before, after.value, domFitCheckers).filter(
    (regression) => regression.nodeId !== input.nodeId,
  )
  if (regressions.length === 0) return null
  return regressions.length === 1
    ? 'Citation-nummereringen ville gjort at innhold i en annen sone ikke lenger får plass.'
    : `Citation-nummereringen ville gjort at innhold i ${regressions.length} andre soner ikke lenger får plass.`
}
