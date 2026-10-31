/**
 * Says on an element whether it has more to scroll to on either side.
 *
 * A row that scrolls sideways — the formatting bar on a phone — has to show
 * that it does, or its last controls are simply not there for whoever cannot
 * see a scrollbar (docs/UX_IMPROVEMENT_PLAN.md § 6). The hook marks the
 * element with `data-more-start` and `data-more-end` while there is something
 * past that edge, and the stylesheet fades that edge out. It writes the two
 * attributes directly rather than through React state, so scrolling never
 * re-renders the toolbar under the caret.
 */

import { useCallback, useRef } from 'react'

/** A pixel of slack, so a sub-pixel layout does not claim a hidden sliver. */
const SLACK = 1

export function markScrollEdges(element: HTMLElement): void {
  const hidden = element.scrollWidth - element.clientWidth
  const start = element.scrollLeft > SLACK
  const end = hidden - element.scrollLeft > SLACK
  if (start) element.dataset.moreStart = ''
  else delete element.dataset.moreStart
  if (end) element.dataset.moreEnd = ''
  else delete element.dataset.moreEnd
}

/** A ref callback that keeps the marks up to date for as long as the element is mounted. */
export function useScrollEdges<T extends HTMLElement>(): (element: T | null) => void {
  const stop = useRef<(() => void) | null>(null)
  return useCallback((element: T | null) => {
    stop.current?.()
    stop.current = null
    if (!element) return

    const update = () => markScrollEdges(element)
    update()
    element.addEventListener('scroll', update, { passive: true })
    // The row's own width changes with the window; its content changes with
    // the caret (a table's tools come and go).
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(element)
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    mutation?.observe(element, { childList: true, subtree: true })
    stop.current = () => {
      element.removeEventListener('scroll', update)
      resize?.disconnect()
      mutation?.disconnect()
    }
  }, [])
}
