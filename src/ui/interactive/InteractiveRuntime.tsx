/**
 * A miniapp, running.
 *
 * Mounted over the slide's cover by `InteractiveSlideSurface` for exactly as
 * long as one activation lasts, and nowhere else. Everything the app needs to
 * be kept apart from Slaids is in the frame it is given — see
 * `sandboxDocument.ts` — and everything Slaids needs to keep apart from the
 * app is here:
 *
 *  - **the lock.** From the moment this mounts to the moment it unmounts, the
 *    navigation lock in `state/interactiveRuntime.ts` is held, and every key,
 *    click, wheel and swipe handler in the player and the editor stands down.
 *  - **the way out.** The «Avslutt miniapp» button is Slaids' own element,
 *    outside the frame, over it, and always reachable: a miniapp cannot cover
 *    it, and no key inside the frame can be relied on to reach Slaids, so
 *    the button is the one exit. It is drawn at screen size whatever the
 *    slide's scale, so it stays a comfortable target.
 *  - **the end.** Unmounting removes the frame element itself — never merely
 *    hides it — which is what stops the app's document and every timer in it.
 *    The next activation is a new frame with a fresh document.
 *
 * Focus goes into the frame on mount and again when it has loaded, and the
 * wrapper document passes it on to the app, so the keyboard reaches the app
 * without a click. Where it goes when the app is closed is the surface's
 * business: back to the button that started it.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useInteractiveRuntime } from '../../state/interactiveRuntime'
import type { InteractiveSlide } from '../../domain/types'
import {
  INTERACTIVE_PERMISSIONS_POLICY,
  INTERACTIVE_REFERRER_POLICY,
  INTERACTIVE_SANDBOX_FLAGS,
  buildInteractiveWrapperDocument,
} from './sandboxDocument'

export const EXIT_LABEL = 'Avslutt miniapp'

export function InteractiveRuntime({
  slide,
  scale,
  styleCss,
  onExit,
}: {
  slide: InteractiveSlide
  /** How the 1600 × 900 design space is scaled on screen, for the exit button. */
  scale: number
  /** The deck's design for this run — see `InteractiveSlideSurface`. */
  styleCss: string
  onExit: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const begin = useInteractiveRuntime((state) => state.begin)
  const end = useInteractiveRuntime((state) => state.end)

  // The lock lives exactly as long as the frame does.
  useEffect(() => {
    const token = begin(slide.id)
    return () => end(token)
  }, [begin, end, slide.id])

  // Built once per run: the same source in, the same document out, and a new
  // run is a new component (the surface keys it), so a fresh document too.
  const document = useMemo(
    () => buildInteractiveWrapperDocument({ html: slide.html, title: slide.name, styleCss }),
    [slide.html, slide.name, styleCss],
  )

  useEffect(() => {
    frameRef.current?.focus()
  }, [])

  // On screen the exit button is drawn at one size whatever the slide's scale:
  // the runtime sits inside the scaled design space, so the chrome undoes the
  // scale for itself.
  const chromeScale = scale > 0 ? 1 / scale : 1

  return (
    <div
      className="interactive-runtime"
      data-testid="interactive-runtime"
      data-slide-id={slide.id}
      // A click beside the frame is a click on nothing: it must not reach a
      // surface that turns pages on one.
      onClick={(event) => event.stopPropagation()}
    >
      <iframe
        ref={frameRef}
        className="interactive-runtime__frame"
        data-testid="interactive-frame"
        title={`Miniapp: ${slide.name}`}
        sandbox={INTERACTIVE_SANDBOX_FLAGS}
        referrerPolicy={INTERACTIVE_REFERRER_POLICY}
        allow={INTERACTIVE_PERMISSIONS_POLICY}
        srcDoc={document}
        onLoad={() => frameRef.current?.focus()}
      />
      <div
        className="interactive-runtime__chrome"
        style={{ transform: `scale(${chromeScale})`, transformOrigin: 'top right' }}
      >
        <button
          type="button"
          className="interactive-runtime__exit"
          data-testid="exit-interactive"
          onClick={(event) => {
            event.stopPropagation()
            onExit()
          }}
        >
          {EXIT_LABEL}
        </button>
      </div>
    </div>
  )
}
