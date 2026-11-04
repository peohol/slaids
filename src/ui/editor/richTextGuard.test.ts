/**
 * The content-fit guard's decision logic.
 *
 * The component itself needs a browser, but the rule it applies — accept when it
 * fits, accept unless it is worse, otherwise roll back — is worth pinning down
 * because getting it wrong makes an overflowing document unrepairable.
 */
import { describe, expect, it } from 'vitest'
import { FIT_TOLERANCE } from '../../domain/constants'
import { isOverflowRegression } from '../../domain/commands/fitGuard'

type Decision = 'accept' | 'reject'

/**
 * The rule as RichTextEditor.validate applies it.
 *
 * `isFirst` is true for the very first validation of a mounted editor, which
 * observes the document as it arrived rather than judging an edit.
 */
function decide(overflow: number, lastOverflow: number, isFirst: boolean): Decision {
  if (isFirst) return 'accept'
  return isOverflowRegression(overflow, lastOverflow) ? 'reject' : 'accept'
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

  it('accepts an edit that leaves the overflow as it was', () => {
    // A letter for a letter in a zone a person drew smaller than its text:
    // nothing is hidden that was not before, and refusing it would leave the
    // text impossible to correct without cutting it.
    expect(decide(40, 40, false)).toBe('accept')
    expect(decide(40 + FIT_TOLERANCE, 40, false)).toBe('accept')
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
      if (decision === 'accept') last = overflow <= FIT_TOLERANCE ? 0 : overflow
      return decision
    })
    expect(decisions).toEqual(['accept', 'accept', 'accept', 'accept', 'accept'])
    expect(last).toBe(0)
  })
})
