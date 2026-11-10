/**
 * Editable rendering of zone content.
 *
 * Uses the same frame as the static renderer, so what the user edits is exactly
 * what will be presented — and exactly what the fit measurement sees.
 *
 * None of these fields refuses text for lack of room. The zone is drawn inside
 * a `ZoneFitBox`, which draws whatever does not fit at normal size smaller
 * until it does, so a person typing on or pasting into a full zone gets the
 * text, smaller, rather than a refusal (IMPLEMENTATION_PLAN §17).
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setCardTitle, setImageCaption, setSubfieldDoc } from '../../domain/commands'
import { docEditRenumberProblem } from '../../state/citationFit'
import { isDocEmpty } from '../../domain/richdoc'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore, type ActiveField } from '../../state/store'
import { sameField } from './textTarget'
import type { ImageCaption, Rect, RichDoc, ZoneContent } from '../../domain/types'
import { ZoneContentFrame } from '../slide/ZoneContentFrame'
import { CaptionBox } from '../slide/ImagePanelView'
import { EditableImagePanel } from './EditableImagePanel'
import { RichTextEditor } from './RichTextEditor'
import { useSubfieldDrag } from './useSubfieldDrag'

export function EditableZoneContent({
  content,
  nodeId,
  slideId,
  editable = true,
  caret = null,
  rect = null,
  onPickImage,
}: {
  content: ZoneContent
  nodeId: string
  slideId: string
  /**
   * Sonens rektangel på sliden. Der måles den myke grensen når en delestrek
   * dras (`useSubfieldDrag`); uten den kan streken dras, men uten magnet.
   */
  rect?: Rect | null
  /**
   * Whether the fields may be typed into where they are drawn.
   *
   * False on a compact workspace, where a field is opened on a readable
   * surface instead. The same markup is still rendered — it is what the fit
   * measurement reads, and what the author is looking at — it simply is not a
   * writing surface at three pixels a line.
   */
  editable?: boolean
  /**
   * The one field in this zone that should take the caret, or `null`.
   *
   * A zone is several fields — a card's title, each body field, a caption — so
   * "open this zone" is not enough to say where the caret goes. Set only where
   * somebody named a field rather than pressed one; see `StageFocus`.
   */
  caret?: ActiveField | null
  /** Opens the upload dialog for a picture panel with no file in it yet. */
  onPickImage: (nodeId: string) => void
}) {
  const run = useEditorStore((state) => state.run)
  // Delestrekene kan dras der feltene kan skrives i; på et kompakt arbeidsområde
  // åpnes et felt på en lesbar flate i stedet, og streken er tre piksler tynn.
  const subfields = useSubfieldDrag({ content, nodeId, slideId, rect, enabled: editable })

  const renderCaption = (caption: ImageCaption) => (
    <CaptionBox caption={caption}>
      <CaptionEditor
        caption={caption}
        nodeId={nodeId}
        slideId={slideId}
        editable={editable}
        takeCaret={editable && sameField(caret, { nodeId, subfieldId: null, kind: 'caption' })}
      />
    </CaptionBox>
  )

  return (
    <div className="zone-host">
      <ZoneContentFrame
        content={subfields.content}
        renderDivider={subfields.renderDivider}
        renderTitle={(card) => (
          <FieldEditor
            doc={card.title}
            variant="title"
            placeholder="Korttittel"
            field={{ nodeId, subfieldId: null, kind: 'card-title' }}
            editable={editable}
            caret={caret}
            validateDoc={(next, previous) =>
              docEditRenumberProblem({
                slideId,
                nodeId,
                previousDoc: previous,
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
            editable={editable}
            caret={caret}
            validateDoc={(next, previous) =>
              docEditRenumberProblem({
                slideId,
                nodeId,
                previousDoc: previous,
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
        renderImage={(panel, variant) => (
          <EditableImagePanel
            panel={panel}
            variant={variant}
            slideId={slideId}
            nodeId={nodeId}
            renderCaption={renderCaption}
            onPickImage={() => onPickImage(nodeId)}
          />
        )}
      />
    </div>
  )
}

/**
 * The caption over a picture.
 *
 * Two rules that are not a text field's ordinary ones, and both follow from
 * "there is no such thing as an empty caption": a caption that has just been
 * created takes the caret so the user can start typing, and one that is left
 * empty removes itself when the caret goes elsewhere. Autofocusing *any* empty
 * caption is safe precisely because the second rule means an empty one can
 * only ever be a brand new one.
 */
function CaptionEditor({
  caption,
  nodeId,
  slideId,
  editable,
  takeCaret,
}: {
  caption: ImageCaption
  nodeId: string
  slideId: string
  editable: boolean
  takeCaret: boolean
}) {
  const run = useEditorStore((state) => state.run)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const selectNode = useEditorStore((state) => state.selectNode)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const editorRef = useRef<Editor | null>(null)
  /* The blur handler runs long after this render, so it reads the caption from
     a ref the render keeps up to date rather than from its own closure. */
  const docRef = useRef(caption.doc)
  useEffect(() => {
    docRef.current = caption.doc
  }, [caption.doc])

  useEffect(() => {
    return () => {
      if (editorRef.current && useActiveEditor.getState().editor === editorRef.current) {
        setActiveEditor(null)
      }
    }
  }, [setActiveEditor])

  return (
    <RichTextEditor
      doc={caption.doc}
      variant="caption"
      placeholder="Bildetekst"
      editable={editable}
      autoFocus={editable && isDocEmpty(caption.doc)}
      takeCaret={takeCaret}
      className="image-caption__text"
      onEditorReady={(editor) => {
        editorRef.current = editor
      }}
      onFocus={() => {
        setActiveEditor(editorRef.current)
        setActiveField({ nodeId, subfieldId: null, kind: 'caption' })
        selectNode(nodeId)
      }}
      onBlur={() => {
        if (!isDocEmpty(docRef.current)) return
        run('caption-remove', (presentation) =>
          setImageCaption(presentation, { slideId, nodeId, remove: true }),
        )
      }}
      validateDoc={(next, previous) =>
        // A caption may cite, and a citation's number comes from where it first
        // occurs in the whole deck — so an edit here can widen a label on a
        // slide nobody touched. The local measurement cannot see that.
        docEditRenumberProblem({
          slideId,
          nodeId,
          previousDoc: previous,
          nextDoc: next,
          commit: (presentation, doc) =>
            setImageCaption(presentation, { slideId, nodeId, doc }),
        })
      }
      onChange={(doc) =>
        run(`typing:${nodeId}:caption`, (presentation) =>
          setImageCaption(presentation, { slideId, nodeId, doc }),
        )
      }
    />
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
  editable,
  caret,
  onChange,
  validateDoc,
}: {
  doc: RichDoc
  variant: 'body' | 'title'
  placeholder?: string
  field: ActiveField
  editable: boolean
  /** The field that was asked for, which may or may not be this one. */
  caret: ActiveField | null
  onChange: (doc: RichDoc) => void
  validateDoc?: (doc: RichDoc, previous: RichDoc) => string | null
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
      editable={editable}
      takeCaret={editable && sameField(caret, field)}
      onChange={onChange}
      onFocus={handleFocus}
      onEditorReady={handleReady}
      validateDoc={validateDoc}
    />
  )
}
