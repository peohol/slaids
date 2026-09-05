/**
 * The plain-`<input>` counterpart to `TypographyExtension`: the same three
 * substitutions, reached by typing rather than by calling a command, since
 * that is the one thing an input rule cannot be driven by directly.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useTypedSubstitution } from './useTypedSubstitution'

function Field() {
  const [value, setValue] = useState('')
  const typed = useTypedSubstitution(setValue)
  return <input data-testid="field" value={value} onChange={typed.onChange} />
}

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  root = null
  container = null
})

function mount(): HTMLInputElement {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Field />))
  return container.querySelector<HTMLInputElement>('[data-testid="field"]')!
}

// React tracks an input's value through its own setter, so assigning
// `input.value` directly is invisible to it — the native setter underneath
// is what a real keystroke goes through.
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)!.set!

/** Types one character at a time, the way a real caret advances. */
function type(input: HTMLInputElement, text: string): void {
  for (const char of text) {
    const at = input.selectionStart ?? input.value.length
    const next = input.value.slice(0, at) + char + input.value.slice(at)
    nativeValueSetter.call(input, next)
    input.setSelectionRange(at + 1, at + 1)
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
}

describe('useTypedSubstitution', () => {
  it('rewrites a spaced hyphen to an en dash as it is typed', () => {
    const input = mount()
    type(input, 'Del 1 - konklusjon')
    expect(input.value).toBe('Del 1 – konklusjon')
  })

  it('rewrites three dots to an ellipsis', () => {
    const input = mount()
    type(input, 'Og så videre...')
    expect(input.value).toBe('Og så videre…')
  })

  it('rewrites a spaced asterisk to a middle dot', () => {
    const input = mount()
    type(input, 'Ett * to')
    expect(input.value).toBe('Ett · to')
  })

  it('leaves a bare hyphen alone, as in a word', () => {
    const input = mount()
    type(input, 'e-post')
    expect(input.value).toBe('e-post')
  })

  it('places the caret right after the replacement, not at the end of the field', () => {
    const input = mount()
    // The substitution shortens " - " (3 chars) to " – " (3 chars, but a
    // single replaced character) — moving on to type more should land right
    // after the dash, not wherever the raw, unreplaced text would have put it.
    type(input, 'Del 1 - test')
    input.setSelectionRange('Del 1 –'.length, 'Del 1 –'.length)
    type(input, 'X')
    expect(input.value).toBe('Del 1 –X test')
  })
})
