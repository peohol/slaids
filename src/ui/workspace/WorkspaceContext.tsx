/**
 * The one place the browser is asked how much room there is.
 *
 * Every component that has to know reads it from here, and the same value is
 * published onto `<html>` as data attributes and custom properties so the
 * stylesheets key off exactly the same decision the React tree does. That is
 * the point of doing it here rather than in a media query per stylesheet:
 * a breakpoint written twice is a breakpoint that will disagree with itself.
 *
 * Nothing about this is persisted, and nothing about it reaches the document.
 * The size of a window is not a fact about a presentation.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DESKTOP_WORKSPACE, deriveWorkspace, type Workspace, type WorkspaceMetrics } from './workspace'

const WorkspaceContext = createContext<Workspace>(DESKTOP_WORKSPACE)

/** What the surface is right now. Never a guess about the device. */
export function useWorkspace(): Workspace {
  return useContext(WorkspaceContext)
}

const COARSE_QUERY = '(pointer: coarse)'

function readMetrics(): WorkspaceMetrics {
  const visual = window.visualViewport
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    // A browser without `visualViewport` simply never reports an inset, which
    // is the honest answer: it has no way to know one.
    visibleTop: visual ? visual.offsetTop : 0,
    visibleHeight: visual ? visual.height : window.innerHeight,
    coarse: window.matchMedia?.(COARSE_QUERY).matches ?? false,
  }
}

/** Two workspaces are the same when every field a layout reads is the same. */
function same(a: Workspace, b: Workspace): boolean {
  return (
    a.compact === b.compact &&
    a.coarse === b.coarse &&
    a.orientation === b.orientation &&
    a.keyboardOpen === b.keyboardOpen &&
    a.width === b.width &&
    a.height === b.height &&
    a.keyboardInset === b.keyboardInset &&
    a.visibleTop === b.visibleTop &&
    a.visibleBottomGap === b.visibleBottomGap
  )
}

/**
 * Publish the workspace to the stylesheets.
 *
 * The attributes are what CSS selects on. The three lengths describe the band
 * of the page that is actually on screen — where it starts, how tall it is, and
 * how far its bottom sits above the bottom of the layout viewport.
 *
 * All three are needed because `position: fixed` is laid out against the
 * *layout* viewport: a keyboard shrinks what can be seen without moving what a
 * fixed box is anchored to, so a dialog centred on the layout viewport puts its
 * footer behind the keyboard, and a sheet pinned to `bottom: 0` disappears
 * under it entirely. Anything that has to stay reachable is anchored to the
 * band instead.
 */
function publish(workspace: Workspace): void {
  const root = document.documentElement
  root.dataset.compact = workspace.compact ? 'true' : 'false'
  root.dataset.coarse = workspace.coarse ? 'true' : 'false'
  root.dataset.orientation = workspace.orientation
  root.dataset.keyboard = workspace.keyboardOpen ? 'open' : 'closed'
  root.style.setProperty('--slaids-visible-top', `${Math.round(workspace.visibleTop)}px`)
  root.style.setProperty('--slaids-visible-height', `${Math.round(workspace.visibleHeight)}px`)
  root.style.setProperty('--slaids-visible-bottom-gap', `${workspace.visibleBottomGap}px`)
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    typeof window === 'undefined' ? DESKTOP_WORKSPACE : deriveWorkspace(readMetrics()),
  )
  const current = useRef(workspace)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame = 0

    const sample = (): void => {
      const next = deriveWorkspace(readMetrics())
      // Rotating a phone or opening a keyboard must not re-render the editor
      // when nothing a layout reads has changed: a render that replaces the
      // stage is a render that can take the caret with it.
      if (same(current.current, next)) return
      current.current = next
      publish(next)
      setWorkspace(next)
    }

    /*
     * Measured a frame late, on purpose. The browser writes the new visual
     * viewport in its own frame, and reading inside the event itself would see
     * the area as it was before the keyboard shrank it — the same reason
     * `FloatingWindow` waits before it refits.
     */
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sample)
    }

    publish(current.current)

    const coarse = window.matchMedia?.(COARSE_QUERY)
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    coarse?.addEventListener('change', schedule)
    // The first sample: the initial state was taken before the effect ran, and
    // a browser can have finished laying out since.
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      coarse?.removeEventListener('change', schedule)
    }
  }, [])

  const value = useMemo(() => workspace, [workspace])
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
