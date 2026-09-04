/**
 * The blank line a field ends with.
 *
 * It is not content, and it has one consequence that is easy to miss: a field
 * aligns its whole flow, so a trailing blank line pushes centred text up and
 * leaves more air below it than above. Inserting a picture used to leave one
 * behind every single time, so this rule is checked at all three of the places
 * it has to hold — the pure function, the command every field edit goes
 * through, and the migration that cleans documents written before it existed.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from './presentation'
import { createLeaf } from './layout'
import { containerWithDoc } from './content'
import { setSubfieldDoc } from './commands'
import { migratePresentation } from './migrations'

import { emptyDoc, imageNode, paragraphDoc, trimTrailingBlankLines } from './richdoc'
import type { Presentation, RichDoc, RichNode } from './types'

const blank: RichNode = { type: 'paragraph' }
const text = (value: string): RichNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
})

function doc(...content: RichNode[]): RichDoc {
  return { type: 'doc', content }
}

describe('trimTrailingBlankLines', () => {
  it('drops the empty line a picture leaves behind it', () => {
    const picture = imageNode('a1')
    expect(trimTrailingBlankLines(doc(picture, blank))).toEqual(doc(picture))
  })

  it('drops every trailing blank line, not just the last one', () => {
    expect(trimTrailingBlankLines(doc(text('Ett'), blank, blank, blank))).toEqual(doc(text('Ett')))
  })

  it('counts a line of nothing but spaces as blank', () => {
    const spaces: RichNode = { type: 'paragraph', content: [{ type: 'text', text: '   ' }] }
    expect(trimTrailingBlankLines(doc(text('Ett'), spaces))).toEqual(doc(text('Ett')))
  })

  it('keeps a blank line between two paragraphs — that one is a distance', () => {
    const spaced = doc(text('Ett'), blank, text('To'))
    expect(trimTrailingBlankLines(spaced)).toBe(spaced)
  })

  it('keeps a deliberate line break, which is not the same as an empty line', () => {
    const broken: RichNode = { type: 'paragraph', content: [{ type: 'hardBreak' }] }
    const kept = doc(text('Ett'), broken)
    expect(trimTrailingBlankLines(kept)).toBe(kept)
  })

  it('leaves the last block standing: a document is `block+`', () => {
    expect(trimTrailingBlankLines(emptyDoc())).toEqual(emptyDoc())
    expect(trimTrailingBlankLines(doc(blank, blank))).toEqual(doc(blank))
  })

  it('returns the same object when there is nothing to trim', () => {
    const untouched = doc(text('Ett'))
    expect(trimTrailingBlankLines(untouched)).toBe(untouched)
  })
})

function deckWithField(): { presentation: Presentation; nodeId: string; subfieldId: string } {
  const base = createPresentation({ title: 'Trailing' })
  const content = containerWithDoc(paragraphDoc('Start'))
  const leaf = createLeaf(content)
  const presentation = {
    ...base,
    slides: [{ ...base.slides[0], root: leaf }],
  }
  return { presentation, nodeId: leaf.id, subfieldId: content.body.subfields[0].id }
}

describe('setSubfieldDoc', () => {
  it('never stores the blank line a field ends with', () => {
    const { presentation, nodeId, subfieldId } = deckWithField()
    const result = setSubfieldDoc(presentation, {
      slideId: presentation.slides[0].id,
      nodeId,
      subfieldId,
      doc: doc(imageNode('a1'), blank),
    })
    if (!result.ok) throw new Error('expected ok')

    const root = result.value.slides[0].root
    if (root.kind !== 'leaf' || root.content?.kind !== 'container') throw new Error('expected leaf')
    expect(root.content.body.subfields[0].doc).toEqual(doc(imageNode('a1')))
  })
})

describe('migration to the current schema', () => {
  it('clears the blank line under every picture written before the rule', () => {
    const { presentation } = deckWithField()
    const stored = {
      ...presentation,
      // The version this migration upgrades *from*, named rather than derived:
      // «one below current» stops testing this step the moment a later one is
      // added, and does it silently.
      schemaVersion: 9,
      slides: [
        {
          ...presentation.slides[0],
          root: {
            id: 'n1',
            kind: 'leaf',
            content: {
              id: 'c1',
              kind: 'container',
              payload: {
                type: 'fields',
                body: {
                  axis: 'y',
                  weights: [1],
                  subfields: [{ id: 'f1', doc: doc(imageNode('a1'), blank) }],
                },
              },
            },
          },
        },
      ],
    }

    const result = migratePresentation(stored)
    if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`)
    const root = result.value.slides[0].root
    if (root.kind !== 'leaf' || root.content?.kind !== 'container') throw new Error('expected leaf')
    expect(root.content.body.subfields[0].doc.content).toHaveLength(1)
  })
})
