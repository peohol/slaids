/**
 * Formatting toolbar for the field that currently has focus.
 *
 * It is deliberately absent while editing a title: titles carry no formatting,
 * which is what keeps them geometrically predictable.
 */

import { useEffect } from 'react'
import { setVerticalAlign } from '../../domain/commands'
import type { VerticalAlign } from '../../domain/types'
import { domFitCheckers } from '../../state/measure'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import type { Alignment } from './extensions'
import { Icon, type IconName } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ColorPickerButton } from '../components/ColorPicker'
import { IMAGE_WIDTH_PRESETS } from './SlaidsImageExtension'
import { SHAPE_HEIGHT_PRESETS } from './SlaidsShapeExtension'

const SHAPE_LABELS = {
  rectangle: 'Rektangel',
  ellipse: 'Ellipse',
  triangle: 'Trekant',
  line: 'Linje',
  arrow: 'Pil',
} as const

interface MarkButton {
  id: string
  label: string
  icon: IconName
  isActive: () => boolean
  run: () => void
}

export function TextToolbar({ onInsertReference }: { onInsertReference: () => void }) {
  const editor = useActiveEditor((state) => state.editor)
  const version = useActiveEditor((state) => state.version)
  const bump = useActiveEditor((state) => state.bump)
  const activeField = useEditorStore((state) => state.activeField)
  const slideId = useEditorStore((state) => state.currentSlideId)
  const run = useEditorStore((state) => state.run)

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
        <span className="hint">Klikk i et innholdsfelt for å redigere tekst.</span>
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
              editor.isActive({ textAlign: value })
                ? 'btn btn--sm btn--icon btn--active'
                : 'btn btn--sm btn--icon'
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign(value).run()}
            data-testid={`align-${value}`}
            aria-label={label}
            aria-pressed={editor.isActive({ textAlign: value })}
          >
            <Icon name={icon} size={15} />
          </button>
        </Tooltip>
      ))}
    </div>
  )

  // A title carries no formatting — that is what keeps the title zone
  // geometrically predictable — but it is still text on a slide, and where it
  // sits on the line is a layout decision the author gets to make.
  if (activeField.kind !== 'body') {
    return (
      <div className="text-toolbar" data-testid="text-toolbar" data-version={version}>
        <span className="hint">Overskrift</span>
        {alignButtons}
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
    {
      id: 'heading',
      label: 'Overskrift',
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
    {
      id: 'shape',
      label: 'Sett inn figur',
      icon: 'shapes',
      isActive: () => editor.isActive('slaidsShape'),
      run: () => editor.chain().focus().insertSlaidsShape().run(),
    },
  ]

  const verticalButtons = slideId ? (
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
                  subfieldId: activeField.subfieldId,
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
  const headingColor =
    typeof editor.getAttributes('heading').color === 'string'
      ? (editor.getAttributes('heading').color as string)
      : '#33475b'

  return (
    <div className="text-toolbar" data-testid="text-toolbar" data-version={version}>
      {buttons.map((button) => (
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
      ))}

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

      {headingActive && (
        <ColorPickerButton
          label="Overskriftsfarge"
          value={headingColor}
          testId="heading-color"
          onChange={(color) => editor.chain().focus().updateAttributes('heading', { color }).run()}
        />
      )}

      {editor.isActive('slaidsShape') && (
        <div className="text-toolbar__table" data-testid="shape-tools">
          <span className="hint">Figur:</span>
          {(['rectangle', 'ellipse', 'triangle', 'line', 'arrow'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={
                editor.getAttributes('slaidsShape').kind === kind
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().updateSlaidsShape({ kind }).focus().run()}
              data-testid={`shape-node-${kind}`}
            >
              {SHAPE_LABELS[kind]}
            </button>
          ))}
          {SHAPE_HEIGHT_PRESETS.map((height) => (
            <button
              key={height}
              type="button"
              className={
                editor.getAttributes('slaidsShape').height === height
                  ? 'btn btn--sm btn--active'
                  : 'btn btn--sm'
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().updateSlaidsShape({ height }).focus().run()}
              data-testid={`shape-height-${height}`}
            >
              {height}
            </button>
          ))}
          <ColorPickerButton
            label="Fyll"
            value={String(editor.getAttributes('slaidsShape').fill ?? '#bfccd9')}
            testId="shape-fill"
            onChange={(fill) => editor.chain().updateSlaidsShape({ fill }).focus().run()}
          />
        </div>
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
