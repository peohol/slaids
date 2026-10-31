import { describe, expect, it } from 'vitest'
import { markScrollEdges } from './scrollEdges'

/** An element with a fixed scroll geometry, as jsdom does no layout. */
function row(scrollWidth: number, clientWidth: number, scrollLeft: number): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(element, 'clientWidth', { value: clientWidth })
  Object.defineProperty(element, 'scrollLeft', { value: scrollLeft, writable: true })
  return element
}

const marks = (element: HTMLElement) => ({
  start: 'moreStart' in element.dataset,
  end: 'moreEnd' in element.dataset,
})

describe('markScrollEdges', () => {
  it('marks nothing when everything fits', () => {
    const element = row(300, 300, 0)
    markScrollEdges(element)
    expect(marks(element)).toEqual({ start: false, end: false })
  })

  it('marks the far edge at the start, both in the middle and the near edge at the end', () => {
    const cases: [number, { start: boolean; end: boolean }][] = [
      [0, { start: false, end: true }],
      [100, { start: true, end: true }],
      [200, { start: true, end: false }],
    ]
    for (const [scrollLeft, expected] of cases) {
      const element = row(500, 300, scrollLeft)
      markScrollEdges(element)
      expect(marks(element), `at ${scrollLeft}`).toEqual(expected)
    }
  })

  it('takes a mark away when the row no longer has more on that side', () => {
    const element = row(500, 300, 100)
    markScrollEdges(element)
    element.scrollLeft = 200
    markScrollEdges(element)
    expect(marks(element)).toEqual({ start: true, end: false })
  })

  it('ignores a sub-pixel remainder', () => {
    const element = row(300.5, 300, 0)
    markScrollEdges(element)
    expect(marks(element)).toEqual({ start: false, end: false })
  })
})
