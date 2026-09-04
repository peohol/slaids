/**
 * Editable rendering of zone content.
 *
 * Uses the same frame as the static renderer, so what the user edits is exactly
 * what will be presented — and exactly what the fit measurement sees.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setCardTitle, setSubfieldDoc } from '../../domain/commands'
import { measureElementOverflow } from '../../state/measure'
import { docEditRenumberProblem } from '../../state/citationFit'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore, type ActiveField } from '../../state/store'
import type { RichDoc, ZoneContent } from '../../domain/types'
import { ZoneContentFrame } from '../slide/ZoneContentFrame'
import { AssetImage } from '../slide/AssetImage'
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

  const measureOverflow = useCallback(
    () => (hostRef.current ? measureElementOverflow(hostRef.current) : 0),
    [],
  )

  return (
    <div className="zone-host" ref={hostRef}>
      <ZoneContentFrame
        content={content}
        renderTitle={(card) => (
          <FieldEditor
            doc={card.title}
            variant="title"
            placeholder="Korttittel"
            field={{ nodeId, subfieldId: null, kind: 'card-title' }}
            measureOverflow={measureOverflow}
            overflowMessage="Tittelen får ikke plass i kortet."
            validateDoc={(next) =>
              docEditRenumberProblem({
                nodeId,
                currentDoc: card.title,
                nextDoc: next,
                commit: (presentation, doc) => setCardTitle(presentation, { slideId, nodeId, doc }),
              })
            }
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
            placeholder="Skriv innhold …"
            field={{ nodeId, subfieldId: field.id, kind: 'body' }}
            measureOverflow={measureOverflow}
            validateDoc={(next) =>
              docEditRenumberProblem({
                nodeId,
                currentDoc: field.doc,
                nextDoc: next,
                commit: (presentation, doc) =>
                  setSubfieldDoc(presentation, { slideId, nodeId, subfieldId: field.id, doc }),
              })
            }
            onChange={(doc) =>
              run(`typing:${nodeId}:${field.id}`, (presentation) =>
                setSubfieldDoc(presentation, { slideId, nodeId, subfieldId: field.id, doc }),
              )
            }
          />
        )}
        renderAsset={(payload) => (
          <AssetImage assetId={payload.assetId} fit={payload.fit} rounded={payload.rounded} />
        )}
      />
    </div>
  )
}

/**
 * A single editable field.
 *
 * Each field owns its own editor instance and publishes it as the active editor
 * when it takes focus, so the toolbars always act on the field the user is in.
 */
function FieldEditor({
  doc,
  variant,
  placeholder,
  field,
  onChange,
  measureOverflow,
  overflowMessage,
  validateDoc,
}: {
  doc: RichDoc
  variant: 'body' | 'title'
  placeholder?: string
  field: ActiveField
  onChange: (doc: RichDoc) => void
  measureOverflow: () => number
  overflowMessage?: string
  validateDoc?: (doc: RichDoc) => string | null
}) {
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const selectNode = useEditorStore((state) => state.selectNode)
  const editorRef = useRef<Editor | null>(null)
  const { nodeId, subfieldId, kind } = field

  useEffect(() => {
    return () => {
      // Never leave a destroyed editor behind as the toolbar's target.
      if (editorRef.current && useActiveEditor.getState().editor === editorRef.current) {
        setActiveEditor(null)
      }
    }
  }, [setActiveEditor])

  const handleFocus = useCallback(() => {
    setActiveEditor(editorRef.current)
    setActiveField({ nodeId, subfieldId, kind })
    // The zone panel follows what is being edited. Without this it kept showing
    // whichever zone was last selected in zone mode, so the split, colour and
    // subfield controls applied to a zone the user was not looking at.
    selectNode(nodeId)
  }, [kind, nodeId, selectNode, setActiveEditor, setActiveField, subfieldId])

  const handleReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

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
      validateDoc={validateDoc}
    />
  )
}
