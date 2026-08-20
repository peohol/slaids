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
      insertSlaidsImage: (attrs: { assetId: string; alt?: string; widthPercent?: number }) => ReturnType
      setSlaidsImageWidth: (widthPercent: number) => ReturnType
    }
  }
}

export const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const

function ImageNodeView({ node }: NodeViewProps) {
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const percent = Number(node.attrs.widthPercent)
  return (
    <NodeViewWrapper
      as="div"
      className="rd-image-wrapper"
      style={{ width: `${Number.isFinite(percent) && percent > 0 ? percent : 100}%` }}
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
      widthPercent: { default: 100 },
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
          commands.insertContent({ type: this.name, attrs: { widthPercent: 100, ...attrs } }),
      setSlaidsImageWidth:
        (widthPercent: number) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { widthPercent }),
    }
  },
})
