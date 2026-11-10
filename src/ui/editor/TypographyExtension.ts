/**
 * Autoerstatt while typing, in every rich-text field.
 *
 * The rules are the user's own (`domain/autocorrect.ts`, held by
 * `state/autocorrect.ts`), read at the keystroke rather than when the editor
 * was built, so a list saved in the dialog applies to fields that are already
 * open. Matching is `findAutocorrectRule`'s — the same function the plain
 * `<input>` fields use (`useTypedSubstitution`) — so the two cannot disagree
 * about what fires.
 *
 * The replacement is written with ordinary spaces even where the browser had
 * handed over a non-breaking one at the end of a one-line field, so nothing
 * collapsing ever reaches the document.
 *
 * `undoable` leaves Backspace able to take the substitution back immediately
 * after it happens, which is the escape hatch for the one case in a hundred
 * where the literal characters were what was wanted.
 */

import { Extension, InputRule } from '@tiptap/core'
import { findAutocorrectRule } from '../../domain/autocorrect'
import { currentAutocorrectRules } from '../../state/autocorrect'

export const TypographyExtension = Extension.create({
  name: 'slaidsTypography',

  addInputRules() {
    return [
      new InputRule({
        find: (text) => {
          const rule = findAutocorrectRule(text, currentAutocorrectRules())
          if (!rule) return null
          return { index: text.length - rule.from.length, text: text.slice(-rule.from.length), data: { to: rule.to } }
        },
        handler: ({ state, range, match }) => {
          state.tr.insertText(String(match.data?.to ?? ''), range.from, range.to)
        },
        undoable: true,
      }),
    ]
  },
})
