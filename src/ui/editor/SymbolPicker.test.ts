// @vitest-environment jsdom
/**
 * The data and the insertion command, headlessly: no popover, no localStorage
 * mocking beyond what jsdom already provides. The picking UI itself is a thin
 * React shell over these two things and over Radix's own popover behaviour.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { bodyExtensions, titleExtensions } from './extensions'
import {
  SYMBOL_GROUPS,
  SYMBOL_NAMES,
  insertSymbol,
  recentSymbols,
  rememberSymbol,
} from './SymbolPicker'

describe('SYMBOL_GROUPS', () => {
  it('names every character it lists', () => {
    for (const group of SYMBOL_GROUPS) {
      for (const [char, name] of group.symbols) {
        expect(char.length).toBeGreaterThan(0)
        expect(name.length).toBeGreaterThan(0)
      }
    }
  })

  it('resolves a duplicate character to the name of the group that lists it first', () => {
    // '°' appears in both "Typografi" and "Valuta og enheter" — the first
    // group in SYMBOL_GROUPS wins.
    const typografi = SYMBOL_GROUPS.find((group) => group.id === 'typography')!
    const [, expected] = typografi.symbols.find(([char]) => char === '°')!
    expect(SYMBOL_NAMES.get('°')).toBe(expected)
  })
})

describe('recent symbols', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('starts empty', () => {
    expect(recentSymbols()).toEqual([])
  })

  it('remembers the most recently used character first', () => {
    rememberSymbol('→')
    rememberSymbol('Ω')
    expect(recentSymbols()).toEqual(['Ω', '→'])
  })

  it('moves a repeated character back to the front instead of duplicating it', () => {
    rememberSymbol('→')
    rememberSymbol('Ω')
    rememberSymbol('→')
    expect(recentSymbols()).toEqual(['→', 'Ω'])
  })

  it('drops anything that is not one of the known characters', () => {
    localStorage.setItem('slaids.symbolsRecent', JSON.stringify(['→', 'not a real entry']))
    expect(recentSymbols()).toEqual(['→'])
  })

  it('is silent about a corrupt or missing value', () => {
    localStorage.setItem('slaids.symbolsRecent', '{not json')
    expect(recentSymbols()).toEqual([])
  })
})

describe('insertSymbol', () => {
  it('inserts a character as plain text in a body field', () => {
    const editor = new Editor({ extensions: bodyExtensions(), content: '<p>alta</p>' })
    // Caret between "al" and "ta".
    editor.commands.setTextSelection(3)
    insertSymbol(editor, '→')
    expect(editor.getText()).toBe('al→ta')
    editor.destroy()
  })

  it('replaces a selection the way typing over it would', () => {
    const editor = new Editor({ extensions: bodyExtensions(), content: '<p>alfabeta</p>' })
    // Select "fabe" out of "al[fabe]ta".
    editor.commands.setTextSelection({ from: 3, to: 7 })
    insertSymbol(editor, '→')
    expect(editor.getText()).toBe('al→ta')
    editor.destroy()
  })

  it('works the same in a title field, which carries no marks at all', () => {
    const editor = new Editor({ extensions: titleExtensions(), content: '<p>Del 1</p>' })
    editor.commands.setTextSelection(6)
    insertSymbol(editor, '§')
    expect(editor.getText()).toBe('Del 1§')
    editor.destroy()
  })
})
