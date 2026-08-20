/**
 * The content-fit guard's decision logic.
 *
 * The component itself needs a browser, but the rule it applies — accept when it
 * fits, accept when it improves, otherwise roll back — is worth pinning down
 * because getting it wrong makes an overflowing document unrepairable.
 */
import { describe, expect, it } from 'vitest'

const TOLERANCE = 0.75

type Decision = 'accept' | 'reject'

/**
 * Mirrors the rule in RichTextEditor.validate.
 *
 * `isFirst` is true for the very first validation of a mounted editor, which
 * observes the document as it arrived rather than judging an edit.
 */
function decide(overflow: number, lastOverflow: number, isFirst: boolean): Decision {
  if (overflow <= TOLERANCE) return 'accept'
  if (isFirst) return 'accept'
  if (overflow < lastOverflow - TOLERANCE) return 'accept'
  return 'reject'
}

describe('content-fit decision', () => {
  it('accepts anything that fits', () => {
    expect(decide(0, 0, false)).toBe('accept')
    expect(decide(0.5, 40, false)).toBe('accept')
  })

  it('rejects an edit that starts an overflow', () => {
    expect(decide(20, 0, false)).toBe('reject')
  })

  it('rejects an edit that makes an existing overflow worse', () => {
    expect(decide(60, 40, false)).toBe('reject')
  })

  it('rejects an edit that leaves the overflow unchanged', () => {
    expect(decide(40, 40, false)).toBe('reject')
  })

  it('accepts an edit that reduces an existing overflow', () => {
    expect(decide(20, 40, false)).toBe('accept')
  })

  it('accepts content that arrives already overflowing', () => {
    // A theme change or a smaller zone can leave a document overflowing without
    // an edit; refusing it would leave the user unable to touch it at all.
    expect(decide(120, 0, true)).toBe('accept')
  })

  it('still rejects the next edit after an overflowing document arrived', () => {
    expect(decide(120, 0, true)).toBe('accept')
    expect(decide(130, 120, false)).toBe('reject')
  })

  it('lets a sequence of shrinking edits converge', () => {
    let last = 0
    const steps = [90, 60, 30, 5, 0]
    const decisions = steps.map((overflow, index) => {
      const decision = decide(overflow, last, index === 0)
      if (decision === 'accept') last = overflow <= TOLERANCE ? 0 : overflow
      return decision
    })
    expect(decisions).toEqual(['accept', 'accept', 'accept', 'accept', 'accept'])
    expect(last).toBe(0)
  })
})
