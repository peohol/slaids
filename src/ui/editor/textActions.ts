/**
 * What can be done to text, said once.
 *
 * The formatting toolbar and the context menu offer the same things — bold, a
 * list, an alignment, a row in a table — and each is one Tiptap command with a
 * name, an icon and a shortcut. Written here, both draw from the same list: a
 * shortcut renamed or a table action added shows up in both, and neither can
 * offer a command the other has quietly stopped running.
 *
 * Every action starts its chain from `start`, which is how the two callers
 * differ: the toolbar acts on the focused field's selection, the menu on the
 * place that was right-clicked, which it has already put the selection at.
 */

import type { ChainedCommands, Editor } from '@tiptap/react'
import type { IconName } from '../components/Icon'
import { ACCENT_NODE } from '../../domain/richdoc'
import type { VerticalAlign } from '../../domain/types'
import { alignmentIsActive, type Alignment } from './extensions'
import { IMAGE_WIDTH_PRESETS } from './SlaidsImageExtension'

export interface TextAction {
  id: string
  label: string
  icon: IconName
  /** The keyboard shortcut that does the same, as the shortcut list writes it. */
  shortcut?: string
  isActive: () => boolean
  /** Whether the command would do anything where the selection is now. */
  can: () => boolean
  run: () => void
}

/** Where an action's chain starts: the editor, focused, on what it acts on. */
export type ChainStart = () => ChainedCommands

export function focusChain(editor: Editor): ChainStart {
  return () => editor.chain().focus()
}

/** A toolbar button's tooltip: its name, and the shortcut that does the same. */
export function actionTitle(action: Pick<TextAction, 'label' | 'shortcut'>): string {
  return action.shortcut ? `${action.label} (${action.shortcut})` : action.label
}

type Command = (chain: ChainedCommands) => ChainedCommands

function action(
  editor: Editor,
  start: ChainStart,
  spec: Omit<TextAction, 'run' | 'can' | 'isActive'> & {
    command: Command
    isActive?: () => boolean
  },
): TextAction {
  const { command, isActive, ...rest } = spec
  return {
    ...rest,
    isActive: isActive ?? (() => false),
    can: () => command(editor.can().chain()).run(),
    run: () => {
      command(start()).run()
    },
  }
}

/**
 * Sub- and superscript, offered wherever text can be typed: they only ever
 * shrink and shift a run of characters, never wrap a line or widen it by more
 * than the characters themselves would, so nothing about the geometry that
 * keeps a title zone predictable stands in the way of them.
 */
export function scriptActions(editor: Editor, start: ChainStart = focusChain(editor)): TextAction[] {
  return [
    action(editor, start, {
      id: 'subscript',
      label: 'Senket skrift',
      icon: 'subscript',
      shortcut: 'Ctrl+,',
      isActive: () => editor.isActive('subscript'),
      command: (chain) => chain.toggleSubscript(),
    }),
    action(editor, start, {
      id: 'superscript',
      label: 'Hevet skrift',
      icon: 'superscript',
      shortcut: 'Ctrl+.',
      isActive: () => editor.isActive('superscript'),
      command: (chain) => chain.toggleSuperscript(),
    }),
  ]
}

/** Everything that marks a run of characters in a body field. */
export function markActions(editor: Editor, start: ChainStart = focusChain(editor)): TextAction[] {
  return [
    action(editor, start, {
      id: 'bold',
      label: 'Fet',
      icon: 'bold',
      shortcut: 'Ctrl+B',
      isActive: () => editor.isActive('bold'),
      command: (chain) => chain.toggleBold(),
    }),
    action(editor, start, {
      id: 'italic',
      label: 'Kursiv',
      icon: 'italic',
      shortcut: 'Ctrl+I',
      isActive: () => editor.isActive('italic'),
      command: (chain) => chain.toggleItalic(),
    }),
    action(editor, start, {
      id: 'underline',
      label: 'Understreket',
      icon: 'underline',
      shortcut: 'Ctrl+U',
      isActive: () => editor.isActive('underline'),
      command: (chain) => chain.toggleUnderline(),
    }),
    ...scriptActions(editor, start),
  ]
}

/** What a paragraph in a body field can be instead of a paragraph. */
export function blockActions(editor: Editor, start: ChainStart = focusChain(editor)): TextAction[] {
  return [
    /*
     * «Aksent», not «Overskrift». The stored node is still a heading — it has
     * always been one and renaming it would be a migration for nothing — but
     * what it *is* in a slide is an accent: a subheading, a highlighted point,
     * an internal division inside a card. A card's own main heading is its
     * card title, and a button here called «Overskrift» is what taught
     * authors and agents alike to write one instead of the other.
     */
    action(editor, start, {
      id: 'heading',
      label: 'Aksent',
      icon: 'heading',
      isActive: () => editor.isActive(ACCENT_NODE),
      command: (chain) => chain.toggleHeading({ level: 1 }),
    }),
    action(editor, start, {
      id: 'bullet',
      label: 'Punktliste',
      icon: 'bullet-list',
      isActive: () => editor.isActive('bulletList'),
      command: (chain) => chain.toggleBulletList(),
    }),
    action(editor, start, {
      id: 'ordered',
      label: 'Nummerert liste',
      icon: 'ordered-list',
      isActive: () => editor.isActive('orderedList'),
      command: (chain) => chain.toggleOrderedList(),
    }),
    action(editor, start, {
      id: 'quote',
      label: 'Sitat',
      icon: 'quote',
      isActive: () => editor.isActive('blockquote'),
      command: (chain) => chain.toggleBlockquote(),
    }),
    action(editor, start, {
      id: 'code',
      label: 'Kode',
      icon: 'code',
      isActive: () => editor.isActive('codeBlock'),
      command: (chain) => chain.toggleCodeBlock(),
    }),
  ]
}

export function insertTableAction(editor: Editor, start: ChainStart = focusChain(editor)): TextAction {
  return action(editor, start, {
    id: 'table',
    label: 'Sett inn tabell',
    icon: 'table',
    isActive: () => editor.isActive('table'),
    command: (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  })
}

const ALIGNMENT_ACTIONS: readonly [Alignment, string, IconName][] = [
  ['left', 'Venstrestill', 'align-left'],
  ['center', 'Midtstill', 'align-center'],
  ['right', 'Høyrestill', 'align-right'],
]

/** Where a line sits across its field — none at all in a field that is always centred, like a section's. */
export function alignActions(editor: Editor, start: ChainStart = focusChain(editor)): TextAction[] {
  if (!('setTextAlign' in editor.commands)) return []
  return ALIGNMENT_ACTIONS.map(([value, label, icon]) =>
    action(editor, start, {
      id: `align-${value}`,
      label,
      icon,
      isActive: () => alignmentIsActive(editor, value),
      command: (chain) => chain.setTextAlign(value),
    }),
  )
}

/** Where a body field's content sits in the height it is given. A domain command, not an editor one. */
export const VERTICAL_ALIGNMENTS: readonly [VerticalAlign, string, IconName][] = [
  ['top', 'Toppjuster innholdet', 'align-top-v'],
  ['middle', 'Midtjuster innholdet', 'align-middle-v'],
  ['bottom', 'Bunnjuster innholdet', 'align-bottom-v'],
]

/** Rows, columns, the header row and the table itself, in the order a menu groups them. */
export interface TableAction extends TextAction {
  group: 'row' | 'column' | 'header' | 'table'
  /** Shown in the formatting toolbar too, which keeps to the common ones. */
  toolbar: boolean
}

export function tableActions(editor: Editor, start: ChainStart = focusChain(editor)): TableAction[] {
  const table = (
    group: TableAction['group'],
    toolbar: boolean,
    spec: Parameters<typeof action>[2],
  ): TableAction => ({ ...action(editor, start, spec), group, toolbar })
  return [
    table('row', false, { id: 'add-row-before', label: 'Rad over', icon: 'arrow-up', command: (c) => c.addRowBefore() }),
    table('row', true, { id: 'add-row', label: 'Rad under', icon: 'arrow-down', command: (c) => c.addRowAfter() }),
    table('row', true, { id: 'del-row', label: 'Slett rad', icon: 'minus', command: (c) => c.deleteRow() }),
    table('column', false, {
      id: 'add-col-before',
      label: 'Kolonne før',
      icon: 'chevron-left',
      command: (c) => c.addColumnBefore(),
    }),
    table('column', true, {
      id: 'add-col',
      label: 'Kolonne etter',
      icon: 'chevron-right',
      command: (c) => c.addColumnAfter(),
    }),
    table('column', true, { id: 'del-col', label: 'Slett kolonne', icon: 'minus', command: (c) => c.deleteColumn() }),
    table('header', true, {
      id: 'header',
      label: 'Headerrad',
      icon: 'heading',
      isActive: () => hasHeaderRow(editor),
      command: (c) => c.toggleHeaderRow(),
    }),
    table('table', true, { id: 'del-table', label: 'Slett tabell', icon: 'trash', command: (c) => c.deleteTable() }),
  ]
}

/** Whether the table the selection is in starts with a header row. */
function hasHeaderRow(editor: Editor): boolean {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return node.firstChild?.firstChild?.type.name === 'tableHeader'
  }
  return false
}

/** The widths a picture in the text is offered at. Applied to the selected picture. */
export function imageWidthActions(editor: Editor): TextAction[] {
  return IMAGE_WIDTH_PRESETS.map((percent) => ({
    id: `image-width-${percent}`,
    label: `${percent}%`,
    icon: 'image',
    isActive: () => editor.getAttributes('slaidsImage').widthPercent === percent,
    can: () => editor.can().setSlaidsImageWidth(percent),
    run: () => {
      editor.chain().setSlaidsImageWidth(percent).focus().run()
    },
  }))
}

/**
 * Ask for a link address and set it on the selection — or take the link off,
 * when the answer is empty. Cancelling leaves everything as it was.
 */
export function editLink(editor: Editor, start: ChainStart = focusChain(editor)): void {
  const previous = (editor.getAttributes('link').href as string | undefined) ?? ''
  const href = window.prompt('Lenkeadresse', previous)
  if (href === null) return
  if (href.trim() === '') {
    start().unsetLink().run()
    return
  }
  start().extendMarkRange('link').setLink({ href: href.trim() }).run()
}
