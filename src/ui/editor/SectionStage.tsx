/**
 * A section slide, being edited.
 *
 * Same frame as the presented section — same pills, same type, same centring —
 * with a text editor in each pill instead of a static document. There are no
 * zones here, so there is no zone mode, no overlay and no hit-testing: the only
 * things to change are the two lines and the two colours, and the colours live
 * in the inspector beside the stage.
 *
 * Both pills are drawn while editing, even when the subheading is empty. That
 * empty pill *is* the placeholder: it is the only thing there is to click on
 * before a subheading exists, and when it is left empty it simply never
 * reaches the presented page — `SectionPageView` draws no pill for a line with
 * no text. So a section with a heading alone is centred as one line, and the
 * moment something is typed below it the pair is centred instead, with nothing
 * to switch on and nothing to remember.
 *
 * En linje for lang for pillen tas imot og settes i mindre skrift, som en
 * slidetittel (`ui/slide/titleFit.ts`), og pillen merkes så lenge den er det.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setSectionSubtitle, setSectionTitle } from '../../domain/commands'
import {
  SECTION_SUBTITLE_NODE_ID,
  SECTION_TITLE_NODE_ID,
  computeSectionGeometry,
} from '../../domain/geometry'
import { sectionGeometryForTheme } from '../../domain/metrics'
import type { Rect, RichDoc, SectionSlide } from '../../domain/types'
import { useEditorStore, type ActiveField } from '../../state/store'
import { useActiveEditor } from '../../state/activeEditor'
import {
  SectionFrame,
  SECTION_LINES,
  sectionLineDoc,
  type SectionLine,
} from '../slide/SectionPageView'
import { useSlideRender } from '../slide/SlideRenderContext'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { StageSurface } from './StageSurface'
import { canTypeIn, type StageTextEditing } from './stageFocus'
import type { StageZoom } from './stageView'
import { RichTextEditor } from './RichTextEditor'
import { ShrunkZoneMarker } from './ShrunkZoneMarker'
import type { MenuAnchor } from '../components/contextMenu'

const LINE_TEXT: Record<
  SectionLine,
  { placeholder: string; nodeId: string; field: 'section-title' | 'section-subtitle' }
> = {
  title: {
    placeholder: 'Overskrift',
    nodeId: SECTION_TITLE_NODE_ID,
    field: 'section-title',
  },
  subtitle: {
    placeholder: 'Underoverskrift (valgfri)',
    nodeId: SECTION_SUBTITLE_NODE_ID,
    field: 'section-subtitle',
  },
}

export function SectionStage({
  section,
  textEditing = 'all',
  focusRect = null,
  caret = null,
  onLongPressField,
  zoom,
  onZoomChange,
  onContextMenu,
}: {
  section: SectionSlide
  /**
   * Which of the two lines may be typed into where it is drawn.
   *
   * `all` on a roomy workspace. On a compact one neither is, until a long
   * press focuses one — a section has no zones to select, so its lines are
   * focused exactly the way a zone is and edited on the page like everything
   * else. They are measured against the pill either way.
   */
  textEditing?: StageTextEditing
  /** The line the view is focused on, as a rect of the page. See `StageSurface`. */
  focusRect?: Rect | null
  /** The line that should take the caret, or `null` to leave it to a tap. */
  caret?: ActiveField | null
  /** One finger that rested on the page, answered with the line under it. */
  onLongPressField?: (fieldId: string) => void
  /** The pinch, where the workspace offers one. See `StageSurface`. */
  zoom?: StageZoom
  onZoomChange?: (update: (current: StageZoom) => StageZoom) => void
  /**
   * A right-click on the page: the line it landed on, if any, and what was
   * under the pointer. Returns whether a menu was opened; when it was not, the
   * browser's own menu is left alone.
   */
  onContextMenu?: (fieldId: string | null, target: Element | null, anchor: MenuAnchor) => boolean
}) {
  const pillRefs = useRef<Partial<Record<SectionLine, HTMLElement | null>>>({})
  const run = useEditorStore((state) => state.run)
  const { theme } = useSlideRender()
  // Stable, so React does not detach and reattach the pill on every keystroke.
  const setPillRef = useCallback((line: SectionLine, element: HTMLElement | null) => {
    pillRefs.current[line] = element
  }, [])

  /** The kind of pointer that last pressed the page — see `handleContextMenu`. */
  const pointerTypeRef = useRef('mouse')

  /**
   * The menu for the page, about the line the pointer is on — the pill it is
   * drawn in, not the half of the page a finger would be given. A finger's
   * long press already opens a line, and the browser reports that same press as
   * a context menu too; there the press keeps its meaning.
   */
  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!onContextMenu) return
    if (onLongPressField && pointerTypeRef.current === 'touch') return
    const target = event.target instanceof Element ? event.target : null
    // The margin around the page is not the page: there the browser keeps its menu.
    if (!target?.closest('.stage-slide')) return
    const line = SECTION_LINES.find((each) => pillRefs.current[each]?.contains(target))
    const fieldId = line ? LINE_TEXT[line].nodeId : null
    if (onContextMenu(fieldId, target, { x: event.clientX, y: event.clientY })) event.preventDefault()
  }

  /**
   * Which line one resting finger asked for.
   *
   * Split at the midpoint between the two pills rather than tested against the
   * lines themselves: a pill is a few dozen slide units tall and a fingertip is
   * wider than that on the page, so testing the rects would leave most of the
   * screen answering nothing at all. Above the seam is the heading, below it the
   * subheading, and there is nowhere on the page that is neither.
   */
  const lineUnder = (point: { x: number; y: number }): SectionLine => {
    const geometry = computeSectionGeometry(sectionGeometryForTheme(theme))
    const seam = (geometry.titleRect.y + geometry.titleRect.height + geometry.subtitleRect.y) / 2
    return point.y < seam ? 'title' : 'subtitle'
  }

  return (
    <StageSurface
      kind="section"
      base={focusRect ?? undefined}
      zoom={zoom}
      onZoomChange={onZoomChange}
      onLongPress={
        onLongPressField
          ? (point) => onLongPressField(LINE_TEXT[lineUnder(point)].nodeId)
          : undefined
      }
      onPointerDown={(event) => {
        pointerTypeRef.current = event.pointerType
      }}
      onContextMenu={onContextMenu ? handleContextMenu : undefined}
    >
      {(scale) => (
        <>
          <SectionFrame
            accentColor={section.accentColor}
            backgroundColor={section.backgroundColor}
            lines={SECTION_LINES}
            pillRef={setPillRef}
            marker={(box) => <ShrunkZoneMarker stageScale={scale || 1} width={box.width} height={box.height} />}
            renderLine={(line) => (
              <SectionLineEditor
                section={section}
                line={line}
                editable={canTypeIn(textEditing, LINE_TEXT[line].nodeId)}
                takeCaret={caret?.nodeId === LINE_TEXT[line].nodeId}
                onChange={(doc) =>
                  run(`typing:section:${section.id}:${line}`, (presentation) =>
                    line === 'title'
                      ? setSectionTitle(presentation, section.id, doc)
                      : setSectionSubtitle(presentation, section.id, doc),
                  )
                }
              />
            )}
          >
            {/*
              The editor draws the page the audience will see, indicator and
              all. A section is a page in the flow like any other — the front
              page is the one that carries none, and `deckProgress` is what
              decides that, not this component.
            */}
            <SlideProgressBar pageId={section.id} />
          </SectionFrame>
        </>
      )}
    </StageSurface>
  )
}

/**
 * One of the section's two lines.
 *
 * Owns its own editor instance and publishes it as the active editor on
 * focus, exactly like a slide's other fields (`FieldEditor` in
 * `EditableZoneContent.tsx`) — a section carries no formatting or alignment
 * of its own, so the mark and align buttons still find nothing to act on
 * here, but it is still text somebody types, and the symbol picker needs
 * *some* editor to insert into. `onEditorReady` has to be a stable callback:
 * `RichTextEditor` re-fires it on every render where the reference changes,
 * so an inline closure here would null the active editor out on the very
 * next keystroke.
 */
function SectionLineEditor({
  section,
  line,
  editable,
  takeCaret,
  onChange,
}: {
  section: SectionSlide
  line: SectionLine
  editable: boolean
  /** Whether this is the line somebody named, rather than one they pressed. */
  takeCaret: boolean
  onChange: (doc: RichDoc) => void
}) {
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    return () => {
      // Never leave a destroyed editor behind as the toolbar's target.
      if (editorRef.current && useActiveEditor.getState().editor === editorRef.current) {
        setActiveEditor(null)
      }
    }
  }, [setActiveEditor])

  const handleReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])

  const handleFocus = useCallback(() => {
    setActiveEditor(editorRef.current)
    setActiveField({
      nodeId: LINE_TEXT[line].nodeId,
      subfieldId: null,
      kind: LINE_TEXT[line].field,
    })
  }, [line, setActiveEditor, setActiveField])

  return (
    <RichTextEditor
      // Keyed by the slide, so moving to another section replaces the editor
      // rather than reusing one still holding the old text.
      key={`${section.id}:${line}`}
      doc={sectionLineDoc(section, line)}
      variant="cover"
      editable={editable}
      takeCaret={takeCaret && editable}
      placeholder={LINE_TEXT[line].placeholder}
      onEditorReady={handleReady}
      onFocus={handleFocus}
      onChange={onChange}
    />
  )
}
