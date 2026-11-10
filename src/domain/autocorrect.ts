/**
 * Autoerstatt: what a person types, swapped for what they meant.
 *
 * The model is mdeditz's, function for function. The rules are data, not code:
 * one rule is a pair — `from` is the characters typed, `to` what they become —
 * and the list belongs to the user, not to a presentation. It is stored beside
 * the user's other things (`SlaidsRepository.loadAutocorrectRules`) and written
 * whole whenever it changes.
 *
 * Everything that arrives from outside — a stored row, a dialog — goes through
 * `normalizeAutocorrectRules`, which repairs rather than rejects, so a list
 * that has become something else can never take the editor with it.
 *
 * Spaces count in a rule: ` - ` is not `-`. A bare hyphen is a hyphen —
 * `e-post`, `1-2` — and a bare asterisk starts a list; only the spaced forms
 * stand in for a dash and a separator. The leading space also keeps such rules
 * clear of Markdown's own: `- ` at the start of a line still makes a list,
 * because there is no space in front of it to match.
 */

export interface AutocorrectRule {
  from: string
  to: string
}

/** Same limits as the sibling app, so a rule stays a rule. */
export const MAX_AUTOCORRECT_RULES = 100
export const MAX_AUTOCORRECT_RULE_LENGTH = 20

/**
 * The rules a user who has never saved any gets.
 *
 * mdeditz's list as it stood when Slaids took the system over, so the two
 * apps write the same characters out of the same keystrokes.
 */
export const DEFAULT_AUTOCORRECT_RULES: readonly AutocorrectRule[] = Object.freeze(
  [
    { from: ' - ', to: ' – ' },
    { from: ' * ', to: ' · ' },
    { from: '  ', to: ' ' },
    { from: '--', to: '–' },
    { from: '–-', to: '—' },
    { from: '->', to: '→' },
    { from: '–>', to: '⟶' },
    { from: '—-', to: '―' },
  ].map((rule) => Object.freeze(rule)),
)

/** A fresh, mutable copy of the defaults. */
export function defaultAutocorrectRules(): AutocorrectRule[] {
  return DEFAULT_AUTOCORRECT_RULES.map((rule) => ({ ...rule }))
}

/**
 * A space, in both of the forms a field can hand one over.
 *
 * Pressing the space bar does not always leave U+0020 behind. Where the
 * surrounding CSS collapses white space — `white-space: nowrap`, which is what
 * makes a slide title one unwrapped line — a space at the end of the line would
 * be invisible, so the browser writes a non-breaking space instead and swaps it
 * back once something follows. The author pressed the space bar either way, so
 * a rule is matched against what was typed, not against what the field is
 * styled with. Same length, so positions in the text are unchanged.
 */
function plainSpaces(text: string): string {
  return text.replace(/\u00A0/g, ' ')
}

/** One side of a rule: one line, cut where it stops being a rule. */
function cleanSide(raw: unknown): string {
  return plainSpaces(typeof raw === 'string' ? raw : '')
    .replace(/[\r\n\t]/g, '')
    .slice(0, MAX_AUTOCORRECT_RULE_LENGTH)
}

/**
 * The list, repaired.
 *
 * A rule with nothing to recognise can never fire, and a rule that swaps
 * something for itself does nothing — both go. Two rules for the same
 * characters are one too many: the first wins, as it would while typing.
 * Anything that is not a list is no list; whether *no stored list* means the
 * defaults is the store's question, not this one's.
 */
export function normalizeAutocorrectRules(raw: unknown): AutocorrectRule[] {
  const seen = new Set<string>()
  const rules: AutocorrectRule[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const from = cleanSide(record.from)
    const to = cleanSide(record.to)
    if (!from || from === to || seen.has(from)) continue
    seen.add(from)
    rules.push({ from, to })
    if (rules.length >= MAX_AUTOCORRECT_RULES) break
  }
  return rules
}

/** Whether two lists say the same thing, rule for rule and in order. */
export function sameAutocorrectRules(
  a: readonly AutocorrectRule[],
  b: readonly AutocorrectRule[],
): boolean {
  return a.length === b.length && a.every((rule, i) => rule.from === b[i].from && rule.to === b[i].to)
}

/**
 * Which rule fires on the text in front of the caret, if any.
 *
 * `before` is everything up to the caret, *including* what was just typed, so a
 * rule can only fire on a keystroke that completes it — text that was already
 * there is never rewritten again. The longest match wins, so `–>` becomes `⟶`
 * even though `->` would also match its tail.
 */
export function findAutocorrectRule(
  before: string,
  rules: readonly AutocorrectRule[],
): AutocorrectRule | null {
  const text = plainSpaces(before)
  let best: AutocorrectRule | null = null
  for (const rule of rules) {
    if (!rule.from || !text.endsWith(rule.from)) continue
    if (!best || rule.from.length > best.from.length) best = rule
  }
  return best
}
