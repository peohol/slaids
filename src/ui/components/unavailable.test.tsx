import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { unavailable } from './unavailable'

let host: HTMLDivElement | null = null

afterEach(() => {
  host?.remove()
  host = null
})

function renderButton(disabled: boolean, onClick: () => void, onOuterClick: () => void) {
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => {
    root.render(
      <div onClick={onOuterClick}>
        <button type="button" onClick={onClick} {...unavailable(disabled)}>
          Knapp
        </button>
      </div>,
    )
  })
  return host.querySelector('button')!
}

describe('unavailable', () => {
  it('keeps an unavailable button focusable, says it is unavailable, and refuses the press', () => {
    const onClick = vi.fn()
    const onOuterClick = vi.fn()
    const button = renderButton(true, onClick, onOuterClick)

    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    button.focus()
    expect(document.activeElement).toBe(button)

    act(() => button.click())
    expect(onClick).not.toHaveBeenCalled()
    expect(onOuterClick).not.toHaveBeenCalled()
  })

  it('leaves an available button exactly as it was', () => {
    const onClick = vi.fn()
    const onOuterClick = vi.fn()
    const button = renderButton(false, onClick, onOuterClick)

    expect(button.hasAttribute('aria-disabled')).toBe(false)
    act(() => button.click())
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onOuterClick).toHaveBeenCalledTimes(1)
  })
})
