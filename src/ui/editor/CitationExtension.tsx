/**
 * Citation node.
 *
 * The node stores reference ids only. The visible number is derived from the
 * presentation-wide numbering at render time, so moving slides renumbers
 * everything without touching a single document.
 */

import { Node, mergeAttributes } from '@tiptap/core'
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
  const { numbering, onCitationClick } = useSlideRender()
  const ids = Array.isArray(node.attrs.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const label = citationLabel(ids, numbering)
  return (
    <NodeViewWrapper
      as="sup"
      className={onCitationClick ? 'rd-citation rd-citation--clickable' : 'rd-citation'}
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
       */
      mergeCitations:
        () =>
        ({ editor }) => {
          const current = editor.getJSON() as RichDoc
          const merged = mergeAdjacentCitations(current)
          if (merged === current) return true
          const anchor = editor.state.selection.anchor
          editor.commands.setContent(merged, { emitUpdate: true })
          const size = editor.state.doc.content.size
          editor.commands.setTextSelection(Math.max(1, Math.min(anchor, size - 1)))
          return true
        },
    }
  },
})
