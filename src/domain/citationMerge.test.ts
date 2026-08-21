/**
 * Adjacent citations are one citation.
 *
 * Four sources cited in the same place is `1–4`, not four pills in a row — and
 * a space typed between two of them is a typing artefact, not a sentence.
 */

import { describe, expect, it } from 'vitest'
import { mergeAdjacentCitations } from './richdoc'
import type { RichDoc, RichNode } from './types'

const cite = (...ids: string[]): RichNode => ({ type: 'citation', attrs: { referenceIds: ids } })
const text = (value: string): RichNode => ({ type: 'text', text: value })
const doc = (...nodes: RichNode[]): RichDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: nodes }],
})

function citations(result: RichDoc): string[][] {
  const paragraph = result.content?.[0]
  return (paragraph?.content ?? [])
    .filter((node) => node.type === 'citation')
    .map((node) => (node.attrs?.referenceIds as string[]) ?? [])
}

describe('mergeAdjacentCitations', () => {
  it('merges citations that touch', () => {
    const merged = mergeAdjacentCitations(doc(text('Påstand'), cite('a'), cite('b'), cite('c')))
    expect(citations(merged)).toEqual([['a', 'b', 'c']])
  })

  it('merges across whitespace, and drops the whitespace with it', () => {
    const merged = mergeAdjacentCitations(doc(cite('a'), text('  '), cite('b')))
    expect(citations(merged)).toEqual([['a', 'b']])
    expect(merged.content?.[0].content?.some((node) => node.type === 'text')).toBe(false)
  })

  it('leaves citations separated by real text alone', () => {
    const merged = mergeAdjacentCitations(doc(cite('a'), text(' og '), cite('b')))
    expect(citations(merged)).toEqual([['a'], ['b']])
  })

  it('keeps first-appearance order and drops repeats', () => {
    const merged = mergeAdjacentCitations(doc(cite('b', 'a'), cite('a'), cite('c')))
    expect(citations(merged)).toEqual([['b', 'a', 'c']])
  })

  it('returns the same document when there is nothing to merge', () => {
    const original = doc(text('Bare tekst'), cite('a'))
    expect(mergeAdjacentCitations(original)).toBe(original)
  })

  it('reaches citations nested in lists and quotes', () => {
    const nested: RichDoc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [cite('a'), cite('b')] }],
            },
          ],
        },
      ],
    }
    const merged = mergeAdjacentCitations(nested)
    const paragraph = merged.content?.[0].content?.[0].content?.[0]
    expect((paragraph?.content ?? []).filter((node) => node.type === 'citation')).toHaveLength(1)
  })
})
