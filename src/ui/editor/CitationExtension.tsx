/**
 * Citation node.
 *
 * The node stores reference ids only. The visible number is derived from the
 * presentation-wide numbering at render time, so moving slides renumbers
 * everything without touching a single document.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { citationLabel } from '../../domain/references'
import { mergeAdjacentCitations } from '../../domain/richdoc'
import type { RichDoc } from '../../domain/types'
import { useSlideRender } from '../slide/SlideRenderContext'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (referenceIds: string[]) => ReturnType
      /** Collapse citations that ended up next to each other into one. */
      mergeCitations: () => ReturnType
    }
  }
}

function CitationNodeView({ node }: NodeViewProps) {
  const { numbering, authorYearLabels, onCitationClick } = useSlideRender()
  const ids = Array.isArray(node.attrs.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const label = citationLabel(ids, numbering, authorYearLabels)
  const classes = ['rd-citation']
  if (authorYearLabels) classes.push('rd-citation--author-year')
  if (onCitationClick) classes.push('rd-citation--clickable')
  return (
    <NodeViewWrapper
      as="sup"
      className={classes.join(' ')}
      style={authorYearLabels ? { whiteSpace: 'inherit' } : undefined}
      data-citation=""
      contentEditable={false}
      title={onCitationClick ? 'Åpne referansen' : undefined}
      onClick={onCitationClick ? () => onCitationClick(ids) : undefined}
    >
      {label || '?'}
    </NodeViewWrapper>
  )
}

export const CitationExtension = Node.create({
  name: 'citation',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      referenceIds: {
        default: [] as string[],
        parseHTML: (element) => {
          const raw = element.getAttribute('data-reference-ids')
          return raw ? raw.split(',').filter(Boolean) : []
        },
        renderHTML: (attributes) => ({
          'data-reference-ids': Array.isArray(attributes.referenceIds)
            ? (attributes.referenceIds as string[]).join(',')
            : '',
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-reference-ids]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { class: 'rd-citation' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView)
  },

  addCommands() {
    return {
      insertCitation:
        (referenceIds: string[]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { referenceIds } }),

      /**
       * Citing four sources in the same place is one citation, not four pills.
       *
       * Runs as its own command, after the insertion has been applied: read
       * from inside the inserting command, the document would still be the one
       * from before the insert, and writing that back would undo it.
       *
       * The rewrite goes on the transaction this command is handed, not through
       * `editor.commands`. Dispatching from inside a command leaves the command
       * that called it holding a transaction built on the state before the
       * dispatch, and ProseMirror rejects that one as mismatched.
       */
      mergeCitations:
        () =>
        ({ state, tr, dispatch }) => {
          const current = state.doc.toJSON() as RichDoc
          const merged = mergeAdjacentCitations(current)
          if (merged === current) return true
          if (!dispatch) return true

          const anchor = state.selection.anchor
          tr.replaceWith(0, state.doc.content.size, state.schema.nodeFromJSON(merged).content)

          // Put the caret after the citation the merge produced, not at the old
          // offset: the document is shorter now, and a clamped offset lands
          // *before* the pill — where the next thing typed, or the next
          // citation inserted, ends up on the wrong side of it.
          let target: number | null = null
          let best = Number.POSITIVE_INFINITY
          tr.doc.descendants((node, pos) => {
            if (node.type.name !== this.name) return
            const end = pos + node.nodeSize
            const distance = Math.abs(end - anchor)
            if (distance < best) {
              best = distance
              target = end
            }
          })
          const size = tr.doc.content.size
          tr.setSelection(
            TextSelection.create(tr.doc, Math.max(1, Math.min(target ?? anchor, size - 1))),
          )
          return true
        },
    }
  },
})
