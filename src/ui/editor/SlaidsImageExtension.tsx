/**
 * Inline image node.
 *
 * Images reference an asset id; the bytes live in IndexedDB. Nothing is ever
 * stored as a base64 blob inside the presentation document.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { InlineAssetImage } from '../slide/AssetImage'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slaidsImage: {
      insertSlaidsImage: (attrs: {
        assetId: string
        alt?: string
        widthPercent?: number
        aspect?: number
      }) => ReturnType
      setSlaidsImageWidth: (widthPercent: number) => ReturnType
    }
  }
}

export const IMAGE_WIDTH_PRESETS = [25, 50, 75, 100] as const

/** Position of the selected node of `typeName`, or the first one in the selection. */
export function findSelectedNodePos(
  state: { selection: { from: number; to: number }; doc: { nodesBetween: (from: number, to: number, fn: (node: { type: { name: string } }, pos: number) => void) => void } },
  typeName: string,
): number | null {
  const selection = state.selection as unknown
  if (selection instanceof NodeSelection && selection.node.type.name === typeName) {
    return selection.from
  }
  let found: number | null = null
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (found === null && node.type.name === typeName) found = pos
  })
  return found
}

function ImageNodeView({ node }: NodeViewProps) {
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const percent = Number(node.attrs.widthPercent)
  const aspect = Number(node.attrs.aspect)
  return (
    <NodeViewWrapper
      className="rd-image-wrapper"
      style={
        {
          width: `${Number.isFinite(percent) && percent > 0 ? percent : 100}%`,
          '--slaids-image-aspect': Number.isFinite(aspect) && aspect > 0 ? String(aspect) : undefined,
        } as React.CSSProperties
      }
    >
      <InlineAssetImage assetId={assetId} alt={String(node.attrs.alt ?? '')} />
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
      /** Half width by default, so an image leaves room for the text around it. */
      widthPercent: { default: 50 },
      /** Intrinsic width / height, so the box has a size before the file loads. */
      aspect: { default: null },
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
          commands.insertContent({ type: this.name, attrs: { widthPercent: 50, ...attrs } }),
      /**
       * Applied through an explicit transaction against the selected node.
       * `updateAttributes` depends on where the selection happens to be, which
       * is not reliable for an atom node selected by clicking it.
       */
      setSlaidsImageWidth:
        (widthPercent: number) =>
        ({ state, dispatch, tr }) => {
          const pos = findSelectedNodePos(state, this.name)
          if (pos === null) return false
          const node = state.doc.nodeAt(pos)
          if (!node) return false
          if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, widthPercent })
          return true
        },
    }
  },
})
