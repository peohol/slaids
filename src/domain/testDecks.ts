/**
 * Deck helpers for tests.
 *
 * A deck opens with a section — `slides[0]` is the front page — so the slide a
 * zone test is about is the one after it. These two say which is meant and
 * narrow to it, so a test that reaches for a layout tree on a section fails
 * where it is written rather than at the first `undefined`.
 */

import { utf8ByteLength } from './interactive'
import { walkNodes } from './layout'
import { isNegativeSpace } from './negativeSpace'
import type { Axis, ContentSlide, InteractiveSlide, LayoutNode, Presentation, SectionSlide } from './types'

/** The slide at `index`, which the caller says has zones. */
export function contentAt(presentation: Presentation, index: number): ContentSlide {
  const slide = presentation.slides[index]
  if (slide?.kind !== 'content') {
    throw new Error(`Slide ${index} is not a content slide`)
  }
  return slide
}

/** The slide at `index`, which the caller says is a section. */
export function sectionAt(presentation: Presentation, index: number): SectionSlide {
  const slide = presentation.slides[index]
  if (slide?.kind !== 'section') {
    throw new Error(`Slide ${index} is not a section`)
  }
  return slide
}

/** The slide at `index`, which the caller says is an interactive slide. */
export function interactiveAt(presentation: Presentation, index: number): InteractiveSlide {
  const slide = presentation.slides[index]
  if (slide?.kind !== 'interactive') {
    throw new Error(`Slide ${index} is not an interactive slide`)
  }
  return slide
}

/** A source of exactly `byteSize` bytes of UTF-8 that still passes as HTML. */
export function htmlOfBytes(byteSize: number, glyph = 'a'): string {
  const frame = '<p></p>'
  const glyphBytes = utf8ByteLength(glyph)
  const fill = Math.floor((byteSize - utf8ByteLength(frame)) / glyphBytes)
  const html = `<p>${glyph.repeat(fill)}</p>`
  // Pad the remainder with ASCII inside the element so the count is exact.
  return html.replace('</p>', `${'b'.repeat(byteSize - utf8ByteLength(html))}</p>`)
}

/** Whether `node` has air along its whole `edge` along `axis`, directly or through splits that run that way. */
function airAlong(node: LayoutNode, axis: Axis, edge: 'start' | 'end'): boolean {
  if (isNegativeSpace(node)) return true
  if (node.kind !== 'split' || node.axis !== axis) return false
  return airAlong(node.children[edge === 'start' ? 0 : node.children.length - 1], axis, edge)
}

/**
 * Whether anywhere in the tree two pieces of air meet on one edge — side by
 * side, or through splits running the same way — which a stored layout never
 * has (`mergeNegativeSpace`).
 */
export function airMeetsAir(root: LayoutNode): boolean {
  let meets = false
  walkNodes(root, (node) => {
    if (node.kind !== 'split') return
    node.children.forEach((child, index) => {
      const next = node.children[index + 1]
      if (next && airAlong(child, node.axis, 'end') && airAlong(next, node.axis, 'start')) meets = true
    })
  })
  return meets
}
