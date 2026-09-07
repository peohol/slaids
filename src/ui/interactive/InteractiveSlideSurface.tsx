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
 * The longest a press on «Aktiver miniapp» waits for the theme's faces.
 *
 * Short, because it is only ever reached when somebody pressed play in the
 * moment between the cover appearing and the fetch finishing. Past it the app
 * starts in the fallback stack, which is what a deck set in a local font gets
 * anyway.
 */
const FONT_WAIT_MS = 1500

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

/**
 * The theme's faces, and the pair of font roles they belong to.
 *
 * The key is not bookkeeping. A deck's font can be changed while one of its
 * covers is on screen, and for as long as the new family takes to arrive, the
 * faces in hand are the *previous* theme's. Answering a press with them would
 * build a document whose variables name one family and whose `@font-face`
 * rules carry another — and the sandbox cannot fetch the difference, so the
 * app would fall back while the slide beside it did not. Keyed, they are
 * simply not an answer to the question being asked.
 */
interface Faces {
  key: string
  css: string
}

/** The same, for a request that has not answered yet. */
interface FaceRequest {
  key: string
  pending: Promise<string>
}

/**
 * The two font roles as one value. A newline separates them because no font
 * stack contains one.
 */
function fontKeyOf(headingFont: string, bodyFont: string): string {
  return `${headingFont}\n${bodyFont}`
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
   * The theme's faces, as bytes: the request, and its answer once it has one.
   *
   * Asked for when a cover that *could* be started appears rather than when
   * one is, so the fetch — normally a hit in the browser's own cache, since
   * the page loaded the same family — is long finished before anybody presses
   * play. But «normally» is not a rule, and a run that started a moment too
   * early would be drawn in the fallback face while the deck around it is not:
   * a race, not a failure, and the one thing the whole font path exists to
   * prevent. So both are kept *with the pair they belong to*, and activation
   * waits for the pair the deck is set in now — see `activate`.
   */
  const fontRequest = useRef<FaceRequest | null>(null)
  const [faces, setFaces] = useState<Faces | null>(null)
  const sessions = useRef(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  // A different file is a different app: whatever was running is not it, and
  // the runtime below unmounts on the very render that changed the slide.
  const live = isLive(session, slide) ? session : null

  const headingFont = theme.headingFontFamily
  const bodyFont = theme.bodyFontFamily
  const fontKey = fontKeyOf(headingFont, bodyFont)

  /**
   * The request for the pair the deck is set in *now*, made once.
   *
   * Both the effect below and a press go through here, and both get the same
   * promise, because it is remembered with its key. That is what closes the
   * window between a theme change and the effect that reacts to it: in it,
   * the remembered request is the previous theme's, its key says so, and a
   * press asks for the right one instead of waiting on the wrong one.
   *
   * Asking twice for the same family costs nothing — `inlineFaces.ts` caches
   * per family, so the second caller awaits the first one's fetch.
   */
  const requestFaces = useCallback((): Promise<string> => {
    const held = fontRequest.current
    if (held?.key === fontKey) return held.pending
    const pending = interactiveFontCss([headingFont, bodyFont])
    fontRequest.current = { key: fontKey, pending }
    void pending.then((css) => {
      // A slower answer for a pair the deck has since left is not an answer.
      if (fontRequest.current?.key === fontKey) setFaces({ key: fontKey, css })
    })
    return pending
  }, [fontKey, headingFont, bodyFont])

  // When a cover that could be started appears, and again whenever the deck's
  // type changes under it.
  useEffect(() => {
    void requestFaces()
  }, [requestFaces])

  const start = useCallback(
    (faces: string) => {
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
            fontCss: faces,
          }),
        }
      })
    },
    [slide, theme, colors],
  )

  /**
   * Start the app, in the deck's real type.
   *
   * Immediately when the faces for *this* pair of roles are in hand, which is
   * the ordinary case — they were asked for when this cover appeared. Faces
   * for a pair the deck has left do not count, and are the reason the answer
   * is keyed at all: after somebody changes the deck's font, the previous
   * theme's faces are still in hand for as long as the new ones take to
   * arrive, and starting on them would build a document whose variables name
   * one family and whose `@font-face` rules carry another — with a frame that
   * cannot go and fetch the difference.
   *
   * Otherwise the press waits for the request rather than starting a run that
   * would be drawn in the fallback face: the frame cannot fetch a font itself,
   * so a run that began without them keeps the wrong type for as long as it
   * lasts.
   *
   * The wait is bounded twice over — the request has its own deadline, and
   * this will not hold a press longer than `FONT_WAIT_MS` whatever the
   * network is doing. A real failure still starts the app; it is the *race*
   * this closes, not the failure, which the fallback stack already handles.
   */
  const activate = useCallback(() => {
    if (faces?.key === fontKey) {
      start(faces.css)
      return
    }
    void Promise.race([
      requestFaces(),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), FONT_WAIT_MS)),
    ]).then(start)
  }, [faces, fontKey, requestFaces, start])

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
