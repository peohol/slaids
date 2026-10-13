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
  alignActions,
  blockActions,
  editLink,
  imageWidthActions,
  insertTableAction,
  markActions,
  scriptActions,
  tableActions,
  type ChainStart,
  type TextAction,
} from '../textActions'
import type { FieldTarget } from './contentTarget'

export interface TextMenuHandlers {
  /** The reference dialog, which inserts at the caret of the field in focus. */
  insertReference: () => void
  /** Shrink one file, wherever it is used. */
  optimizeAsset: (assetId: string) => void
  copyText: (text: string) => void
}

/** What the menu for a field says it is about. */
export const FIELD_TITLES: Record<FieldTarget['field']['kind'], string> = {
  body: 'Tekst',
  'card-title': 'Korttittel',
  caption: 'Bildetekst',
  'slide-title': 'Lysbildetittel',
  'section-title': 'Overskrift',
  'section-subtitle': 'Underoverskrift',
}

/** A text action as an entry, with the state it is in where the selection is. */
export function textEntry(action: TextAction): MenuAction {
  return {
    kind: 'action',
    id: action.id,
    label: action.label,
    icon: action.icon,
    shortcut: action.shortcut,
    checked: action.isActive(),
    disabled: !action.can(),
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
              label: `Standard (${inherited})`,
              checked: value === null,
              onSelect: () => onSelect(null),
            } satisfies MenuAction,
          ]
        : []),
      { kind: 'swatches', id: `${id}-swatches`, label, rows: PALETTE, value, onSelect },
    ],
  }
}

/**
 * The menu for some text: what can be done to the characters, the paragraph
 * and the field, as far as the field's schema allows. A title has no lists to
 * offer and a section's line no alignment — whatever its editor cannot do is
 * left out rather than offered and refused.
 *
 * `vertical` is the body field's own alignment within its box, a document
 * change rather than an editor one, which the caller builds.
 */
export function textEntries(at: FieldTarget, handlers: TextMenuHandlers, vertical: MenuEntry[] = []): MenuEntry[] {
  const { editor, field } = at
  const start: ChainStart = () => editor.chain().focus()
  const body = field.kind === 'body'
  const selected = !editor.state.selection.empty

  const formatting: MenuEntry = {
    kind: 'submenu',
    id: 'formatting',
    label: 'Formatering',
    icon: 'bold',
    // A mark goes on characters, and with nothing marked there are none.
    disabled: !selected,
    reason: selected ? null : 'Marker teksten først.',
    entries: (body ? markActions(editor, start) : scriptActions(editor, start)).map(textEntry),
  }

  const alignment: MenuEntry = {
    kind: 'submenu',
    id: 'alignment',
    label: 'Justering',
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

  const linked = editor.isActive('link')
  const accent = editor.isActive('heading')
  const pickedAccent: unknown = editor.getAttributes('heading').color
  return [
    formatting,
    { kind: 'submenu', id: 'paragraph', label: 'Avsnitt', icon: 'heading', entries: blockActions(editor, start).map(textEntry) },
    alignment,
    ...(accent
      ? [
          colorSubmenu('accent-color', 'Aksentfarge', typeof pickedAccent === 'string' ? pickedAccent : null, 'fra forsiden', (color) =>
            start().updateAttributes('heading', { color }).run(),
          ),
        ]
      : []),
    SEPARATOR,
    {
      kind: 'action',
      id: 'link',
      label: linked ? 'Endre lenke …' : 'Lenke …',
      icon: 'link',
      onSelect: () => editLink(editor, start),
    },
    ...(linked
      ? [
          {
            kind: 'action',
            id: 'unlink',
            label: 'Fjern lenke',
            icon: 'close',
            onSelect: () => start().extendMarkRange('link').unsetLink().run(),
          } satisfies MenuAction,
        ]
      : []),
    {
      kind: 'submenu',
      id: 'insert',
      label: 'Sett inn',
      icon: 'plus',
      entries: [
        {
          kind: 'action',
          id: 'insert-reference',
          label: 'Referanse …',
          icon: 'reference',
          // The dialog inserts at the caret of the field in focus, so the
          // field is given the focus — and the caret — first.
          onSelect: () => {
            start().run()
            handlers.insertReference()
          },
        },
        { ...textEntry(insertTableAction(editor, start)), label: 'Tabell', checked: undefined },
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
    if (action.group !== 'header') entry.checked = undefined
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
