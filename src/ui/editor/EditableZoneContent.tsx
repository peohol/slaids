/**
 * Editable rendering of zone content.
 *
 * Uses the same frame as the static renderer, so what the user edits is exactly
 * what will be presented — and exactly what the fit measurement sees.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setCardTitle, setImageCaption, setSubfieldDoc } from '../../domain/commands'
import { measureOverflowParts } from '../../state/measure'
import { CAPTION_PART, CARD_TITLE_PART, subfieldPart } from '../../domain/fit'
import { docEditRenumberProblem } from '../../state/citationFit'
import { isDocEmpty } from '../../domain/richdoc'
import { useActiveEditor } from '../../state/activeEditor'
import { useEditorStore, type ActiveField } from '../../state/store'
import { sameField } from './textTarget'
import type { ImageCaption, RichDoc, ZoneContent } from '../../domain/types'
import { ZoneContentFrame } from '../slide/ZoneContentFrame'
import { CaptionBox } from '../slide/ImagePanelView'
import { useAtNormalSize } from '../slide/ZoneFitBox'
import { EditableImagePanel } from './EditableImagePanel'
import { RichTextEditor } from './RichTextEditor'

export function EditableZoneContent({
  content,
  nodeId,
  slideId,
  editable = true,
  caret = null,
  onPickImage,
}: {
  content: ZoneContent
  nodeId: string
  slideId: string
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
  const hostRef = useRef<HTMLDivElement>(null)
  const run = useEditorStore((state) => state.run)
  const atNormalSize = useAtNormalSize()

  /**
   * How much *this* region of the zone overflows, not the zone as a whole.
   *
   * A zone is several places that can clip — a card's header, each field of its
   * body, the caption over a picture — and an editor that measured all of them
   * together could not tell «my field got worse» from «the field next to me was
   * already worse». That is the hole a card title grew through: the body was
   * over its box, so the zone's worst number never moved while the title ran
   * out of its header. Each editor asks about its own part, which is the same
   * unit the domain's fit guard compares. See `FitParts`.
   */
  const measurePart = useCallback(
    (part: string) =>
      // At normal size, even while the zone is drawn smaller: a zone a person
      // shrank below what its text needs has still not been given room for
      // more of it, and the scaled drawing would say it had.
      atNormalSize(() => (hostRef.current ? (measureOverflowParts(hostRef.current)[part] ?? 0) : 0)),
    [atNormalSize],
  )

  const renderCaption = (caption: ImageCaption) => (
    <CaptionBox caption={caption}>
      <CaptionEditor
        caption={caption}
        nodeId={nodeId}
        slideId={slideId}
        editable={editable}
        takeCaret={editable && sameField(caret, { nodeId, subfieldId: null, kind: 'caption' })}
        measureOverflow={() => measurePart(CAPTION_PART)}
      />
    </CaptionBox>
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
            editable={editable}
            caret={caret}
            measureOverflow={() => measurePart(CARD_TITLE_PART)}
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
            editable={editable}
            caret={caret}
            measureOverflow={() => measurePart(subfieldPart(field.id))}
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
  measureOverflow,
}: {
  caption: ImageCaption
  nodeId: string
  slideId: string
  editable: boolean
  takeCaret: boolean
  measureOverflow: () => number
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
      measureOverflow={measureOverflow}
      overflowMessage="Bildeteksten får ikke plass i bildet."
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
      validateDoc={(next) =>
        // A caption may cite, and a citation's number comes from where it first
        // occurs in the whole deck — so an edit here can widen a label on a
        // slide nobody touched. The local measurement cannot see that.
        docEditRenumberProblem({
          nodeId,
          currentDoc: caption.doc,
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
  measureOverflow,
  overflowMessage,
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
      editable={editable}
      takeCaret={editable && sameField(caret, field)}
      onChange={onChange}
      onFocus={handleFocus}
      onEditorReady={handleReady}
      measureOverflow={measureOverflow}
      overflowMessage={overflowMessage}
      validateDoc={validateDoc}
    />
  )
}
