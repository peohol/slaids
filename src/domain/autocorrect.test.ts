import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTOCORRECT_RULES,
  MAX_AUTOCORRECT_RULE_LENGTH,
  MAX_AUTOCORRECT_RULES,
  defaultAutocorrectRules,
  findAutocorrectRule,
  normalizeAutocorrectRules,
  sameAutocorrectRules,
} from './autocorrect'

/** What typing `typed` one character at a time leaves, with every rule applied as it fires. */
function typeOut(typed: string, rules = DEFAULT_AUTOCORRECT_RULES): string {
  let text = ''
  for (const char of typed) {
    text += char
    const rule = findAutocorrectRule(text, rules)
    if (rule) text = text.slice(0, text.length - rule.from.length) + rule.to
  }
  return text
}

describe('standardreglene', () => {
  it('er mdeditz sine regler, og overlever en reparasjon uendret', () => {
    expect(DEFAULT_AUTOCORRECT_RULES.map((rule) => [rule.from, rule.to])).toEqual([
      [' - ', ' – '],
      [' * ', ' · '],
      ['  ', ' '],
      ['--', '–'],
      ['–-', '—'],
      ['->', '→'],
      ['–>', '⟶'],
      ['—-', '―'],
    ])
    expect(normalizeAutocorrectRules(DEFAULT_AUTOCORRECT_RULES)).toEqual(defaultAutocorrectRules())
  })

  it('gir en kopi som kan endres uten å røre originalen', () => {
    const copy = defaultAutocorrectRules()
    copy[0].to = 'x'
    expect(DEFAULT_AUTOCORRECT_RULES[0].to).toBe(' – ')
  })

  it.each([
    ['Del 1 - to', 'Del 1 – to'],
    ['én * to', 'én · to'],
    ['to  ord', 'to ord'],
    ['a--b', 'a–b'],
    ['a---b', 'a—b'],
    ['a----b', 'a―b'],
    ['a -> b', 'a → b'],
    ['a --> b', 'a ⟶ b'],
    ['e-post 1-2 *fet*', 'e-post 1-2 *fet*'],
  ])('«%s» blir «%s» når det skrives', (typed, written) => {
    expect(typeOut(typed)).toBe(written)
  })
})

describe('findAutocorrectRule', () => {
  it('slår bare til på teksten rett foran markøren', () => {
    expect(findAutocorrectRule('a -> b', DEFAULT_AUTOCORRECT_RULES)).toBeNull()
  })

  it('leser et hardt mellomrom som mellomrommet det står for', () => {
    expect(findAutocorrectRule('Del 1\u00A0-\u00A0', DEFAULT_AUTOCORRECT_RULES)?.to).toBe(' – ')
  })

  it('lar den lengste regelen vinne, uansett rekkefølge', () => {
    const rules = [
      { from: 'c)', to: 'x' },
      { from: '(c)', to: '©' },
    ]
    expect(findAutocorrectRule('(c)', rules)?.to).toBe('©')
    expect(findAutocorrectRule('(c)', [...rules].reverse())?.to).toBe('©')
  })

  it('gjør ingenting uten regler', () => {
    expect(findAutocorrectRule('a - ', [])).toBeNull()
  })
})

describe('normalizeAutocorrectRules', () => {
  it('fjerner regler som aldri kan slå til eller ikke gjør noe, og dobbeltregler', () => {
    expect(
      normalizeAutocorrectRules([
        { from: '', to: 'x' },
        { from: 'a', to: 'a' },
        { from: '(c)', to: '©' },
        { from: '(c)', to: 'C' },
        { from: 'tm', to: '' },
        null,
        'tekst',
        { from: 3, to: 'x' },
      ]),
    ).toEqual([
      { from: '(c)', to: '©' },
      { from: 'tm', to: '' },
    ])
  })

  it('gjør hver side til én linje med vanlige mellomrom, og kutter den ved grensen', () => {
    const long = 'x'.repeat(MAX_AUTOCORRECT_RULE_LENGTH + 5)
    expect(normalizeAutocorrectRules([{ from: '\u00A0-\n\u00A0', to: long }])).toEqual([
      { from: ' - ', to: 'x'.repeat(MAX_AUTOCORRECT_RULE_LENGTH) },
    ])
  })

  it('tar høyst et fast antall regler', () => {
    const many = Array.from({ length: MAX_AUTOCORRECT_RULES + 10 }, (_, i) => ({ from: `r${i}`, to: 'x' }))
    expect(normalizeAutocorrectRules(many)).toHaveLength(MAX_AUTOCORRECT_RULES)
  })

  it('gjør alt som ikke er en liste til en tom liste', () => {
    expect(normalizeAutocorrectRules(undefined)).toEqual([])
    expect(normalizeAutocorrectRules({ from: 'a', to: 'b' })).toEqual([])
  })
})

describe('sameAutocorrectRules', () => {
  it('sammenligner regel for regel, i rekkefølge', () => {
    const rules = defaultAutocorrectRules()
    expect(sameAutocorrectRules(rules, defaultAutocorrectRules())).toBe(true)
    expect(sameAutocorrectRules(rules, [...rules].reverse())).toBe(false)
    expect(sameAutocorrectRules(rules, rules.slice(1))).toBe(false)
  })
})
