/**
 * Formatting toolbar for the field that currently has focus.
 *
 * Most of it is deliberately absent while editing a title: titles carry no
 * formatting beyond subscript and superscript, which is what keeps them
 * geometrically predictable — see `titleExtensions` in `./extensions`.
 */

import { useEffect } from 'react'
import { setVerticalAlign } from '../../domain/commands'
import { DEFAULT_PILL_COLOR } from '../../domain/constants'
import { domFitCheckers } from '../../state/measure'
import { useActiveEditor } from '../../state/activeEditor'
import { sectionGoverning } from '../../domain/presentation'
import { useEditorStore } from '../../state/store'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { Icon } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ColorPickerButton } from '../components/ColorPicker'
import { SymbolPickerButton } from './SymbolPicker'
import {
  VERTICAL_ALIGNMENTS,
  actionTitle,
  alignActions,
  blockActions,
  editLink,
  imageWidthActions,
  insertTableAction,
  markActions,
  scriptActions,
  tableActions,
  type TextAction,
} from './textActions'

function renderActionButtons(actions: TextAction[], testIdPrefix = 'format-') {
  return actions.map((button) => {
    const title = actionTitle(button)
    return (
      <Tooltip key={button.id} label={title}>
        <button
          type="button"
          className={button.isActive() ? 'btn btn--sm btn--icon btn--active' : 'btn btn--sm btn--icon'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={button.run}
          data-testid={`${testIdPrefix}${button.id}`}
          aria-label={title}
          aria-pressed={button.isActive()}
        >
          <Icon name={button.icon} size={15} />
        </button>
      </Tooltip>
    )
  })
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
            {renderActionButtons(scriptActions(editor))}
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
      {renderActionButtons(alignActions(editor), '')}
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
          {renderActionButtons(scriptActions(editor))}
        </div>
        {alignButtons}
        <SymbolPickerButton editor={editor} />
      </div>
    )
  }

  const buttons = [...markActions(editor), ...blockActions(editor), insertTableAction(editor)]

  // Only a body field reaches here (see the guard above), so it always names a
  // subfield — a card title and a caption have no flow to align.
  const subfieldId = activeField.subfieldId
  const verticalButtons = slideId && subfieldId ? (
    <div className="text-toolbar__group" data-testid="vertical-align-tools">
      {VERTICAL_ALIGNMENTS.map(([value, label, icon]) => (
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
      {renderActionButtons(buttons)}

      {alignButtons}
      {verticalButtons}

      <Tooltip label="Lenke">
        <button
          type="button"
          className={editor.isActive('link') ? 'btn btn--sm btn--icon btn--active' : 'btn btn--sm btn--icon'}
          onMouseDown={(event) => event.preventDefault()}
          data-testid="format-link"
          aria-label="Lenke"
          onClick={() => editLink(editor)}
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
          {imageWidthActions(editor).map((width) => (
            <button
              key={width.id}
              type="button"
              className={width.isActive() ? 'btn btn--sm btn--active' : 'btn btn--sm'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={width.run}
              data-testid={width.id}
            >
              {width.label}
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
          {tableActions(editor)
            .filter((action) => action.toolbar)
            .map((action) => (
              <button
                key={action.id}
                type="button"
                className="btn btn--sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={action.run}
                data-testid={`table-${action.id}`}
              >
                {action.label}
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
