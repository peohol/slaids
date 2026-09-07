/**
 * The one place a miniapp may be started.
 *
 * Wraps a drawn page — the cover, from `DeckPageView` — and hands it the
 * activation the cover's button needs. While an app runs, the runtime is
 * mounted over the cover; when it is closed, the runtime is unmounted and the
 * cover is exactly as it was, with focus back on its button.
 *
 * Two surfaces mount this: presentation mode (and with it the shared view,
 * which is the same player) and the editor's stage for an interactive slide.
 * Thumbnails, the read-only stage and the rendered preview never do, and a
 * cover drawn without it cannot start anything.
 *
 * Each activation is a new session, keyed so React builds a new runtime and
 * with it a new frame: the app starts over every time, and no state of a
 * previous run survives — none is kept anywhere. A session also ends on its
 * own when the slide it belongs to changes underneath it (a replaced file,
 * an undo), so a running app is always the app the slide holds.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import type { InteractiveSlide } from '../../domain/types'
import { useSectionColorsFor, useSlideRender } from '../slide/SlideRenderContext'
import { interactiveDocumentStyle, interactiveFontCss } from './documentStyle'
import {
  ACTIVATE_BUTTON_ATTRIBUTE,
  InteractiveActivationProvider,
  type InteractiveActivation,
} from './InteractiveActivation'
import { InteractiveRuntime } from './InteractiveRuntime'

/**
 * One activation: which run it is, and *what* was running.
 *
 * The slide and the source are remembered with the token so that "is this
 * session still the slide's" is derived on every render rather than
 * synchronised by an effect: a replaced file or an undo makes the remembered
 * source differ from the slide's, and the session is simply no longer live.
 */
interface Session {
  token: number
  slideId: string
  html: string
  /**
   * The deck's design as CSS, as it was when this run began.
   *
   * Captured with the run rather than read as it changes, so a font that
   * finishes downloading — or a section somebody recolours in the filmstrip —
   * cannot rebuild the document under a running app and restart it. The next
   * activation picks up both.
   */
  styleCss: string
}

function isLive(session: Session | null, slide: InteractiveSlide): session is Session {
  return session !== null && session.slideId === slide.id && session.html === slide.html
}

export function InteractiveSlideSurface({
  slide,
  scale,
  children,
}: {
  slide: InteractiveSlide
  /** How the design space is scaled on screen; the runtime's chrome needs it. */
  scale: number
  /** The cover, drawn by whoever draws pages. */
  children: ReactNode
}) {
  const { theme } = useSlideRender()
  // The colours this slide is actually drawn in: the governing section's, so a
  // miniapp follows the part of the deck it sits in.
  const colors = useSectionColorsFor(slide.id)
  const [session, setSession] = useState<Session | null>(null)
  /**
   * The theme's faces, as bytes.
   *
   * Asked for when a cover that *could* be started appears rather than when
   * one is, so the fetch — normally a hit in the browser's own cache, since
   * the page loaded the same family — is long finished before anybody presses
   * play. Empty until then, and empty forever if it fails: see
   * `interactiveFontCss`.
   */
  const [fontCss, setFontCss] = useState('')
  const sessions = useRef(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  // A different file is a different app: whatever was running is not it, and
  // the runtime below unmounts on the very render that changed the slide.
  const live = isLive(session, slide) ? session : null

  const headingFont = theme.headingFontFamily
  const bodyFont = theme.bodyFontFamily
  useEffect(() => {
    let cancelled = false
    void interactiveFontCss([headingFont, bodyFont]).then((css) => {
      if (!cancelled) setFontCss(css)
    })
    return () => {
      cancelled = true
    }
  }, [headingFont, bodyFont])

  const activate = useCallback(() => {
    setSession((current) => {
      if (isLive(current, slide)) return current
      sessions.current += 1
      return {
        token: sessions.current,
        slideId: slide.id,
        html: slide.html,
        styleCss: interactiveDocumentStyle({
          theme,
          colors,
          contract: slide.styleContract,
          fontCss,
        }),
      }
    })
  }, [slide, theme, colors, fontCss])

  const exit = useCallback(() => {
    restoreFocus.current = true
    setSession(null)
  }, [])

  // Focus goes back where it came from once the runtime is gone — after the
  // render that removed it, so the button found is the live one on screen.
  const running = live !== null
  useEffect(() => {
    if (running || !restoreFocus.current) return
    restoreFocus.current = false
    hostRef.current?.querySelector<HTMLButtonElement>(`[${ACTIVATE_BUTTON_ATTRIBUTE}]`)?.focus()
  }, [running])

  const activation = useMemo<InteractiveActivation>(() => ({ activate }), [activate])

  return (
    <InteractiveActivationProvider value={activation}>
      <div
        ref={hostRef}
        className="interactive-surface"
        data-testid="interactive-surface"
        data-active={running ? '' : undefined}
        style={{ position: 'relative', width: SLIDE_WIDTH, height: SLIDE_HEIGHT }}
      >
        {children}
        {live && (
          <InteractiveRuntime
            key={live.token}
            slide={slide}
            scale={scale}
            styleCss={live.styleCss}
            onExit={exit}
          />
        )}
      </div>
    </InteractiveActivationProvider>
  )
}
