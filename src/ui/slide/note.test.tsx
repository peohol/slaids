/**
 * What a note zone draws for an audience: nothing at all.
 *
 * This is the rule the whole content kind stands on, so it is checked at the
 * renderer both the editor and the audience share. Every surface that is not
 * the editor — presentation mode, the player, a published deck, thumbnails, a
 * rendered preview and offscreen fit measurement — draws through
 * `ZoneContentView` without a `renderNote`, and this file checks what comes out
 * of that: the zone's own element and not one glyph, border, background or
 * label more.
 *
 * It also checks the other half, because «nothing is drawn» would be easy to
 * achieve by drawing no zone at all: the element is still there, so the zones
 * around it are laid out exactly as they were.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createNote, createUntitledCard } from '../../domain/content'
import { computeSlideGeometry } from '../../domain/geometry'
import { createLeaf, createSplit } from '../../domain/layout'
import { geometryForTheme } from '../../domain/metrics'
import { createPresentation, createSlide } from '../../domain/presentation'
import type { NoteContent, ZoneContent } from '../../domain/types'
import { ZoneContentView } from './ZoneContentView'
import { PageColorsProvider, SlideRenderProvider } from './SlideRenderContext'

const PROMPT = 'Fotorealistisk rekonstruksjon av en voksen neandertaler i et paleolittisk landskap.'

function render(content: ZoneContent, renderNote?: (note: NoteContent) => React.ReactNode): string {
  const presentation = createPresentation({ title: 'Dekk' })
  return renderToStaticMarkup(
    <SlideRenderProvider
      value={{
        theme: presentation.theme,
        numbering: new Map(),
        sectionColors: new Map(),
        progress: new Map(),
        isStatic: true,
      }}
    >
      <PageColorsProvider colors={{ accent: '#bfccd9', background: '#101828' }}>
        <ZoneContentView content={content} renderNote={renderNote} />
      </PageColorsProvider>
    </SlideRenderProvider>,
  )
}

describe('a note in the audience’s view', () => {
  it('draws the zone and nothing inside it', () => {
    expect(render(createNote(PROMPT, 'image-prompt'))).toBe(
      '<div class="zone-content zone-content--note" data-content-kind="note"></div>',
    )
  })

  it('never carries the text, however long it is', () => {
    const markup = render(createNote(PROMPT.repeat(5)))
    expect(markup).not.toContain('Fotorealistisk')
    expect(markup).not.toContain('neandertaler')
  })

  it('shows no label, icon or button an audience could press', () => {
    const markup = render(createNote(PROMPT, 'image-prompt'))
    for (const chrome of ['<button', '<svg', 'Notat', 'Bildeprompt']) {
      expect(markup, chrome).not.toContain(chrome)
    }
  })

  it('paints no background and no border of its own', () => {
    // Nothing inline, and the one class it carries only clears the background —
    // see `.zone-content--note`. Air draws exactly as much.
    const markup = render(createNote(PROMPT))
    expect(markup).not.toContain('style=')
    expect(markup).not.toContain('border')
  })

  it('draws no more than deliberate air does', () => {
    // Identical but for the name of the kind, which is the claim: to everyone
    // but the author the two are the same empty rectangle, and only what they
    // *mean* differs.
    const withoutKind = (markup: string) => markup.replaceAll(/negative-space|note/g, 'kind')
    expect(withoutKind(render(createNote(PROMPT)))).toBe(
      withoutKind(render({ id: 'a', kind: 'negative-space' })),
    )
  })

  it('draws whatever the editor hands it, and only then', () => {
    // The same component, the same content, one prop apart: that prop is the
    // whole difference between the author's view and everybody else's.
    const markup = render(createNote(PROMPT, 'image-prompt'), (note) => <b>{note.purpose}</b>)
    expect(markup).toContain('<b>image-prompt</b>')
  })
})

describe('a note zone’s geometry', () => {
  it('is laid out exactly like any other zone beside it', () => {
    // Two slides that differ only in what the second zone holds. A note has no
    // minimum size and draws nothing, but it is still a zone, so every
    // rectangle on the slide has to come out identical.
    const geometry = geometryForTheme()
    const rectsFor = (second: ZoneContent) =>
      [
        ...computeSlideGeometry(
          createSlide({
            hasTitle: true,
            root: createSplit(
              'x',
              [2, 1],
              [createLeaf(createUntitledCard()), createLeaf(second)],
            ),
          }),
          geometry,
        ).rects.values(),
      ]

    expect(rectsFor(createNote(PROMPT, 'image-prompt'))).toEqual(
      rectsFor({ id: 'a', kind: 'negative-space' }),
    )
  })
})
