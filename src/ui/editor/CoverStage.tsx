/**
 * The cover, being edited.
 *
 * Same frame as the presented cover — same pills, same type, same centring —
 * with a text editor in each pill instead of a static document. There are no
 * zones here, so there is no zone mode, no overlay and no hit-testing: the only
 * things to change are the two lines and the colour, and the colour lives in
 * the inspector beside the stage.
 *
 * Over-long text is rolled back against the live DOM rather than measured by a
 * command, exactly as a slide title is: the pill clips at the width the
 * geometry engine handed the fit gate, so `scrollWidth - clientWidth` is the
 * same overflow that gate would compute — and reading it from the DOM is what
 * keeps an IME composition from being interrupted mid-word.
 */

import { useCallback, useRef } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { setCoverSubtitle, setCoverTitle } from '../../domain/commands'
import { COVER_SUBTITLE_NODE_ID, COVER_TITLE_NODE_ID } from '../../domain/geometry'
import type { DeckCover } from '../../domain/types'
import { useEditorStore } from '../../state/store'
import { useActiveEditor } from '../../state/activeEditor'
import { CoverFrame, COVER_LINES, coverLineDoc, type CoverLine } from '../slide/CoverPageView'
import { useFitScale } from '../slide/useFitScale'
import { RichTextEditor } from './RichTextEditor'

const LINE_TEXT: Record<CoverLine, { placeholder: string; overflow: string; nodeId: string }> = {
  title: {
    placeholder: 'Tittel',
    overflow: 'Tittelen får ikke plass på forsiden.',
    nodeId: COVER_TITLE_NODE_ID,
  },
  subtitle: {
    placeholder: 'Undertittel',
    overflow: 'Undertittelen får ikke plass på forsiden.',
    nodeId: COVER_SUBTITLE_NODE_ID,
  },
}

export function CoverStage({ cover }: { cover: DeckCover }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const pillRefs = useRef<Partial<Record<CoverLine, HTMLElement | null>>>({})
  const scale = useFitScale(viewportRef)
  const run = useEditorStore((state) => state.run)
  const setActiveField = useEditorStore((state) => state.setActiveField)
  const setActiveEditor = useActiveEditor((state) => state.setEditor)
  // Stable, so React does not detach and reattach the pill on every keystroke.
  const setPillRef = useCallback((line: CoverLine, element: HTMLElement | null) => {
    pillRefs.current[line] = element
  }, [])

  return (
    <div className="stage-viewport" ref={viewportRef} data-testid="stage-viewport">
      <div
        className="stage-scaler"
        style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
      >
        <div
          className="stage-slide"
          data-testid="stage-slide"
          data-cover=""
          data-scale={scale}
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <CoverFrame
            pillColor={cover.pillColor}
            // Both pills are always drawn while editing: an empty subtitle has
            // to be clickable before it can stop being empty.
            lines={COVER_LINES}
            pillRef={setPillRef}
            renderLine={(line) => (
              <RichTextEditor
                doc={coverLineDoc(cover, line)}
                variant="cover"
                placeholder={LINE_TEXT[line].placeholder}
                overflowMessage={LINE_TEXT[line].overflow}
                measureOverflow={() => {
                  const pill = pillRefs.current[line]
                  return pill ? Math.max(0, pill.scrollWidth - pill.clientWidth) : 0
                }}
                onFocus={() => {
                  // The cover carries no formatting, so nothing in the text
                  // toolbar applies to it — but the toolbar still has to stop
                  // pointing at the body field that was edited last.
                  setActiveEditor(null)
                  setActiveField({
                    nodeId: LINE_TEXT[line].nodeId,
                    subfieldId: null,
                    kind: line === 'title' ? 'cover-title' : 'cover-subtitle',
                  })
                }}
                onChange={(doc) =>
                  run(`typing:cover:${line}`, (presentation) =>
                    line === 'title'
                      ? setCoverTitle(presentation, doc)
                      : setCoverSubtitle(presentation, doc),
                  )
                }
              />
            )}
          />
        </div>
      </div>
    </div>
  )
}
