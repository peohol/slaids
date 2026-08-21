/**
 * Inline image node.
 *
 * Images reference an asset id; the bytes live in IndexedDB. Nothing is ever
 * stored as a base64 blob inside the presentation document.
 */

import { useRef, useState } from 'react'
import { Node, mergeAttributes, type Editor } from '@tiptap/core'
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

/**
 * A picture may shrink a long way but never outgrow the field it sits in: the
 * width is a share of the column, so 100 % is exactly the column, and the
 * height follows from the aspect ratio rather than being set separately. That
 * is what keeps the proportions right no matter how the handle is dragged.
 */
const MIN_WIDTH_PERCENT = 10
const MAX_WIDTH_PERCENT = 100

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MAX_WIDTH_PERCENT
  return Math.max(MIN_WIDTH_PERCENT, Math.min(MAX_WIDTH_PERCENT, Math.round(percent)))
}

/** Width a freshly inserted image gets when the field has room to spare. */
export const DEFAULT_IMAGE_WIDTH_PERCENT = 50

/**
 * The largest share of the column a new image can take without pushing the
 * field's text out of sight.
 *
 * A picture used to arrive at half the column width no matter how little room
 * was left, so inserting one into a short field produced an overflow, the fit
 * guard rolled the edit back, and it looked as if nothing had happened. The
 * height an image adds is `width / aspect`, so the free vertical room in the
 * field is what decides the width — measured on the live DOM in logical pixels
 * (`clientHeight` and friends ignore the stage's CSS scale).
 *
 * Returns `null` when there is not enough room for a usable picture; the fit
 * guard still has the last word once the insert is committed.
 */
export function fittingImageWidthPercent(editor: Editor, aspect: number): number | null {
  const dom = editor.view.dom as HTMLElement
  const box = dom.closest('[data-fit-scroll]') as HTMLElement | null
  const column = dom.clientWidth
  if (column <= 0) return DEFAULT_IMAGE_WIDTH_PERCENT
  // No clipping box to measure against — leave the size to the fit guard.
  if (!box || box === dom) return DEFAULT_IMAGE_WIDTH_PERCENT
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9

  // `scrollHeight` rather than `clientHeight`: the text is what it is even when
  // the field is already clipping it. Inserting a block into a paragraph splits
  // it, which can cost a line, so one is held back.
  const line = Number.parseFloat(getComputedStyle(dom).lineHeight)
  const reserve = (Number.isFinite(line) ? line : 0) + IMAGE_BLOCK_MARGIN + INSERT_SAFETY
  const free = box.clientHeight - dom.scrollHeight - reserve
  if (free <= 0) return null

  const percent = Math.floor(((free * ratio) / column) * 100)
  if (percent < MIN_WIDTH_PERCENT) return null
  return Math.min(DEFAULT_IMAGE_WIDTH_PERCENT, percent)
}

/** Matches `.rd-image-wrapper`'s bottom margin in `slide.css`. */
const IMAGE_BLOCK_MARGIN = 6

/**
 * Slack between this estimate and the fit guard's own measurement.
 *
 * The estimate works from the field's box; the guard renders the whole zone
 * offscreen and measures that. The two agree to within a few pixels, and a
 * picture a few pixels narrower than the theoretical maximum is a much better
 * outcome than one that is refused.
 */
const INSERT_SAFETY = 10

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

/**
 * The widest this picture may become without pushing the field's text out of
 * sight: what it takes up now, plus whatever room is still free below it.
 *
 * Measured in logical pixels — `clientWidth`/`clientHeight` ignore the stage's
 * CSS scale, so the number means the same thing at any zoom.
 */
function resizeCeiling(editor: Editor, wrapper: HTMLElement): number {
  const dom = editor.view.dom as HTMLElement
  const box = dom.closest('[data-fit-scroll]') as HTMLElement | null
  if (!box || box === dom || dom.clientWidth <= 0) return MAX_WIDTH_PERCENT
  const height = wrapper.clientHeight
  if (height <= 0) return MAX_WIDTH_PERCENT
  const ratio = wrapper.clientWidth / height
  const free = box.clientHeight - dom.scrollHeight - IMAGE_BLOCK_MARGIN - INSERT_SAFETY
  const ceiling = ((height + Math.max(0, free)) * ratio * 100) / dom.clientWidth
  return clampPercent(Math.floor(ceiling))
}

function ImageNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const stored = Number(node.attrs.widthPercent)
  const aspect = Number(node.attrs.aspect)
  const wrapperRef = useRef<HTMLDivElement>(null)
  /** Width while a drag is in flight; the document only learns about it on release. */
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const width = dragPercent ?? (Number.isFinite(stored) && stored > 0 ? stored : 100)

  const startResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const wrapper = wrapperRef.current
    const column = wrapper?.parentElement
    if (!wrapper || !column) return
    const available = column.getBoundingClientRect().width
    if (available <= 0) return
    const startX = event.clientX
    const startWidth = wrapper.getBoundingClientRect().width
    // The room left in the field is a hard ceiling on the drag, so growing the
    // picture stops at the edge of the zone instead of being refused after the
    // fact. The fit guard still has the final say once the change is committed.
    const ceiling = resizeCeiling(editor, wrapper)
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)

    const percentAt = (clientX: number): number =>
      Math.min(ceiling, clampPercent(((startWidth + (clientX - startX)) / available) * 100))

    const move = (moveEvent: PointerEvent): void => {
      setDragPercent(percentAt(moveEvent.clientX))
    }
    const finish = (endEvent: PointerEvent): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      const next = percentAt(endEvent.clientX)
      setDragPercent(null)
      // One commit at the end, so the fit guard judges the size the author let
      // go of rather than every pixel along the way.
      if (next !== stored) updateAttributes({ widthPercent: next })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  return (
    <NodeViewWrapper
      className={dragPercent === null ? 'rd-image-wrapper' : 'rd-image-wrapper rd-image-wrapper--resizing'}
      ref={wrapperRef}
      style={
        {
          width: `${width}%`,
          '--slaids-image-aspect': Number.isFinite(aspect) && aspect > 0 ? String(aspect) : undefined,
        } as React.CSSProperties
      }
    >
      <InlineAssetImage assetId={assetId} alt={String(node.attrs.alt ?? '')} />
      {editor.isEditable && (
        <button
          type="button"
          className="rd-image-handle"
          data-testid="image-resize-handle"
          aria-label={`Endre bildestørrelse (${width} %)`}
          contentEditable={false}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={startResize}
        />
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
          commands.insertContent({
            type: this.name,
            attrs: { widthPercent: DEFAULT_IMAGE_WIDTH_PERCENT, ...attrs },
          }),
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
