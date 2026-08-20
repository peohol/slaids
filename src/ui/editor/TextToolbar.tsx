/**
 * Formatting toolbar for the field that currently has focus.
 *
 * It is deliberately absent while editing a title: titles carry no formatting,
 * which is what keeps them geometrically predictable.
 */

import { useEffect } from 'react'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import { Icon, type IconName } from '../components/Icon'
import { Tooltip } from '../components/Tooltip'
import { ColorPickerButton } from '../components/ColorPicker'

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

  if (!editor || !activeField || activeField.kind !== 'body') {
    return (
      <div className="text-toolbar text-toolbar--empty" data-testid="text-toolbar-empty">
        <span className="hint">
          {activeField && activeField.kind !== 'body'
            ? 'Titler kan ikke formateres.'
            : 'Klikk i et innholdsfelt for å redigere tekst.'}
        </span>
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
  ]

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
