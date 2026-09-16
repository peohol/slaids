/**
 * Formatting toolbar for the field that currently has focus.
 *
 * Most of it is deliberately absent while editing a title: titles carry no
 * formatting beyond subscript and superscript, which is what keeps them
 * geometrically predictable — see `titleExtensions` in `./extensions`.
 */

import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { setVerticalAlign } from '../../domain/commands'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import type { VerticalAlign } from '../../domain/types'
import { domFitCheckers } from '../../state/measure'
import { useActiveEditor } from '../../state/activeEditor'
import { sectionGoverning } from '../../domain/presentation'
import { useEditorStore } from '../../state/store'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { alignmentIsActive, type Alignment } from './extensions'
import { Icon, type IconName } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ColorPickerButton } from '../components/ColorPicker'
import { IMAGE_WIDTH_PRESETS } from './SlaidsImageExtension'
import { SymbolPickerButton } from './SymbolPicker'

interface MarkButton {
  id: string
  label: string
  icon: IconName
  isActive: () => boolean
  run: () => void
}

/**
 * Sub- and superscript, offered wherever text can be typed: they only ever
 * shrink and shift a run of characters, never wrap a line or widen it by more
 * than the characters themselves would, so nothing about the geometry that
 * keeps a title zone predictable stands in the way of them.
 */
function scriptButtons(editor: Editor): MarkButton[] {
  return [
    {
      id: 'subscript',
      label: 'Senket skrift (Ctrl+,)',
      icon: 'subscript',
      isActive: () => editor.isActive('subscript'),
      run: () => editor.chain().focus().toggleSubscript().run(),
    },
    {
      id: 'superscript',
      label: 'Hevet skrift (Ctrl+.)',
      icon: 'superscript',
      isActive: () => editor.isActive('superscript'),
      run: () => editor.chain().focus().toggleSuperscript().run(),
    },
  ]
}

function renderMarkButtons(buttons: MarkButton[]) {
  return buttons.map((button) => (
    <Tooltip key={button.id} label={button.label}>
      <button
        type="button"
        className={button.isActive() ? 'btn btn--sm btn--icon btn--active' : 'btn btn--sm btn--icon'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={button.run}
        data-testid={`format-${button.id}`}
        aria-label={button.label}
        aria-pressed={button.isActive()}
      >
        <Icon name={button.icon} size={15} />
      </button>
    </Tooltip>
  ))
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
  const activeField = useEditorStore((state) => state.activeField)
  const { coarse } = useWorkspace()
  const slideId = useEditorStore((state) => state.currentSlideId)
  const run = useEditorStore((state) => state.run)
  /** What a heading with no colour of its own is painted with: the section's. */
  const defaultPillColor = useEditorStore((state) =>
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

  // A section's two lines carry no alignment at all — they are centred by
  // construction, so there is nothing to offer for that — but they are still
  // text somebody types, so subscript, superscript and the symbol picker
  // still apply.
  if (activeField?.kind === 'section-title' || activeField?.kind === 'section-subtitle') {
    return (
      <div className="text-toolbar" data-testid="text-toolbar">
        <span className="hint">
          {activeField.kind === 'section-title' ? 'Overskrift' : 'Underoverskrift'} – alltid
          midtstilt
        </span>
        {editor && (
          <div className="text-toolbar__group" data-testid="script-tools">
            {renderMarkButtons(scriptButtons(editor))}
          </div>
        )}
        {editor && <SymbolPickerButton editor={editor} />}
      </div>
    )
  }

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

  const alignButtons = (
    <div className="text-toolbar__group" data-testid="align-tools">
      {(
        [
          ['left', 'Venstrestill', 'align-left'],
          ['center', 'Midtstill', 'align-center'],
          ['right', 'Høyrestill', 'align-right'],
        ] as [Alignment, string, IconName][]
      ).map(([value, label, icon]) => (
        <Tooltip key={value} label={label}>
          <button
            type="button"
            className={
              alignmentIsActive(editor, value)
                ? 'btn btn--sm btn--icon btn--active'
                : 'btn btn--sm btn--icon'
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign(value).run()}
            data-testid={`align-${value}`}
            aria-label={label}
            aria-pressed={alignmentIsActive(editor, value)}
          >
            <Icon name={icon} size={15} />
          </button>
        </Tooltip>
      ))}
    </div>
  )

  // A title carries no formatting beyond subscript and superscript — that
  // restriction is what keeps the title zone geometrically predictable — but
  // it is still text on a slide, and where it sits on the line is a layout
  // decision the author gets to make.
  if (activeField.kind !== 'body') {
    return (
      <div className="text-toolbar" data-testid="text-toolbar" data-version={version}>
        <span className="hint">Overskrift</span>
        <div className="text-toolbar__group" data-testid="script-tools">
          {renderMarkButtons(scriptButtons(editor))}
        </div>
        {alignButtons}
        <SymbolPickerButton editor={editor} />
      </div>
    )
  }

  const buttons: MarkButton[] = [
    {
      id: 'bold',
      label: 'Fet (Ctrl+B)',
      icon: 'bold',
      isActive: () => editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: 'italic',
      label: 'Kursiv (Ctrl+I)',
      icon: 'italic',
      isActive: () => editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: 'underline',
      label: 'Understreket (Ctrl+U)',
      icon: 'underline',
      isActive: () => editor.isActive('underline'),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    ...scriptButtons(editor),
    {
      /*
       * «Aksent», not «Overskrift». The stored node is still a heading — it has
       * always been one and renaming it would be a migration for nothing — but
       * what it *is* in a slide is an accent: a subheading, a highlighted point,
       * an internal division inside a card. A card's own main heading is its
       * card title, and a button here called «Overskrift» is what taught
       * authors and agents alike to write one instead of the other.
       */
      id: 'heading',
      label: 'Aksent',
      icon: 'heading',
      isActive: () => editor.isActive('heading'),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      id: 'bullet',
      label: 'Punktliste',
      icon: 'bullet-list',
      isActive: () => editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'ordered',
      label: 'Nummerert liste',
      icon: 'ordered-list',
      isActive: () => editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'quote',
      label: 'Sitat',
      icon: 'quote',
      isActive: () => editor.isActive('blockquote'),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'code',
      label: 'Kode',
      icon: 'code',
      isActive: () => editor.isActive('codeBlock'),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      id: 'table',
      label: 'Sett inn tabell',
      icon: 'table',
      isActive: () => editor.isActive('table'),
      run: () =>
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
  ]

  // Only a body field reaches here (see the guard above), so it always names a
  // subfield — a card title and a caption have no flow to align.
  const subfieldId = activeField.subfieldId
  const verticalButtons = slideId && subfieldId ? (
    <div className="text-toolbar__group" data-testid="vertical-align-tools">
      {(
        [
          ['top', 'Toppjuster innholdet', 'align-top-v'],
          ['middle', 'Midtjuster innholdet', 'align-middle-v'],
          ['bottom', 'Bunnjuster innholdet', 'align-bottom-v'],
        ] as [VerticalAlign, string, IconName][]
      ).map(([value, label, icon]) => (
        <Tooltip key={value} label={label}>
          <button
            type="button"
            className="btn btn--sm btn--icon"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              run('vertical-align', (presentation) =>
                setVerticalAlign(presentation, {
                  slideId,
                  nodeId: activeField.nodeId,
                  subfieldId,
                  align: value,
                  ...domFitCheckers,
                }),
              )
            }
            data-testid={`valign-${value}`}
            aria-label={label}
          >
            <Icon name={icon} size={15} />
          </button>
        </Tooltip>
      ))}
    </div>
  ) : null

  const headingActive = editor.isActive('heading')
  /*
   * An accent with no colour of its own is not "the default hex": it is an
   * accent that follows the cover. The picker therefore shows the resolved
   * colour but marks "Standard" as the choice in force, and picking Standard
   * again clears the attribute rather than writing today's colour into the
   * document — which is what keeps it following the cover tomorrow.
   */
  const headingColorAttr = editor.getAttributes('heading').color
  const explicitHeadingColor =
    typeof headingColorAttr === 'string' ? headingColorAttr : null

  return (
    <div className="text-toolbar" data-testid="text-toolbar" data-version={version}>
      {renderMarkButtons(buttons)}

      {alignButtons}
      {verticalButtons}

      <Tooltip label="Lenke">
        <button
          type="button"
          className={editor.isActive('link') ? 'btn btn--sm btn--icon btn--active' : 'btn btn--sm btn--icon'}
          onMouseDown={(event) => event.preventDefault()}
          data-testid="format-link"
          aria-label="Lenke"
          onClick={() => {
            const previous = (editor.getAttributes('link').href as string | undefined) ?? ''
            const href = window.prompt('Lenkeadresse', previous)
            if (href === null) return
            if (href.trim() === '') {
              editor.chain().focus().unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
          }}
        >
          <Icon name="link" size={15} />
        </button>
      </Tooltip>

      <SymbolPickerButton editor={editor} />

      {headingActive && (
        <ColorPickerButton
          label="Aksentfarge"
          value={explicitHeadingColor ?? defaultPillColor}
          testId="heading-color"
          inherited={{
            color: defaultPillColor,
            label: 'Standard (fra forsiden)',
            active: explicitHeadingColor === null,
            onSelect: () =>
              editor.chain().focus().updateAttributes('heading', { color: null }).run(),
          }}
          onChange={(color) => editor.chain().focus().updateAttributes('heading', { color }).run()}
        />
      )}

      {editor.isActive('slaidsImage') && (
        <div className="text-toolbar__table" data-testid="image-tools">
          <span className="hint">Bredde:</span>
          {IMAGE_WIDTH_PRESETS.map((percent) => (
            <button
              key={percent}
              type="button"
              className={
                editor.getAttributes('slaidsImage').widthPercent === percent
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().setSlaidsImageWidth(percent).focus().run()}
              data-testid={`image-width-${percent}`}
            >
              {percent}%
            </button>
          ))}
          <button
            type="button"
            className="btn btn--sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const assetId: unknown = editor.getAttributes('slaidsImage').assetId
              if (typeof assetId === 'string' && assetId) onOptimizeImage(assetId)
            }}
            data-testid="optimize-inline-image"
          >
            <Icon name="optimize" size={14} /> Optimaliser …
          </button>
        </div>
      )}

      {editor.isActive('table') && (
        <div className="text-toolbar__table" data-testid="table-tools">
          <span className="hint">Tabell:</span>
          {(
            [
              ['add-row', 'Rad under', () => editor.chain().focus().addRowAfter().run()],
              ['del-row', 'Slett rad', () => editor.chain().focus().deleteRow().run()],
              ['add-col', 'Kolonne etter', () => editor.chain().focus().addColumnAfter().run()],
              ['del-col', 'Slett kolonne', () => editor.chain().focus().deleteColumn().run()],
              ['header', 'Headerrad', () => editor.chain().focus().toggleHeaderRow().run()],
              ['del-table', 'Slett tabell', () => editor.chain().focus().deleteTable().run()],
            ] as const
          ).map(([id, label, action]) => (
            <button
              key={id}
              type="button"
              className="btn btn--sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={action}
              data-testid={`table-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="text-toolbar__spacer" />

      <Tooltip label="Sett inn referanse">
        <button
          type="button"
          className="btn btn--sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertReference}
          data-testid="insert-reference"
        >
          <Icon name="reference" size={15} /> Referanse
        </button>
      </Tooltip>
    </div>
  )
}
