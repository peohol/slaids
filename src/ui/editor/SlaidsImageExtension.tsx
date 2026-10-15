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
import {
  INLINE_IMAGE_DEFAULT_ASPECT,
  INLINE_IMAGE_DEFAULT_WIDTH_PERCENT,
  INLINE_IMAGE_MAX_WIDTH_PERCENT,
  INLINE_IMAGE_MIN_WIDTH_PERCENT,
} from '../../domain/constants'
import { drawnAlign, IMAGE_NODE } from '../../domain/richdoc'
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
 * The node's name, from the domain's own vocabulary: the editor writes the same
 * node the static renderer, the fit estimator and the agent's text format read,
 * so the name is theirs rather than a second copy of it here.
 */
const IMAGE_NODE_NAME = IMAGE_NODE

/**
 * Whether a picture can go into this editor at all.
 *
 * Only `bodyExtensions` registers this node. A slide title, a cover line and a
 * caption are one line of text by construction, so `titleExtensions` leaves it
 * out of the schema rather than hiding a button — and an editor without the
 * node has no `insertSlaidsImage` command either.
 *
 * Asking the schema is what keeps that decision and the upload dialog from
 * drifting apart. A list of field kinds would answer the same question today
 * and would have to be extended by hand the day a fifth kind of field appears;
 * the first sign that nobody did is `insertSlaidsImage is not a function`,
 * thrown *after* the file has already been stored in the presentation.
 */
export function acceptsInlineImage(editor: Editor | null | undefined): editor is Editor {
  return Boolean(editor && editor.schema.nodes[IMAGE_NODE_NAME])
}

/**
 * A picture may shrink a long way but never outgrow the field it sits in — see
 * `INLINE_IMAGE_MIN_WIDTH_PERCENT` in `domain/constants.ts`, which is where the
 * range lives so the drag handle and the agent's `image` block cannot disagree
 * about how wide a picture may be.
 */
const MIN_WIDTH_PERCENT = INLINE_IMAGE_MIN_WIDTH_PERCENT
const MAX_WIDTH_PERCENT = INLINE_IMAGE_MAX_WIDTH_PERCENT

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return MAX_WIDTH_PERCENT
  return Math.max(MIN_WIDTH_PERCENT, Math.min(MAX_WIDTH_PERCENT, Math.round(percent)))
}

/** Width a freshly inserted image gets when the field has room to spare. */
export const DEFAULT_IMAGE_WIDTH_PERCENT = INLINE_IMAGE_DEFAULT_WIDTH_PERCENT

/**
 * How tall the flowed content is, whatever box it is aligned inside.
 *
 * The editable box is the whole field — that is what lets a click anywhere in
 * the field land in the text, and what gives a figure a field height to be
 * bounded by — so its own height says nothing about how much room the text
 * takes, and `scrollHeight` would answer with the field every time. The
 * distance from the first block's top to the last block's bottom is the real
 * answer, and `offsetTop`/`offsetHeight` are logical pixels, so the stage's CSS
 * scale does not enter into it.
 *
 * Margin boxes, not border boxes: whatever margin a block actually has takes up
 * room in the field like anything else, and reading it from the element rather
 * than assuming it is what keeps this honest through the rules that zero the
 * outermost ones. Margins between siblings collapse into the span already, so
 * the outermost margin box in each direction is the whole answer — which is
 * why a caller that is about to *add* a block has to hold back the margin the
 * current last block regains by no longer being last. See
 * `fittingImageWidthPercent`.
 *
 * Out-of-flow chrome (ProseMirror's gap cursor) is not content and is skipped.
 * With no blocks at all there is nothing to measure, and the box's own scroll
 * height is as good an answer as there is.
 */
export function flowHeight(dom: HTMLElement): number {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const child of Array.from(dom.children)) {
    const block = child as HTMLElement
    const style = getComputedStyle(block)
    if (style.position === 'absolute' || style.position === 'fixed') continue
    const marginTop = Number.parseFloat(style.marginTop) || 0
    const marginBottom = Number.parseFloat(style.marginBottom) || 0
    top = Math.min(top, block.offsetTop - marginTop)
    bottom = Math.max(bottom, block.offsetTop + block.offsetHeight + marginBottom)
  }
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return dom.scrollHeight
  return Math.max(0, bottom - top)
}

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
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : INLINE_IMAGE_DEFAULT_ASPECT

  // The flow's own height rather than the field's: the text is what it is even
  // when the field is already clipping it. Three things will exist afterwards
  // that do not exist now, and all three are held back: the line the split
  // leaves behind (inserting a block into a paragraph costs one), the picture's
  // own bottom margin, and the margin the block that is currently last regains
  // the moment it stops being last — the outermost margins are zeroed, so the
  // measured flow is one distance shorter than the flow it is about to become.
  const style = getComputedStyle(dom)
  const line = Number.parseFloat(style.lineHeight)
  const spacing = blockSpacing(style)
  const reserve = (Number.isFinite(line) ? line : 0) + spacing * 2 + INSERT_SAFETY
  const free = box.clientHeight - flowHeight(dom) - reserve
  if (free <= 0) return null

  const percent = Math.floor(((free * ratio) / column) * 100)
  if (percent < MIN_WIDTH_PERCENT) return null
  return Math.min(DEFAULT_IMAGE_WIDTH_PERCENT, percent)
}

/**
 * The distance between two blocks, read from the element it is applied to.
 *
 * The theme scales it — `--slaids-block-spacing` is what `slide.css` actually
 * uses — so a number written out here would be right only at one setting of the
 * air, and quietly wrong at the three others.
 */
function blockSpacing(style: CSSStyleDeclaration): number {
  const value = Number.parseFloat(style.getPropertyValue('--slaids-block-spacing'))
  return Number.isFinite(value) ? value : 0
}

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
  // Nothing new appears while dragging — the picture and its margin are already
  // in the flow — so what is left over is the whole ceiling, less the slack.
  const free = box.clientHeight - flowHeight(dom) - INSERT_SAFETY
  const ceiling = ((height + Math.max(0, free)) * ratio * 100) / dom.clientWidth
  return clampPercent(Math.floor(ceiling))
}

function ImageNodeView({ node, updateAttributes, editor }: NodeViewProps) {
  const assetId = typeof node.attrs.assetId === 'string' ? node.attrs.assetId : null
  const stored = Number(node.attrs.widthPercent)
  const aspect = Number(node.attrs.aspect)
  // Resolved through the same function the static renderer uses: a node view
  // draws its own DOM, so `renderHTML` — and with it the alignment attribute's
  // own rendering — never runs here. A picture nobody aligned would otherwise
  // be the one block drawn one way while it is edited and another on the slide.
  const align = drawnAlign(node.attrs.textAlign, 'image')
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
          // The same inline style the static renderer writes, so one stylesheet
          // positions the picture in both.
          textAlign: align,
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
  name: IMAGE_NODE_NAME,
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: { default: null },
      alt: { default: '' },
      /** Half width by default, so an image leaves room for the text around it. */
      widthPercent: { default: INLINE_IMAGE_DEFAULT_WIDTH_PERCENT },
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
