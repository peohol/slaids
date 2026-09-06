/**
 * Derived reference slides.
 *
 * These slides are never stored. They are recomputed from the reference list
 * every time the deck is rendered, which is what keeps their numbering and
 * pagination correct after any edit.
 */

import { computeMainRect } from './geometry'
import { estimateDocHeight } from './fit'
import { titleDoc } from './richdoc'
import { geometryForTheme } from './metrics'
import {
  REFERENCE_SLIDE_ID_PREFIX,
  planReferenceSlides,
  referenceEntries,
  type ReferenceEntry,
} from './references'
import type { ContentSlide, DeckSource, LayoutNode, RichDoc, RichNode, Slide } from './types'

/**
 * One entry, as the renderer will draw it.
 *
 * The planner measures exactly this node — not an idea of it. A pagination
 * that assumes one font size while the slide renders another packs a column
 * fuller than it can hold, and `overflow: hidden` then eats the tail of the
 * bibliography with nothing to show for it.
 */
function entryParagraph(entry: ReferenceEntry): RichNode {
  const children: RichNode[] = [{ type: 'text', text: `${entry.number}. ` }]
  if (entry.label) children.push({ type: 'text', text: entry.label })
  if (entry.url) {
    if (entry.label) children.push({ type: 'text', text: ' ⋅ ' })
    children.push({
      type: 'text',
      text: entry.url,
      marks: [{ type: 'link', attrs: { href: entry.url, target: '_blank' } }],
    })
  }
  if (!entry.label && !entry.url) children.push({ type: 'text', text: '' })
  return { type: 'paragraph', content: children }
}

function entriesToDoc(entries: ReferenceEntry[]): RichDoc {
  const content: RichNode[] = entries.map(entryParagraph)
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] }
}

function columnLeaf(id: string, entries: ReferenceEntry[]): LayoutNode {
  return {
    id,
    kind: 'leaf',
    content: {
      id: `${id}-content`,
      kind: 'container',
      // Ids are derived from the column rather than minted, so React reconciles
      // the same field across renders instead of remounting the editor.
      body: {
        axis: 'y',
        weights: [1],
        subfields: [{ id: `${id}-field`, doc: entriesToDoc(entries) }],
      },
    },
  }
}

/**
 * Reference slides for the whole deck, or an empty list when nothing is cited.
 * Ids are deterministic so React can reconcile them across renders.
 */
export function buildReferenceSlides(deck: DeckSource): ContentSlide[] {
  const entries = referenceEntries(deck)
  if (entries.length === 0) return []

  const geometry = geometryForTheme(deck.theme)
  const mainRect = computeMainRect(true, geometry)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const plan = planReferenceSlides(entries, {
    width: mainRect.width,
    height: mainRect.height,
    gap: geometry.gap,
    // Measured with the deck's own typography, through the same estimator every
    // other zone is measured with, on the same paragraph the column will hold.
    measureEntryHeight: (_text, columnWidth, entryId) => {
      const entry = byId.get(entryId)
      if (!entry) return 0
      return estimateDocHeight({ type: 'doc', content: [entryParagraph(entry)] }, columnWidth, {
        theme: deck.theme,
      })
    },
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
      kind: 'content',
      title: titleDoc(slideIndex === 0 ? 'Referanser' : `Referanser (${slideIndex + 1})`),
      root,
    }
  })
}

/** The full deck as shown to an audience: authored slides plus derived ones. */
export function presentationSlides(deck: DeckSource): Slide[] {
  return [...deck.slides, ...buildReferenceSlides(deck)]
}
