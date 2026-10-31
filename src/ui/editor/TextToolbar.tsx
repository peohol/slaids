/**
 * Formatting toolbar for the field that currently has focus.
 *
 * It names the field it works on and then offers, in fixed groups, what that
 * field can do: formatting, paragraph, alignment, link and insert — the same
 * groups, names and entries the context menu has (`textActions`,
 * `contextMenu/textMenu`). Each button is drawn from the menu's entry for the
 * same action, so it is pressed where the menu would check it and disabled
 * where the menu would refuse it. What only applies where the caret is — the
 * accent's colour, a table, a picture in the text — comes last, so the fixed
 * groups never move as the caret does; a table and a picture open the very
 * menu a right-click on them opens.
 *
 * Most of it is deliberately absent while editing a title: titles carry no
 * formatting beyond subscript and superscript, which is what keeps them
 * geometrically predictable — see `titleExtensions` in `./extensions`.
 */

import { useEffect, type KeyboardEvent, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { setVerticalAlign } from '../../domain/commands'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { findLeaf } from '../../domain/layout'
import { sectionGoverning } from '../../domain/presentation'
import type { VerticalAlign } from '../../domain/types'
import { domFitCheckers } from '../../state/measure'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore, type ActiveField } from '../../state/store'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { Icon } from '../components/Icon'
import { MenuButton } from '../components/MenuButton'
import { Tooltip } from '../components/Tooltip'
import { ColorPickerButton } from '../components/ColorPicker'
import type { MenuAction } from '../components/contextMenu'
import { keepFocus } from '../components/focusKeeping'
import { pressedButton } from '../components/pressed'
import { inheritedPill, standardLabel } from './colorInheritance'
import { inlineImageEntries, tableEntries, textEntry } from './contextMenu/textMenu'
import { SymbolPickerButton } from './SymbolPicker'
import {
  FIELD_TITLES,
  TEXT_GROUPS,
  VERTICAL_ALIGNMENTS,
  actionTitle,
  alignActions,
  blockActions,
  insertReferenceAction,
  insertTableAction,
  linkActions,
  markActions,
  scriptActions,
  verticalAlignOf,
} from './textActions'

/**
 * One button, drawn from the entry the context menu has for the same action:
 * pressed where the menu checks it, disabled — with the reason in its tooltip —
 * where the menu refuses it. A press never takes the caret out of the field.
 */
function EntryButton({ entry, testId, labelled = false }: { entry: MenuAction; testId: string; labelled?: boolean }) {
  const name = actionTitle(entry)
  const tip = entry.disabled && entry.reason ? `${name}. ${entry.reason}` : name
  const className = labelled ? 'btn btn--sm' : 'btn btn--sm btn--icon'
  const state = entry.checked === undefined ? { className } : pressedButton(className, entry.checked)
  return (
    <Tooltip label={tip} wrap={entry.disabled}>
      <button
        type="button"
        {...state}
        disabled={entry.disabled}
        onMouseDown={keepFocus}
        onClick={entry.onSelect}
        data-testid={testId}
        aria-label={name}
      >
        {entry.icon && <Icon name={entry.icon} size={15} />}
        {labelled && <span className="text-toolbar__label">{entry.label}</span>}
      </button>
    </Tooltip>
  )
}

function entryButtons(entries: MenuAction[], testIdPrefix = 'format-') {
  return entries.map((entry) => <EntryButton key={entry.id} entry={entry} testId={`${testIdPrefix}${entry.id}`} />)
}

/** A named group of controls: said to a screen reader, drawn as a divided run. */
function Group({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return (
    <div className="text-toolbar__group" role="group" aria-label={label} data-testid={testId}>
      {children}
    </div>
  )
}

/**
 * The arrow keys walk the toolbar, as they do any `role="toolbar"`, while Tab
 * still reaches every control in turn — nothing here is taken out of the tab
 * order, so the bar works the same for someone who never learnt the arrows.
 */
const ARROW_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }

function walkToolbar(event: KeyboardEvent<HTMLElement>): void {
  const step = ARROW_STEPS[event.key]
  if (step === undefined) return
  const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = controls.indexOf(document.activeElement as HTMLButtonElement)
  // A key pressed in a popover opened from the bar is the popover's own.
  if (index < 0) return
  const next = Math.min(controls.length - 1, Math.max(0, index + step))
  controls[next].focus()
  event.preventDefault()
}

/** Fields that live in a zone, and stop being the toolbar's target when another zone is selected. */
function inZone(field: ActiveField): boolean {
  return field.kind === 'body' || field.kind === 'card-title' || field.kind === 'caption'
}

export function TextToolbar({
  onInsertReference,
  onOptimizeImage,
}: {
  onInsertReference: () => void
  /** Shrink the file behind the selected inline picture; see `ImageOptimizeModal`. */
  onOptimizeImage: (assetId: string) => void
}) {
  const editor = useActiveEditor((state) => state.editor)
  const version = useActiveEditor((state) => state.version)
  const bump = useActiveEditor((state) => state.bump)
  const { coarse } = useWorkspace()
  const run = useEditorStore((state) => state.run)
  const slide = useEditorStore((state) => state.currentContentSlide())
  /*
   * The field last typed in is the target only while it is still what is
   * selected. Selecting another zone — with a click beside its text, the arrow
   * keys or the inspector — leaves the old field's editor mounted and its
   * selection intact, and a toolbar still aimed at it would format text in a
   * zone the author is no longer looking at.
   */
  const activeField = useEditorStore((state) =>
    state.activeField && (!inZone(state.activeField) || state.activeField.nodeId === state.selectedNodeId)
      ? state.activeField
      : null,
  )
  /** What a heading with no colour of its own is painted with: the section's, unless its card says otherwise. */
  const sectionAccent = useEditorStore((state) =>
    state.presentation && state.currentSlideId
      ? sectionGoverning(state.presentation, state.currentSlideId).accentColor
      : DEFAULT_PILL_COLOR,
  )

  useEffect(() => {
    if (!editor) return
    const handler = (): void => bump()
    editor.on('transaction', handler)
    editor.on('selectionUpdate', handler)
    return () => {
      editor.off('transaction', handler)
      editor.off('selectionUpdate', handler)
    }
  }, [editor, bump])

  if (!editor || !activeField) {
    return (
      <div className="text-toolbar text-toolbar--empty" data-testid="text-toolbar-empty">
        {/* A finger does not click. The bar is shown on a compact workspace
            while the focused zone is a writing surface, so the one sentence in
            it has to be about the pointer the reader actually has. */}
        <span className="hint">
          {coarse ? 'Trykk' : 'Klikk'} i et innholdsfelt for å redigere tekst.
        </span>
      </div>
    )
  }

  const fieldName = FIELD_TITLES[activeField.kind]
  const bar = (children: ReactNode, note?: string) => (
    <div
      className="text-toolbar"
      role="toolbar"
      aria-label={`Tekstverktøy for ${fieldName.toLowerCase()}`}
      data-testid="text-toolbar"
      data-field={activeField.kind}
      data-version={version}
      onKeyDown={walkToolbar}
    >
      <span className="text-toolbar__field" data-testid="text-toolbar-field">
        {fieldName}
        {note && <span className="text-toolbar__note"> – {note}</span>}
      </span>
      {children}
    </div>
  )
  const scripts = (
    <Group label={TEXT_GROUPS.formatting} testId="script-tools">
      {entryButtons(scriptActions(editor).map(textEntry))}
    </Group>
  )
  const symbols = (
    <Group label={TEXT_GROUPS.insert}>
      <SymbolPickerButton editor={editor} />
    </Group>
  )

  // A section's two lines carry no alignment at all — they are centred by
  // construction, so there is nothing to offer for that — but they are still
  // text somebody types, so subscript, superscript and the symbol picker
  // still apply.
  if (activeField.kind === 'section-title' || activeField.kind === 'section-subtitle') {
    return bar(
      <>
        {scripts}
        {symbols}
      </>,
      'alltid midtstilt',
    )
  }

  const align = alignActions(editor)
  const horizontal = align.length > 0 && (
    <div className="text-toolbar__set" role="group" aria-label="Vannrett justering" data-testid="align-tools">
      {entryButtons(align.map(textEntry), '')}
    </div>
  )

  // A title, a card title and a caption carry no formatting beyond subscript
  // and superscript — that restriction is what keeps them geometrically
  // predictable — but they are still text on a slide, and where it sits on the
  // line is a layout decision the author gets to make.
  if (activeField.kind !== 'body') {
    return bar(
      <>
        {scripts}
        {horizontal && <Group label={TEXT_GROUPS.alignment}>{horizontal}</Group>}
        {symbols}
      </>,
    )
  }

  // Only a body field reaches here (see the guard above), so it always names a
  // subfield — a card title and a caption have no flow to align.
  const { nodeId, subfieldId } = activeField
  const vertical =
    slide && subfieldId ? (
      <div className="text-toolbar__set" role="group" aria-label="Loddrett justering" data-testid="vertical-align-tools">
        {entryButtons(
          verticalEntries(verticalAlignOf(slide.root, nodeId, subfieldId), (align) =>
            run('vertical-align', (presentation) =>
              setVerticalAlign(presentation, { slideId: slide.id, nodeId, subfieldId, align, ...domFitCheckers }),
            ),
          ),
          '',
        )}
      </div>
    ) : null

  return bar(
    <>
      <Group label={TEXT_GROUPS.formatting} testId="mark-tools">
        {entryButtons(markActions(editor).map(textEntry))}
      </Group>
      <Group label={TEXT_GROUPS.paragraph} testId="paragraph-tools">
        {entryButtons(blockActions(editor).map(textEntry))}
      </Group>
      <Group label={TEXT_GROUPS.alignment}>
        {horizontal}
        {vertical}
      </Group>
      <Group label={TEXT_GROUPS.link} testId="link-tools">
        {entryButtons(linkActions(editor).map(textEntry))}
      </Group>
      <Group label={TEXT_GROUPS.insert} testId="insert-tools">
        {entryButtons([textEntry(insertTableAction(editor))])}
        <SymbolPickerButton editor={editor} />
        <EntryButton entry={textEntry(insertReferenceAction(editor, onInsertReference))} testId="insert-reference" labelled />
      </Group>
      <WhereTheCaretIs
        editor={editor}
        accent={inheritedPill(slide ? findLeaf(slide.root, nodeId)?.content : null, sectionAccent)}
        onOptimizeImage={onOptimizeImage}
      />
    </>,
  )
}

/** The vertical alignment choices for one body field, as entries; the one in force is pressed. */
function verticalEntries(current: VerticalAlign, set: (align: VerticalAlign) => void): MenuAction[] {
  return VERTICAL_ALIGNMENTS.map(([align, label, icon]) => ({
    kind: 'action',
    id: `valign-${align}`,
    label,
    icon,
    checked: current === align,
    onSelect: () => set(align),
  }))
}

/**
 * What only applies where the caret is: the colour of the accent it is in, the
 * table it is in, the picture that is selected. Last in the bar, so nothing
 * before it moves when one of them comes or goes.
 */
function WhereTheCaretIs({
  editor,
  accent,
  onOptimizeImage,
}: {
  editor: Editor
  accent: { color: string; from: string }
  onOptimizeImage: (assetId: string) => void
}) {
  const inAccent = editor.isActive('heading')
  const inTable = editor.isActive('table')
  const onImage = editor.isActive('slaidsImage')
  if (!inAccent && !inTable && !onImage) return null

  /*
   * An accent with no colour of its own is not "the default hex": it follows
   * its card's title, or the section the slide belongs to. The picker therefore
   * shows the resolved colour but marks «Standard» as the choice in force, and
   * picking Standard again clears the attribute rather than writing today's
   * colour into the document — which is what keeps it following tomorrow.
   */
  const picked: unknown = editor.getAttributes('heading').color
  const explicitColor = typeof picked === 'string' ? picked : null

  return (
    <Group label="Der markøren står" testId="caret-tools">
      {inAccent && (
        <ColorPickerButton
          label="Aksentfarge"
          className="btn--sm"
          value={explicitColor ?? accent.color}
          testId="heading-color"
          keepFocus
          inherited={{
            color: accent.color,
            label: standardLabel(accent.from),
            active: explicitColor === null,
            onSelect: () => editor.chain().focus().updateAttributes('heading', { color: null }).run(),
          }}
          onChange={(color) => editor.chain().focus().updateAttributes('heading', { color }).run()}
        />
      )}
      {inTable && (
        <MenuButton
          id="text-table"
          label="Tabell"
          title="Tabell"
          tooltip="Rader, kolonner og tabellen"
          icon="table"
          testId="table-tools"
          keepFocus
          entries={() => tableEntries(editor)}
        />
      )}
      {onImage && (
        <MenuButton
          id="text-image"
          label="Bilde"
          title="Bilde i teksten"
          tooltip="Størrelse, optimalisering og fjerning"
          icon="image"
          tone="media"
          testId="image-tools"
          keepFocus
          entries={() => inlineImageEntries(editor, { optimizeAsset: onOptimizeImage })}
        />
      )}
    </Group>
  )
}
