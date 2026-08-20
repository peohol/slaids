/**
 * Inline image node.
 *
 * Images reference an asset id; the bytes live in IndexedDB. Nothing is ever
 * stored as a base64 blob inside the presentation document.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { AssetImage } from '../slide/AssetImage'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slaidsImage: {
      insertSlaidsImage: (attrs: { assetId: string; alt?: string; displayWidth?: number }) => ReturnType
    }
  }
}

function ImageNodeView({ node }: NodeViewProps) {
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const width = Number(node.attrs.displayWidth)
  return (
    <NodeViewWrapper
      as="div"
      className="rd-image-wrapper"
      style={Number.isFinite(width) && width > 0 ? { width } : undefined}
    >
      {assetId ? (
        <AssetImage assetId={assetId} fit="contain" alt={String(node.attrs.alt ?? '')} />
      ) : (
        <span className="rd-image rd-image--pending" />
      )}
    </NodeViewWrapper>
  )
}

export const SlaidsImageExtension = Node.create({
  name: 'slaidsImage',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: { default: null },
      alt: { default: '' },
      displayWidth: { default: null },
      displayHeight: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'figure[data-asset-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-asset-id': HTMLAttributes.assetId })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },

  addCommands() {
    return {
      insertSlaidsImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
