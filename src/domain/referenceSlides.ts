/**
 * Derived reference slides.
 *
 * These slides are never stored. They are recomputed from the reference list
 * every time the deck is rendered, which is what keeps their numbering and
 * pagination correct after any edit.
 */

import { computeMainRect } from './geometry'
import { titleDoc } from './richdoc'
import {
  REFERENCE_SLIDE_ID_PREFIX,
  planReferenceSlides,
  referenceEntries,
  type ReferenceEntry,
} from './references'
import { REFERENCE_FONT_SIZE } from './constants'
import type { LayoutNode, Presentation, RichDoc, RichNode, Slide } from './types'

function entriesToDoc(entries: ReferenceEntry[]): RichDoc {
  const content: RichNode[] = entries.map((entry) => {
    const children: RichNode[] = [{ type: 'text', text: `${entry.number}. ` }]
    if (entry.url) {
      const label = entry.text || entry.url
      children.push({
        type: 'text',
        text: label,
        marks: [{ type: 'link', attrs: { href: entry.url, target: '_blank' } }],
      })
    } else {
      children.push({ type: 'text', text: entry.text })
    }
    return { type: 'paragraph', content: children }
  })
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

function columnLeaf(id: string, entries: ReferenceEntry[]): LayoutNode {
  return {
    id,
    kind: 'leaf',
    content: {
      id: `${id}-content`,
      kind: 'container',
      payload: { type: 'richdoc', doc: entriesToDoc(entries) },
    },
  }
}

/**
 * Reference slides for the whole presentation, or an empty list when nothing is
 * cited. Ids are deterministic so React can reconcile them across renders.
 */
export function buildReferenceSlides(presentation: Presentation): Slide[] {
  const entries = referenceEntries(presentation)
  if (entries.length === 0) return []

  const mainRect = computeMainRect(true)
  const plan = planReferenceSlides(entries, {
    width: mainRect.width,
    height: mainRect.height,
    fontSize: REFERENCE_FONT_SIZE,
  })

  return plan.slides.map((columns, slideIndex) => {
    const id = `${REFERENCE_SLIDE_ID_PREFIX}${slideIndex}`
    const nonEmpty = columns.filter((column) => column.length > 0)
    const leaves = nonEmpty.map((column, columnIndex) =>
      columnLeaf(`${id}-col-${columnIndex}`, column),
    )
    const root: LayoutNode =
      leaves.length === 1
        ? leaves[0]
        : {
            id: `${id}-root`,
            kind: 'split',
            axis: 'x',
            weights: leaves.map(() => 1),
            children: leaves,
          }
    return {
      id,
      title: titleDoc(slideIndex === 0 ? 'Referanser' : `Referanser (${slideIndex + 1})`),
      root,
    }
  })
}

/** The full deck as shown to an audience: authored slides plus derived ones. */
export function presentationSlides(presentation: Presentation): Slide[] {
  return [...presentation.slides, ...buildReferenceSlides(presentation)]
}
