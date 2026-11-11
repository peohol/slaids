/**
 * DOI- og PubMed-lenker blir referanser mens man skriver.
 *
 * En slik lenke som limes inn – eller skrives og avsluttes med mellomrom eller
 * linjeskift – erstattes straks av et citation-nummer. Referansen opprettes med
 * lenken alene og fylles ut i bakgrunnen (`state/referenceImport.ts`), så
 * skrivingen aldri venter på nettet.
 *
 * Nummeret festes til ordet foran, slik et citation-nummer står: mellomrommet
 * mellom ordet og lenken fjernes. Står det et citation-nummer der fra før,
 * slås de sammen til ett.
 *
 * Utvidelsen hører sammen med `CitationExtension` og er bare med i felt som kan
 * sitere.
 */

import { Extension, InputRule } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { citeReferenceLinks } from '../../state/referenceImport'
import {
  parseReferenceLinks,
  type ReferenceIdentifier,
} from '../../state/referenceMetadata'

const CITATION = 'citation'
/** Det et atom-node står som når teksten rundt det leses. */
const LEAF = '\ufffc'
const LEADING_PUNCTUATION = /^[(["'«“‘]+/

/**
 * Lenkene i det siste ordet foran markøren, og hvor de begynner.
 *
 * «Ordet» kan være flere lenker skilt med komma, akkurat som en innliming.
 * Tegnsetting foran og etter hører til setningen og er ikke med.
 */
export function trailingReferenceLink(
  textBefore: string,
): { identifiers: ReferenceIdentifier[]; start: number; length: number } | null {
  const token = /\S+$/.exec(textBefore)
  if (!token) return null
  const lead = LEADING_PUNCTUATION.exec(token[0])?.[0].length ?? 0
  const links = parseReferenceLinks(token[0].slice(lead))
  if (!links) return null
  return {
    identifiers: links.identifiers,
    start: token.index + lead,
    length: token[0].length - lead - links.rest.length,
  }
}

/**
 * Bytt ut `from`–`to` med et citation-nummer for `ids`.
 *
 * Et mellomrom rett etter et ord flyttes ikke med: nummeret festes til ordet.
 * `textAfter` – tegnsetting som hørte til setningen – settes rett etter nummeret.
 * Når `spaceAfter` er satt og nummeret ble festet midt mellom to ord, settes
 * mellomrommet inn på den andre siden, så ordet etter ikke klistres på.
 */
function placeCitation(
  tr: Transaction,
  from: number,
  to: number,
  ids: string[],
  { spaceAfter = false, textAfter = '' }: { spaceAfter?: boolean; textAfter?: string } = {},
): void {
  const $from = tr.doc.resolve(from)
  const offset = $from.parentOffset
  const before = $from.parent.textBetween(Math.max(0, offset - 2), offset, undefined, LEAF)
  const attach = /\S\s$/.test(before)
  const $to = tr.doc.resolve(to)
  const after = $to.parent.textBetween($to.parentOffset, Math.min($to.parent.content.size, $to.parentOffset + 1), undefined, LEAF)
  const start = attach ? from - 1 : from

  tr.delete(start, to)
  const previous = tr.doc.resolve(start).nodeBefore
  let end = start
  if (previous?.type.name === CITATION) {
    const merged = [...(previous.attrs.referenceIds as string[])]
    for (const id of ids) if (!merged.includes(id)) merged.push(id)
    tr.setNodeMarkup(start - previous.nodeSize, undefined, { ...previous.attrs, referenceIds: merged })
  } else {
    tr.insert(start, tr.doc.type.schema.nodes[CITATION].create({ referenceIds: ids }))
    end = start + 1
  }
  if (textAfter) {
    tr.insertText(textAfter, end)
    end += textAfter.length
  }
  if (spaceAfter && attach && /\S/.test(after)) {
    tr.insertText(' ', end)
    end += 1
  }
  tr.setSelection(TextSelection.create(tr.doc, end))
}

function pastedText(event: ClipboardEvent, fallback: string): string {
  return event.clipboardData?.getData('text/plain') || fallback
}

function handlePaste(view: EditorView, event: ClipboardEvent, text: string): boolean {
  const links = parseReferenceLinks(pastedText(event, text))
  if (!links || !view.state.schema.nodes[CITATION]) return false
  const ids = citeReferenceLinks(links.identifiers)
  if (!ids) return false
  const { from, to } = view.state.selection
  const tr = view.state.tr
  placeCitation(tr, from, to, ids, { spaceAfter: true, textAfter: links.rest })
  view.dispatch(tr.scrollIntoView())
  return true
}

/** Gjør lenken rett foran markøren om til en referanse. */
function convertBeforeCursor(view: EditorView): void {
  const { selection } = view.state
  if (!(selection instanceof TextSelection) || !selection.$cursor) return
  const $cursor = selection.$cursor
  const textBefore = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, LEAF)
  const found = trailingReferenceLink(textBefore)
  if (!found || found.start + found.length !== textBefore.length) return
  const ids = citeReferenceLinks(found.identifiers)
  if (!ids) return
  const tr = view.state.tr
  const from = $cursor.start() + found.start
  placeCitation(tr, from, from + found.length, ids)
  view.dispatch(tr)
}

export const ReferenceLinkExtension = Extension.create({
  name: 'referenceLink',
  // Foran lenkeutvidelsen, som ellers gjør en innlimt adresse om til en lenke.
  priority: 1100,

  addInputRules() {
    return [
      new InputRule({
        // Mellomrommet som avslutter lenken. Tegnsetting rett etter lenken blir
        // stående etter nummeret.
        find: (text) => {
          const typed = /[ \u00a0\t]$/.exec(text)
          if (!typed) return null
          const found = trailingReferenceLink(text.slice(0, -1))
          if (!found) return null
          return {
            index: found.start,
            text: text.slice(found.start),
            data: { identifiers: found.identifiers, length: found.length, rest: text.slice(found.start + found.length) },
          }
        },
        handler: ({ state, range, match }) => {
          const data = match.data as { identifiers: ReferenceIdentifier[]; length: number; rest: string }
          const ids = citeReferenceLinks(data.identifiers)
          if (!ids) return null
          const { tr } = state
          // Det skrevne tegnet er ikke i dokumentet ennå; resten av tegnsettingen er.
          tr.insertText(data.rest.slice(-1), range.to)
          placeCitation(tr, range.from, range.from + data.length, ids)
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(range.to, 1)))
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    // Linjeskiftet avslutter lenken også. Konverteringen skjer først, og så
    // går tasten videre til det den ellers gjør.
    const convert = (): boolean => {
      convertBeforeCursor(this.editor.view)
      return false
    }
    return { Enter: convert, 'Shift-Enter': convert }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('referenceLinkPaste'),
        props: {
          handlePaste: (view, event, slice) =>
            handlePaste(view, event, slice.content.textBetween(0, slice.content.size, '\n', LEAF)),
        },
      }),
    ]
  },
})
