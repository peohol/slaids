/**
 * The deck, playing.
 *
 * One component behind both ways of watching a presentation:
 *
 *   PresentationPlayer
 *   ├─ PresentView            (local, in the editor: can be left with Esc)
 *   └─ SharedPresentationView (public, at /s/<token>: nothing to leave to)
 *
 * There is no second renderer and no second geometry. The pages come from
 * `deckPages`, which is the same list in both cases, and each page is drawn by
 * `DeckPageView` — so a shared deck cannot drift from the one its author sees.
 *
 * The public variant differs by what it is *not* given: no `onExit`, and it is
 * mounted with nothing else around it. Editor chrome is not hidden here, it is
 * simply somewhere this component has never known about.
 *
 * The page itself is the whole screen: no counter, no exit button, nothing
 * drawn over the slide. How far through the deck the audience is, is what the
 * progress indicator says; leaving is Escape, and only where there is somewhere
 * to leave to — the shared view passes no `onExit`, so the key does nothing
 * there.
 *
 * An interactive slide is the one page that can do more than be looked at.
 * Its cover is drawn like any page; what the player adds is the surface that
 * may start the app — and, while one runs, a lock every handler here checks
 * first. Keys, clicks and swipes belong to the app then, including Escape:
 * the way out of a running app is its own exit button, never a key the app
 * might have been using.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../../domain/constants'
import { deckPages, deckProgress, deckSectionColors, type DeckPage } from '../../domain/pages'
import { computeReferenceNumbering } from '../../domain/references'
import type { DeckSource } from '../../domain/types'
import { isInteractiveRuntimeActive } from '../../state/interactiveRuntime'
import { InteractiveSlideSurface } from '../interactive/InteractiveSlideSurface'
import { SlideRenderProvider } from '../slide/SlideRenderContext'
import { DeckPageView } from '../slide/DeckPageView'
import { useFitScale } from '../slide/useFitScale'
import { ensureWebFonts } from '../fonts'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { Icon } from '../components/Icon'

/** Shorter than this is a tap, not a swipe. */
const SWIPE_THRESHOLD_PX = 48

/** How long the touch controls stay up before they get out of the way. */
const CONTROLS_HIDE_MS = 4000

/**
 * Things a press belongs to rather than to the deck.
 *
 * Links and buttons inside a page are the page's; the player's own controls
 * are the player's; and a running miniapp owns everything inside its frame.
 * Everything else is the slide, and a press on the slide is a page turn or a
 * request for the controls, depending on what is doing the pressing.
 */
const OWNS_ITS_PRESS = 'a, button, [role="button"], .interactive-runtime, .present-controls'

/**
 * Whether the press that just ended was somebody selecting text inside `host`.
 *
 * A slide's text is ordinary selectable text — an audience copies a quotation
 * out of a deck, and a presenter highlights a line while talking. The mouse-up
 * that finishes the drag arrives here as a click, and turning the page on it
 * would take the selection away in the same motion that made it.
 *
 * A plain click collapses whatever was selected before the event is dispatched,
 * so an ordinary press through text still turns the page; only a press that
 * *leaves something selected* is one that meant to select.
 */
function endedASelection(host: HTMLElement | null): boolean {
  const selection = window.getSelection()
  if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0) return false
  if (selection.toString().trim() === '') return false
  return host.contains(selection.anchorNode)
}

/**
 * One page, and the one kind of page that may do more than be drawn.
 *
 * Keyed by the page, so turning to another slide unmounts the surface — and
 * with it any app that was running, which is the only way a page turn can
 * happen while one runs: not from here, but from the deck changing underneath.
 */
function PlayerPage({ page, scale }: { page: DeckPage; scale: number }) {
  if (page.kind === 'authored-slide' && page.slide.kind === 'interactive') {
    return (
      <InteractiveSlideSurface key={page.id} slide={page.slide} scale={scale}>
        <DeckPageView page={page} />
      </InteractiveSlideSurface>
    )
  }
  return <DeckPageView page={page} />
}

export interface PresentationPlayerProps {
  deck: DeckSource
  /** The share link, when sharing is on: what the derived QR page points at. */
  shareUrl?: string | null
  startIndex?: number
  /**
   * `null` in the public view: there is nowhere to go back to. Called with the
   * id of the last authored slide the audience was shown, so the editor can
   * return to exactly that slide rather than wherever it was before presenting.
   */
  onExit?: ((lastSlideId: string) => void) | null
}

export function PresentationPlayer({
  deck,
  shareUrl = null,
  startIndex = 0,
  onExit = null,
}: PresentationPlayerProps) {
  const pages = useMemo(() => deckPages(deck, { shareUrl }), [deck, shareUrl])
  const progress = useMemo(() => deckProgress(pages), [pages])
  const sectionColors = useMemo(() => deckSectionColors(pages), [pages])
  const numbering = useMemo(() => computeReferenceNumbering(deck), [deck])
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), pages.length - 1))
  const hostRef = useRef<HTMLDivElement>(null)
  const scale = useFitScale(hostRef, 1)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const workspace = useWorkspace()
  /*
   * Two questions, and they have different answers.
   *
   * **Are the controls drawn?** On a small surface, yes. With a finger there
   * are no keys at all, and in a narrow window the audience is as likely to be
   * looking for a way out as for a way forward — so a way forward, a way back
   * and a way out are on screen. On a roomy desktop nothing is drawn over the
   * slide, which is the presentation Slaids has always given.
   *
   * **Does a press on the slide mean "show me the controls"?** Only with a
   * finger. A click is the fastest way through a deck and always has been, and
   * a mouse in a small window is still a mouse: taking its click away to
   * toggle a bar it can already see would be answering the first question with
   * the second one's answer.
   */
  const controlsDrawn = workspace.compact || workspace.coarse
  const pressRevealsControls = workspace.coarse
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideAt = useRef(0)

  useEffect(() => {
    void ensureWebFonts([deck.theme.headingFontFamily, deck.theme.bodyFontFamily])
  }, [deck.theme.headingFontFamily, deck.theme.bodyFontFamily])

  // A page can disappear under the viewer: the reference slides are recomputed
  // on every edit, and the QR page goes when sharing is turned off.
  const lastIndex = Math.max(0, pages.length - 1)
  const current = Math.min(index, lastIndex)
  // Only authored slides exist in `presentation.slides` for the editor to
  // return to — a derived page (a reference slide, the QR page) has no slide
  // of its own, so leaving from one of those hands back the last authored
  // slide before it, which is always the deck's last one: authored slides are
  // exactly the pages before the derived ones.
  const lastAuthoredSlideId = deck.slides[Math.min(current, deck.slides.length - 1)].id

  const go = useCallback(
    (delta: number) => {
      setIndex((at) => Math.max(0, Math.min(lastIndex, Math.min(at, lastIndex) + delta)))
    },
    [lastIndex],
  )

  /** Put the controls up, and start the clock that takes them down again. */
  const showControls = useCallback(() => {
    setControlsVisible(true)
    hideAt.current = Date.now() + CONTROLS_HIDE_MS
  }, [])

  /*
   * The controls get out of the way by themselves, and a press brings them
   * back — which is why only a surface that *has* that press hides them. With
   * a mouse the press is a page turn, so there would be nothing to bring them
   * back with, and hiding them would simply lose them.
   *
   * One timer polling a deadline rather than a timeout restarted on every
   * press: a press during the countdown only moves the deadline, so nothing is
   * cleared, rescheduled or left dangling.
   */
  useEffect(() => {
    if (!pressRevealsControls) return
    hideAt.current = Date.now() + CONTROLS_HIDE_MS
    const timer = window.setInterval(() => {
      if (hideAt.current !== 0 && Date.now() >= hideAt.current) setControlsVisible(false)
    }, 500)
    return () => window.clearInterval(timer)
  }, [pressRevealsControls])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A running miniapp owns the keyboard. Not prevented either: a key that
      // reaches here while the app runs is one pressed on Slaids' own exit
      // button, and Space or Enter there has to stay a press on that button.
      if (isInteractiveRuntimeActive()) return
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          event.preventDefault()
          go(1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          event.preventDefault()
          go(-1)
          break
        case 'Home':
          event.preventDefault()
          setIndex(0)
          break
        case 'End':
          event.preventDefault()
          setIndex(lastIndex)
          break
        case 'Escape':
          if (!onExit) return
          event.preventDefault()
          onExit(lastAuthoredSlideId)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, lastIndex, onExit, lastAuthoredSlideId])

  const page = pages[current]

  return (
    <div
      className="present"
      data-testid="present-view"
      // Where in the deck the audience is, without drawing it: the progress
      // indicator is what says that on screen now. Kept as data so a test can
      // still follow a page turn without a counter having to exist for it.
      data-page={current + 1}
      data-page-count={pages.length}
      ref={hostRef}
      onClick={(event) => {
        if (isInteractiveRuntimeActive()) return
        // Links and buttons inside a page (reference URLs, rich-text links)
        // must not also advance the deck.
        if ((event.target as Element).closest(OWNS_ITS_PRESS)) return
        // Text somebody has just highlighted is not a request for the next page.
        if (endedASelection(hostRef.current)) return
        /*
         * A press on empty space means different things to different hands.
         * With a mouse it is the fastest way through a deck and always has
         * been. With a finger it is just as likely to be somebody steadying
         * the phone, and the deck jumping a page for it is a nuisance — so
         * there it asks for the controls instead, and the controls turn the
         * page.
         */
        if (pressRevealsControls) {
          if (controlsVisible) setControlsVisible(false)
          else showControls()
          return
        }
        go(1)
      }}
      onTouchStart={(event) => {
        if (isInteractiveRuntimeActive()) return
        const touch = event.touches[0]
        // A swipe that starts on a link, a button or a running app is that
        // element's gesture, never a page turn.
        const from = event.target instanceof Element ? event.target.closest(OWNS_ITS_PRESS) : null
        touchStart.current = touch && !from ? { x: touch.clientX, y: touch.clientY } : null
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current
        touchStart.current = null
        if (isInteractiveRuntimeActive()) return
        const touch = event.changedTouches[0]
        if (!start || !touch) return
        const dx = touch.clientX - start.x
        // A mostly-vertical drag is a scroll gesture, not a page turn.
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
        if (Math.abs(dx) < Math.abs(touch.clientY - start.y)) return
        go(dx < 0 ? 1 : -1)
      }}
    >
      <SlideRenderProvider
        value={{
          theme: deck.theme,
          numbering,
          sectionColors,
          progress,
          isStatic: true,
        }}
      >
        <div
          className="present__slide"
          style={{ width: SLIDE_WIDTH * scale, height: SLIDE_HEIGHT * scale }}
        >
          <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {page && <PlayerPage page={page} scale={scale} />}
          </div>
        </div>
      </SlideRenderProvider>

      {controlsDrawn && (
        <div
          className="present-controls"
          data-testid="present-controls"
          data-visible={controlsVisible ? '' : undefined}
          // The controls are their own surface: pressing one must not also be
          // a press on the slide underneath it.
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="present-controls__btn"
            data-testid="present-prev"
            aria-label="Forrige side"
            disabled={current === 0}
            onClick={() => {
              go(-1)
              showControls()
            }}
          >
            <Icon name="chevron-left" size={22} />
          </button>
          <span className="present-controls__count" data-testid="present-counter">
            {current + 1} / {pages.length}
          </span>
          <button
            type="button"
            className="present-controls__btn"
            data-testid="present-next"
            aria-label="Neste side"
            disabled={current === lastIndex}
            onClick={() => {
              go(1)
              showControls()
            }}
          >
            <Icon name="chevron-right" size={22} />
          </button>
          {onExit && (
            <button
              type="button"
              className="present-controls__btn present-controls__btn--exit"
              data-testid="present-exit"
              onClick={() => onExit(lastAuthoredSlideId)}
            >
              <Icon name="close" size={20} /> Avslutt
            </button>
          )}
        </div>
      )}
    </div>
  )
}
