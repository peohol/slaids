/**
 * The user's autoerstatt rules (see `TypographyExtension`), wired into an
 * ordinary `<input>`.
 *
 * A section's heading and a reference's title and authors are prose too, and
 * both end up rendered on a slide — a section slide, or the deck's own
 * reference page — without ever passing through a Tiptap document on the
 * way there. Which rule fires is `findAutocorrectRule`'s answer here exactly
 * as it is in the rich-text fields, so the two can never drift apart.
 *
 * Anchored at the caret exactly like the input rule is: only the sequence
 * just typed can trigger a replacement, so an edit earlier in the field, or
 * a paste, is never rewritten out from under it.
 */

import type { ChangeEvent } from 'react'
import { findAutocorrectRule } from '../../domain/autocorrect'
import { currentAutocorrectRules } from '../../state/autocorrect'

function typedSubstitution(value: string, caret: number): { value: string; caret: number } | null {
  const before = value.slice(0, caret)
  const rule = findAutocorrectRule(before, currentAutocorrectRules())
  if (!rule) return null
  const head = before.slice(0, before.length - rule.from.length)
  return { value: head + rule.to + value.slice(caret), caret: head.length + rule.to.length }
}

/**
 * Drop-in replacement for a controlled `<input>`'s `onChange`: the caller's
 * own setter still receives every change, just the substituted value instead
 * of the raw one when a rule has just fired.
 */
export function useTypedSubstitution(onChange: (value: string) => void) {
  return {
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      const substituted = typedSubstitution(input.value, input.selectionStart ?? input.value.length)
      if (!substituted) {
        onChange(input.value)
        return
      }
      // A substitution changes the field's length, so the browser's own
      // caret placement — end of the raw, unreplaced text — is wrong. Setting
      // the DOM value here, ahead of React's own re-render with the same
      // string, is what keeps the caret at the replacement instead of losing
      // it: a value React sets to what is already there does not move it.
      input.value = substituted.value
      input.setSelectionRange(substituted.caret, substituted.caret)
      onChange(substituted.value)
    },
  }
}
