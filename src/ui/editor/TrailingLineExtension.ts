/**
 * The empty line below a picture — editor chrome, never content.
 *
 * A picture is an atom: there is nowhere inside it to put a caret, so a field
 * that ends with one needs a line after it for somebody who wants to write on.
 * StarterKit ships a `trailingNode` extension that does exactly that, and it is
 * turned off in `extensions.ts` in favour of this one — not because the idea is
 * wrong, but because it wrote the line into the *document*. Every picture then
 * drew a full blank line under itself on the slide, and because a field aligns
 * its whole flow, that line is also what put more air below centred content
 * than above it. The same went for every heading, list and table: the line
 * appeared the moment the block did, and was saved along with it.
 *
 * So the line is put back where it belongs. The document never carries it (see
 * `trimTrailingBlankLines`), and the editor carries it only *while the field is
 * being edited*. Both halves matter. Content mode, zone mode and presentation
 * mode draw one document through one frame, and the offscreen fit measurement
 * reads that same frame — so a field nobody is standing in has to look exactly
 * like the slide. A caret, on the other hand, cannot stand on a line that does
 * not exist, which is why the line is allowed to be there for as long as
 * somebody might type into it, and is taken back the moment they leave.
 *
 * Both transactions are invisible to everything downstream: they change what
 * the editor holds, never what it *means*, so both are kept out of the history
 * and out of the update event. Nothing is saved, nothing is measured for fit,
 * and undo never walks back through a line nobody wrote.
 *
 * "Needs a line" is `!isTextblock` — "the last block cannot hold a caret" —
 * rather than a list of node names, so a node type added to the schema later is
 * covered without anyone remembering to come back here.
 */

import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { trimTrailingBlankLines } from '../../domain/richdoc'
import type { RichDoc } from '../../domain/types'

/** The transaction that adds the line, or `null` when the field needs none. */
function addTrailingLine(state: EditorState): Transaction | null {
  const last = state.doc.lastChild
  if (!last || last.type.isTextblock) return null
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return null
  return state.tr.insert(state.doc.content.size, paragraph.create())
}

/**
 * The transaction that takes every blank line back, or `null` when the editor
 * already holds exactly what it means.
 *
 * Expressed as "become the trimmed document" rather than as a second,
 * ProseMirror-side reading of what a blank line is: one definition of that, in
 * the domain, is what keeps the editor and the store from drifting apart over
 * an edge case neither of them would report.
 */
function dropBlankLines(state: EditorState): Transaction | null {
  const meant = trimTrailingBlankLines(state.doc.toJSON() as RichDoc)
  const next = state.schema.nodeFromJSON(meant)
  if (next.eq(state.doc)) return null
  return state.tr.replaceWith(0, state.doc.content.size, next.content)
}

/** Dispatch without touching the history or the document the store knows about. */
function dispatchQuietly(editor: Editor, transaction: Transaction | null): void {
  if (!transaction) return
  editor.view.dispatch(transaction.setMeta('addToHistory', false).setMeta('preventUpdate', true))
}

export const TrailingLineExtension = Extension.create({
  name: 'trailingLine',

  onFocus() {
    if (!this.editor.isEditable) return
    dispatchQuietly(this.editor, addTrailingLine(this.editor.state))
  },

  onBlur() {
    dispatchQuietly(this.editor, dropBlankLines(this.editor.state))
  },

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        key: new PluginKey('slaidsTrailingLine'),
        appendTransaction: (transactions, _previous, state) => {
          if (!editor.isEditable) return null
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          // Symmetric on purpose, and self-healing either way: a field somebody
          // is in keeps a line to write on, and a field nobody is in holds
          // exactly what the slide draws. Each answer settles on the next pass —
          // there is no line to add once one is there, and none to take back
          // once they are gone.
          return editor.isFocused ? addTrailingLine(state) : dropBlankLines(state)
        },
      }),
    ]
  },
})
