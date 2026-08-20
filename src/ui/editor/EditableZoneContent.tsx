/**
 * Editable rendering of zone content.
 *
 * Uses the same frame as the static renderer, so what the user edits is exactly
 * what will be presented — and exactly what the fit measurement sees.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setCardTitle, setContainerDoc, setSubfieldDoc } from '../../domain/commands'
import { measureElementOverflow } from '../../state/measure'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore } from '../../state/store'
import type { RichDoc, Subfield, ZoneContent } from '../../domain/types'
import { ZoneContentFrame } from '../slide/ZoneContentFrame'
import { AssetImage } from '../slide/AssetImage'
import { ShapeView } from '../slide/ShapeView'
import { RichTextEditor } from './RichTextEditor'

export function EditableZoneContent({
  content,
  nodeId,
  slideId,
}: {
  content: ZoneContent
  nodeId: string
  slideId: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const run = useEditorStore((state) => state.run)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const bump = useActiveEditor((state) => state.bump)
  const editorRef = useRef<Editor | null>(null)

  const measureOverflow = useCallback(() => {
    return hostRef.current ? measureElementOverflow(hostRef.current) : 0
  }, [])

  useEffect(() => {
    return () => {
      // Never leave a stale editor reference behind for the toolbars.
      if (editorRef.current && useActiveEditor.getState().editor === editorRef.current) {
        setActiveEditor(null)
      }
    }
  }, [setActiveEditor])

  const bindEditor = useCallback(
    (editor: Editor | null) => {
      editorRef.current = editor
    },
    [],
  )

  const focusEditor = useCallback(
    (kind: 'body' | 'card-title', subfieldId: string | null) => {
      setActiveField({ nodeId, subfieldId, kind })
      setActiveEditor(editorRef.current)
      bump()
    },
    [bump, nodeId, setActiveEditor, setActiveField],
  )

  const writeSubfield = (field: Subfield, doc: RichDoc): void => {
    run(`typing:${nodeId}:${field.id}`, (presentation) =>
      setSubfieldDoc(presentation, { slideId, nodeId, subfieldId: field.id, doc }),
    )
  }

  return (
    <div className="zone-host" ref={hostRef}>
      <ZoneContentFrame
        content={content}
        renderTitle={(card) => (
          <FieldEditor
            doc={card.title}
            variant="title"
            placeholder="Korttittel"
            measureOverflow={measureOverflow}
            overflowMessage="Tittelen får ikke plass i kortet."
            onFocus={() => focusEditor('card-title', null)}
            onEditorReady={bindEditor}
            onChange={(doc) =>
              run(`typing:${nodeId}:title`, (presentation) =>
                setCardTitle(presentation, { slideId, nodeId, doc }),
              )
            }
          />
        )}
        renderField={(field) => (
          <FieldEditor
            doc={field.doc}
            variant="body"
            measureOverflow={measureOverflow}
            onFocus={() => focusEditor('body', field.id)}
            onEditorReady={bindEditor}
            onChange={(doc) => writeSubfield(field, doc)}
          />
        )}
        renderContainer={(container) => {
          if (container.payload.type === 'asset') {
            return <AssetImage assetId={container.payload.assetId} fit={container.payload.fit} />
          }
          if (container.payload.type === 'shape') {
            return <ShapeView shape={container.payload.shape} />
          }
          return (
            <FieldEditor
              doc={container.payload.doc}
              variant="body"
              measureOverflow={measureOverflow}
              onFocus={() => focusEditor('body', null)}
              onEditorReady={bindEditor}
              onChange={(doc) =>
                run(`typing:${nodeId}:container`, (presentation) =>
                  setContainerDoc(presentation, { slideId, nodeId, doc }),
                )
              }
            />
          )
        }}
      />
    </div>
  )
}

/**
 * A single editable field. Focus wiring is separated so the surrounding
 * component can track which field is active without every field owning state.
 */
function FieldEditor({
  doc,
  variant,
  placeholder,
  onChange,
  onFocus,
  onEditorReady,
  measureOverflow,
  overflowMessage,
}: {
  doc: RichDoc
  variant: 'body' | 'title'
  placeholder?: string
  onChange: (doc: RichDoc) => void
  onFocus: () => void
  onEditorReady: (editor: Editor | null) => void
  measureOverflow: () => number
  overflowMessage?: string
}) {
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const bump = useActiveEditor((state) => state.bump)
  const localEditor = useRef<Editor | null>(null)

  const handleReady = useCallback(
    (editor: Editor | null) => {
      localEditor.current = editor
      onEditorReady(editor)
    },
    [onEditorReady],
  )

  const handleFocus = useCallback(() => {
    onEditorReady(localEditor.current)
    setActiveEditor(localEditor.current)
    bump()
    onFocus()
  }, [bump, onEditorReady, onFocus, setActiveEditor])

  return (
    <RichTextEditor
      doc={doc}
      variant={variant}
      placeholder={placeholder}
      onChange={onChange}
      onFocus={handleFocus}
      onEditorReady={handleReady}
      measureOverflow={measureOverflow}
      overflowMessage={overflowMessage}
    />
  )
}
