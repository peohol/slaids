/**
 * Typographic substitutions made while typing.
 *
 * Three replacements, each written the way it is meant to be read on a slide:
 * a spaced en dash for a spaced hyphen, one ellipsis character for three
 * periods, and a middle dot for a spaced asterisk.
 *
 * The spaces around the hyphen and the asterisk are part of the rule, not
 * decoration on it. A bare hyphen is a hyphen — `e-post`, `1-2` — and a bare
 * asterisk is a footnote mark or the start of a list; only the spaced forms are
 * standing in for a dash and a separator, so only those are replaced. The
 * leading space also keeps these rules clear of Markdown's own: `- ` and `* `
 * at the start of a line still make a bullet list, because at the start of a
 * line there is no space in front of them to match.
 *
 * `undoable` leaves Backspace able to take the substitution back immediately
 * after it happens, which is the escape hatch for the one case in a hundred
 * where the literal characters were what was wanted.
 */

import { Extension, textInputRule } from '@tiptap/core'

/** En dash, not em: the Norwegian tankestrek is `–` with a space on each side. */
export const EN_DASH = '–'
export const ELLIPSIS = '…'
export const MIDDLE_DOT = '·'

/**
 * The substitutions, as (typed, written) pairs.
 *
 * Exported so a test can assert the pairs rather than re-deriving the regexes,
 * and so there is one place that says what Slaids rewrites.
 */
export const TEXT_SUBSTITUTIONS = [
  { typed: ' - ', written: ` ${EN_DASH} ` },
  { typed: '...', written: ELLIPSIS },
  { typed: ' * ', written: ` ${MIDDLE_DOT} ` },
] as const

/**
 * The literal typed sequence, anchored to the caret.
 *
 * An input rule matches the text immediately before the caret, so every find
 * ends at `$`; the sequences are escaped rather than written as hand-tuned
 * patterns, so the list above stays the single description of the rule.
 */
function findFor(typed: string): RegExp {
  return new RegExp(`${typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

export const TypographyExtension = Extension.create({
  name: 'slaidsTypography',

  addInputRules() {
    return TEXT_SUBSTITUTIONS.map(({ typed, written }) =>
      textInputRule({ find: findFor(typed), replace: written, undoable: true }),
    )
  },
})
