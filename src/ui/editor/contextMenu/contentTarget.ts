/**
 * What a right-click in content mode landed on.
 *
 * The geometry has already said which zone; this says what inside it — a word
 * in a field, a cell of a table, a picture in the text, the caption over a
 * photograph, the photograph, or the zone around all of them. It is read from
 * the DOM because that is where the answer is: which field the pointer is in is
 * a question about the rendered text, which no rectangle in the layout knows.
 *
 * One rule decides when the browser keeps its own menu: inside a text field the
 * author is typing in, a right-click is about the text — a misspelt word, a
 * paste — and the browser's menu is the one that knows about those. Everywhere
 * else the menu is the app's. A picture in the text and a block of selected
 * cells are not words, so they get the app's menu even there.
 */

import type { Editor } from '@tiptap/react'
import { CellSelection } from '@tiptap/pm/tables'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { SECTION_SUBTITLE_NODE_ID, SECTION_TITLE_NODE_ID, TITLE_NODE_ID } from '../../../domain/geometry'
import { IMAGE_NODE } from '../../../domain/richdoc'
import type { ActiveField } from '../../../state/store'

/** A text field, with the editor that holds its words and the selection already where the menu acts. */
export interface FieldTarget {
  editor: Editor
  field: ActiveField
}

export type ContentTarget =
  | { kind: 'text'; at: FieldTarget }
  | { kind: 'table'; at: FieldTarget }
  | { kind: 'inline-image'; at: FieldTarget }
  | { kind: 'caption' }
  | { kind: 'image' }
  | { kind: 'zone' }

const EDITOR_SELECTOR = '.ProseMirror'
const INLINE_IMAGE_SELECTOR = '.rd-image-wrapper'
const TABLE_CELL_SELECTOR = 'td, th'

/** The Tiptap editor drawn into this element; Tiptap hangs it on its root. */
function editorOf(root: Element): Editor | null {
  const editor = (root as Element & { editor?: Editor }).editor
  return editor && !editor.isDestroyed ? editor : null
}

/** Which field of the zone — or of the section page — a node inside it belongs to. */
function fieldAt(element: Element, nodeId: string): ActiveField | null {
  // A section's two lines are the page's only fields, and named by the page.
  if (nodeId === SECTION_TITLE_NODE_ID) return { nodeId, subfieldId: null, kind: 'section-title' }
  if (nodeId === SECTION_SUBTITLE_NODE_ID) return { nodeId, subfieldId: null, kind: 'section-subtitle' }
  if (element.closest('.slide-title')) return { nodeId: TITLE_NODE_ID, subfieldId: null, kind: 'slide-title' }
  if (element.closest('.image-caption')) return { nodeId, subfieldId: null, kind: 'caption' }
  if (element.closest('.card-header')) return { nodeId, subfieldId: null, kind: 'card-title' }
  const subfieldId = element.closest('[data-subfield-id]')?.getAttribute('data-subfield-id')
  return subfieldId ? { nodeId, subfieldId, kind: 'body' } : null
}

/**
 * Put the editor's selection where the pointer is, without taking the focus.
 *
 * The menu's entries act on the selection when they run, and they should act
 * on what was right-clicked. The focus stays where it was until an entry is
 * chosen — opening a menu is not starting to type. A selection that already
 * covers the point is left alone, so text marked first and then right-clicked
 * is still the text the menu acts on.
 */
function selectAt(editor: Editor, point: { x: number; y: number }, image: Element | null): void {
  const { view } = editor
  if (image) {
    // The picture is an atom: the position «inside» it is the picture itself.
    // Asked of the DOM too, for a press that lands on its edge.
    const inside = view.posAtCoords({ left: point.x, top: point.y })?.inside ?? -1
    const fromDom = view.posAtDOM(image, 0)
    const pos = [inside, fromDom, fromDom - 1].find(
      (candidate) => candidate >= 0 && editor.state.doc.nodeAt(candidate)?.type.name === IMAGE_NODE,
    )
    if (pos !== undefined) {
      view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
    }
    return
  }
  const found = view.posAtCoords({ left: point.x, top: point.y })
  if (!found) return
  const { from, to, empty } = editor.state.selection
  if (!empty && found.pos >= from && found.pos <= to) return
  view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found.pos)))
}

/**
 * The target of a right-click at `point` on `element`, in the zone `nodeId`.
 *
 * `null` means the browser's own menu: the pointer is in the words of a field
 * that is being typed in.
 */
export function contentTargetAt(
  element: Element | null,
  point: { x: number; y: number },
  nodeId: string,
): ContentTarget | null {
  if (!element) return { kind: 'zone' }
  const root = element.closest(EDITOR_SELECTOR)
  const editor = root ? editorOf(root) : null
  const field = root ? fieldAt(root, nodeId) : null
  if (!editor || !field || !editor.isEditable) {
    if (element.closest('.image-caption')) return { kind: 'caption' }
    if (element.closest('.image-panel')) return { kind: 'image' }
    return { kind: 'zone' }
  }

  const image = element.closest(INLINE_IMAGE_SELECTOR)
  const cell = element.closest(TABLE_CELL_SELECTOR)
  const at = { editor, field }
  if (editor.isFocused) {
    if (image) {
      selectAt(editor, point, image)
      return { kind: 'inline-image', at }
    }
    if (cell && editor.state.selection instanceof CellSelection) return { kind: 'table', at }
    return null
  }

  selectAt(editor, point, image)
  if (image) return { kind: 'inline-image', at }
  if (cell) return { kind: 'table', at }
  return { kind: 'text', at }
}

/**
 * The target of the menu key in the field being typed in: whatever the
 * selection is on. The keyboard has no point to aim with, so the selection is
 * the only answer there is.
 */
export function contentTargetOfSelection(editor: Editor, field: ActiveField): ContentTarget {
  const at = { editor, field }
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === IMAGE_NODE) {
    return { kind: 'inline-image', at }
  }
  if (selection instanceof CellSelection || editor.isActive('table')) return { kind: 'table', at }
  return { kind: 'text', at }
}
