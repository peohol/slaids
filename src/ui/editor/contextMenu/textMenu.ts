/**
 * The parts of a menu about text: the words in a field, a table in it, a
 * picture in it — and the colour grid, which text and the things around it
 * share. Every field on every kind of page draws its menu from these, so
 * «Formatering» is the same submenu in a card's body, on a slide title and on
 * a section's heading, with whatever that field's editor can do in it.
 */

import type { Editor } from '@tiptap/react'
import { PALETTE } from '../../../domain/color'
import { SEPARATOR, type MenuAction, type MenuEntry } from '../../components/contextMenu'
import {
  TEXT_ACTION_UNAVAILABLE,
  TEXT_GROUPS,
  alignActions,
  blockActions,
  imageWidthActions,
  insertReferenceAction,
  insertTableAction,
  linkActions,
  markActions,
  scriptActions,
  tableActions,
  type ChainStart,
  type TextAction,
} from '../textActions'
import { standardLabel } from '../colorInheritance'
import type { FieldTarget } from './contentTarget'

export interface TextMenuHandlers {
  /** The reference dialog, which inserts at the caret of the field in focus. */
  insertReference: () => void
  /** Shrink one file, wherever it is used. */
  optimizeAsset: (assetId: string) => void
  copyText: (text: string) => void
}

/**
 * A text action as an entry, with the state it is in where the selection is.
 * The text toolbar draws its buttons from the same entries, so a command the
 * editor cannot run is disabled — for the same reason — on both.
 */
export function textEntry(action: TextAction): MenuAction {
  const available = action.can()
  return {
    kind: 'action',
    id: action.id,
    label: action.label,
    icon: action.icon,
    shortcut: action.shortcut,
    checked: action.isActive?.(),
    disabled: !available,
    reason: available ? null : TEXT_ACTION_UNAVAILABLE,
    onSelect: action.run,
  }
}

/**
 * A colour choice: «Standard», when there is a colour to inherit instead —
 * `inherited` says from where — and the palette.
 */
export function colorSubmenu(
  id: string,
  label: string,
  value: string | null,
  inherited: string | null,
  onSelect: (color: string | null) => void,
): MenuEntry {
  return {
    kind: 'submenu',
    id,
    label,
    icon: 'palette',
    entries: [
      ...(inherited !== null
        ? [
            {
              kind: 'action',
              id: `${id}-default`,
              label: standardLabel(inherited),
              checked: value === null,
              onSelect: () => onSelect(null),
            } satisfies MenuAction,
          ]
        : []),
      { kind: 'swatches', id: `${id}-swatches`, label, rows: PALETTE, value, onSelect },
    ],
  }
}

/** What the caller knows about a body field that its editor does not. */
export interface BodyFieldExtras {
  /**
   * The field's own alignment within its box, a document change rather than
   * an editor one, which the caller builds.
   */
  vertical?: MenuEntry[]
  /** Where an accent with no colour of its own takes its colour from; see `colorInheritance`. */
  accentInherits?: string
}

/**
 * The menu for some text: what can be done to the characters, the paragraph
 * and the field, as far as the field's schema allows. A title has no lists to
 * offer and a section's line no alignment — whatever its editor cannot do is
 * left out rather than offered and refused.
 */
export function textEntries(
  at: FieldTarget,
  handlers: TextMenuHandlers,
  { vertical = [], accentInherits }: BodyFieldExtras = {},
): MenuEntry[] {
  const { editor, field } = at
  const start: ChainStart = () => editor.chain().focus()
  const body = field.kind === 'body'
  const selected = !editor.state.selection.empty

  const formatting: MenuEntry = {
    kind: 'submenu',
    id: 'formatting',
    label: TEXT_GROUPS.formatting,
    icon: 'bold',
    // A mark goes on characters, and with nothing marked there are none.
    disabled: !selected,
    reason: selected ? null : 'Marker teksten først.',
    entries: (body ? markActions(editor, start) : scriptActions(editor, start)).map(textEntry),
  }

  const alignment: MenuEntry = {
    kind: 'submenu',
    id: 'alignment',
    label: TEXT_GROUPS.alignment,
    icon: 'align-left',
    entries: [
      ...alignActions(editor, start).map(textEntry),
      ...(vertical.length > 0 ? [SEPARATOR, ...vertical] : []),
    ],
  }

  if (!body) {
    return [
      {
        kind: 'action',
        id: 'copy-text',
        label: 'Kopier tekst',
        icon: 'copy',
        disabled: editor.state.doc.textContent.trim() === '',
        onSelect: () => handlers.copyText(editor.state.doc.textContent),
      },
      formatting,
      alignment,
    ]
  }

  const accent = editor.isActive('heading')
  const pickedAccent: unknown = editor.getAttributes('heading').color
  return [
    formatting,
    { kind: 'submenu', id: 'paragraph', label: TEXT_GROUPS.paragraph, icon: 'heading', entries: blockActions(editor, start).map(textEntry) },
    alignment,
    ...(accent && accentInherits
      ? [
          colorSubmenu('accent-color', 'Aksentfarge', typeof pickedAccent === 'string' ? pickedAccent : null, accentInherits, (color) =>
            start().updateAttributes('heading', { color }).run(),
          ),
        ]
      : []),
    SEPARATOR,
    ...linkActions(editor, start).map(textEntry),
    {
      kind: 'submenu',
      id: 'insert',
      label: TEXT_GROUPS.insert,
      icon: 'plus',
      entries: [
        textEntry(insertReferenceAction(editor, handlers.insertReference, start)),
        { ...textEntry(insertTableAction(editor, start)), label: 'Tabell' },
      ],
    },
  ]
}

/** A table, from the cell the selection is in. */
export function tableEntries(editor: Editor): MenuEntry[] {
  const start: ChainStart = () => editor.chain().focus()
  const entries: MenuEntry[] = []
  let group: string | null = null
  for (const action of tableActions(editor, start)) {
    if (group !== null && action.group !== group) entries.push(SEPARATOR)
    group = action.group
    const entry = textEntry(action)
    if (action.group === 'table') {
      entry.label = 'Slett tabell …'
      entry.danger = true
      entry.confirm = {
        title: 'Slette tabellen?',
        message: 'Hele tabellen og teksten i den fjernes. Du kan angre etterpå.',
        confirmLabel: 'Slett tabellen',
      }
    }
    entries.push(entry)
  }
  return entries
}

/** A picture in the text, which the selection is on. */
export function inlineImageEntries(editor: Editor, handlers: Pick<TextMenuHandlers, 'optimizeAsset'>): MenuEntry[] {
  const assetId: unknown = editor.getAttributes('slaidsImage').assetId
  return [
    {
      kind: 'submenu',
      id: 'image-width',
      label: 'Størrelse',
      icon: 'expand',
      entries: imageWidthActions(editor).map((action) => ({ ...textEntry(action), icon: undefined })),
    },
    {
      kind: 'action',
      id: 'optimize-inline-image',
      label: 'Optimaliser …',
      icon: 'optimize',
      disabled: typeof assetId !== 'string' || assetId === '',
      onSelect: () => {
        if (typeof assetId === 'string') handlers.optimizeAsset(assetId)
      },
    },
    SEPARATOR,
    {
      kind: 'action',
      id: 'remove-inline-image',
      label: 'Fjern bildet …',
      icon: 'trash',
      danger: true,
      confirm: {
        title: 'Fjerne bildet?',
        message: 'Bildet tas ut av teksten. Du kan angre etterpå.',
        confirmLabel: 'Fjern bildet',
      },
      onSelect: () => editor.chain().focus().deleteSelection().run(),
    },
  ]
}
