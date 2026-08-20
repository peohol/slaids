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
import { useSlideRender } from '../slide/SlideRenderContext'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (referenceIds: string[]) => ReturnType
    }
  }
}

function CitationNodeView({ node }: NodeViewProps) {
  const { numbering } = useSlideRender()
  const ids = Array.isArray(node.attrs.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const label = citationLabel(ids, numbering)
  return (
    <NodeViewWrapper as="sup" className="rd-citation" data-citation="" contentEditable={false}>
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
    }
  },
})
