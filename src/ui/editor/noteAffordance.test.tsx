/**
 * The handle a note zone shows in the editor.
 *
 * Two rules, and both are about what a note must not become. It is editor
 * chrome, so it says the note's own name rather than trying to preview a
 * paragraph in a rectangle that may be a sliver; and in zone mode it is inert,
 * because zone mode is the mode about the zones themselves and a note must not
 * be the one kind of zone a press cannot select.
 */

import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNote } from '../../domain/content'
import { NoteAffordance } from './NoteAffordance'

const PROMPT = 'Fotorealistisk rekonstruksjon av et paleolittisk landskap.'

describe('NoteAffordance', () => {
  it('says what the note is, not what it says', () => {
    const markup = renderToStaticMarkup(
      <NoteAffordance content={createNote(PROMPT, 'image-prompt')} onOpen={() => {}} />,
    )
    expect(markup).toContain('Bildeprompt')
    // The prompt itself stays in the dialog: a zone is not a place to read it.
    expect(markup).not.toContain('Fotorealistisk')
  })

  it('falls back to the content kind’s own name for an ordinary note', () => {
    const markup = renderToStaticMarkup(
      <NoteAffordance content={createNote(PROMPT)} onOpen={() => {}} />,
    )
    expect(markup).toContain('Notat')
    expect(markup).not.toContain('Bildeprompt')
  })

  it('is a button that opens the note, and swallows the press that did it', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let opened = 0
    let reachedZone = 0
    act(() => {
      root.render(
        <div onClick={() => (reachedZone += 1)}>
          <NoteAffordance content={createNote(PROMPT)} onOpen={() => (opened += 1)} />
        </div>,
      )
    })

    const button = host.querySelector<HTMLButtonElement>('[data-testid="open-note"]')
    expect(button).not.toBeNull()
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(opened).toBe(1)
    // A press that opened the note is not also a press on the zone behind it.
    expect(reachedZone).toBe(0)

    act(() => root.unmount())
    host.remove()
  })

  it('is drawn but inert when there is nothing to open — zone mode', () => {
    const markup = renderToStaticMarkup(<NoteAffordance content={createNote(PROMPT)} />)
    expect(markup).toContain('Notat')
    expect(markup).not.toContain('<button')
    expect(markup).toContain('zone-note__button--inert')
  })
})
