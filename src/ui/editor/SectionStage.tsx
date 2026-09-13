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
 * Over-long text is rolled back against the live DOM rather than measured by a
 * command, exactly as a slide title is: the pill clips at the width the
 * geometry engine handed the fit gate, so `scrollWidth - clientWidth` is the
 * same overflow that gate would compute — and reading it from the DOM is what
 * keeps an IME composition from being interrupted mid-word.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'
import { setSectionSubtitle, setSectionTitle } from '../../domain/commands'
import { SECTION_SUBTITLE_NODE_ID, SECTION_TITLE_NODE_ID } from '../../domain/geometry'
import type { RichDoc, SectionSlide } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { useActiveEditor } from '../../state/activeEditor'
import {
  SectionFrame,
  SECTION_LINES,
  sectionLineDoc,
  type SectionLine,
} from '../slide/SectionPageView'
import { SlideProgressBar } from '../slide/SlideProgressBar'
import { StageSurface } from './StageSurface'
import type { StageZoom } from './stageView'
import { RichTextEditor } from './RichTextEditor'

const LINE_TEXT: Record<
  SectionLine,
  { placeholder: string; overflow: string; nodeId: string; field: 'section-title' | 'section-subtitle' }
> = {
  title: {
    placeholder: 'Overskrift',
    overflow: 'Overskriften får ikke plass på seksjonssliden.',
    nodeId: SECTION_TITLE_NODE_ID,
    field: 'section-title',
  },
  subtitle: {
    placeholder: 'Underoverskrift (valgfri)',
    overflow: 'Underoverskriften får ikke plass på seksjonssliden.',
    nodeId: SECTION_SUBTITLE_NODE_ID,
    field: 'section-subtitle',
  },
}

export function SectionStage({
  section,
  editable = true,
  zoom,
  onZoomChange,
}: {
  section: SectionSlide
  /**
   * Whether the two lines may be typed into where they are drawn.
   *
   * False on a compact workspace, for the reason a zone's fields are: a
   * heading scaled to a phone is not a writing surface. The lines are opened
   * from the text panel instead, and measured against the pill either way.
   */
  editable?: boolean
  /** The pinch, where the workspace offers one. See `StageSurface`. */
  zoom?: StageZoom
  onZoomChange?: (update: (current: StageZoom) => StageZoom) => void
}) {
  const pillRefs = useRef<Partial<Record<SectionLine, HTMLElement | null>>>({})
  const run = useEditorStore((state) => state.run)
  // Stable, so React does not detach and reattach the pill on every keystroke.
  const setPillRef = useCallback((line: SectionLine, element: HTMLElement | null) => {
    pillRefs.current[line] = element
  }, [])

  return (
    <StageSurface kind="section" zoom={zoom} onZoomChange={onZoomChange}>
      {() => (
        <>
          <SectionFrame
            accentColor={section.accentColor}
            backgroundColor={section.backgroundColor}
            lines={SECTION_LINES}
            pillRef={setPillRef}
            renderLine={(line) => (
              <SectionLineEditor
                section={section}
                line={line}
                editable={editable}
                measureOverflow={() => {
                  const pill = pillRefs.current[line]
                  return pill ? Math.max(0, pill.scrollWidth - pill.clientWidth) : 0
                }}
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
  measureOverflow,
  onChange,
}: {
  section: SectionSlide
  line: SectionLine
  editable: boolean
  measureOverflow: () => number
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
      placeholder={LINE_TEXT[line].placeholder}
      overflowMessage={LINE_TEXT[line].overflow}
      measureOverflow={measureOverflow}
      onEditorReady={handleReady}
      onFocus={handleFocus}
      onChange={onChange}
    />
  )
}
