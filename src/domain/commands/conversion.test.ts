import { describe, expect, it } from 'vitest'
import { convertContentKind } from './content'
import { bodyOf, createImage, createNegativeSpace, createTitledCard, createUntitledCard } from '../content'
import { docToPlainText, emptyDoc, paragraphDoc } from '../richdoc'
import type { ZoneContent } from '../types'

function textOf(content: ZoneContent): string {
  switch (content.kind) {
    case 'negative-space':
      return ''
    case 'container':
    case 'untitled-card':
      return content.body.subfields.map((field) => docToPlainText(field.doc)).join('\n')
    case 'titled-card':
      return [
        docToPlainText(content.title),
        ...content.body.subfields.map((f) => docToPlainText(f.doc)),
      ].join('\n')
    case 'image':
      return content.image.caption ? docToPlainText(content.image.caption.doc) : ''
    case 'titled-image-card':
      return [
        docToPlainText(content.title),
        content.image.caption ? docToPlainText(content.image.caption.doc) : '',
      ]
        .filter((line) => line.length > 0)
        .join('\n')
  }
}

function titledWithBody(title: string, body: string) {
  const card = createTitledCard(title)
  return {
    ...card,
    body: {
      ...card.body,
      subfields: [{ ...card.body.subfields[0], doc: paragraphDoc(body) }],
    },
  }
}

describe('konvertering til og fra negativt rom', () => {
  it('lar en tom sone bli luft og luft bli et vanlig innhold igjen', () => {
    const air = convertContentKind(createUntitledCard(), 'negative-space')
    expect(air.kind).toBe('negative-space')
    expect(textOf(air)).toBe('')

    const back = convertContentKind(air, 'titled-card')
    expect(back.kind).toBe('titled-card')
    expect(textOf(back).trim()).toBe('')
  })

  it('gir et skrivbart tomt felt, ikke et dokument uten blokker', () => {
    // `{ content: [] }` is not the empty document: the editor's schema wants a
    // block to put the caret in, and a field built without one cannot be typed
    // into at all. The two sources with nothing to carry are air and a picture
    // panel with neither file nor caption.
    for (const source of [createNegativeSpace(), createImage()]) {
      const converted = convertContentKind(source, 'container')
      const body = bodyOf(converted)
      expect(body?.subfields[0].doc, source.kind).toEqual(emptyDoc())
    }
  })
})

describe('convertContentKind never loses content', () => {
  it('keeps the card title when a titled card becomes an untitled card', () => {
    const converted = convertContentKind(titledWithBody('Viktig tittel', 'Brødtekst'), 'untitled-card')
    expect(converted.kind).toBe('untitled-card')
    expect(textOf(converted)).toContain('Viktig tittel')
    expect(textOf(converted)).toContain('Brødtekst')
    expect(JSON.stringify(converted)).toContain('"heading"')
  })

  it('keeps the card title when a titled card becomes a container', () => {
    const converted = convertContentKind(titledWithBody('Viktig tittel', 'Brødtekst'), 'container')
    expect(converted.kind).toBe('container')
    expect(textOf(converted)).toContain('Viktig tittel')
    expect(textOf(converted)).toContain('Brødtekst')
  })

  it('keeps the title as a title when converting between card kinds', () => {
    const untitled = convertContentKind(titledWithBody('T', 'B'), 'untitled-card')
    const back = convertContentKind(untitled, 'titled-card')
    expect(back.kind).toBe('titled-card')
    expect(textOf(back)).toContain('T')
    expect(textOf(back)).toContain('B')
  })

  it('carries an image from a container into a card body', () => {
    const container = createImage('asset-7')
    const converted = convertContentKind(container, 'untitled-card')
    expect(converted.kind).toBe('untitled-card')
    expect(JSON.stringify(converted)).toContain('asset-7')
    expect(JSON.stringify(converted)).toContain('slaidsImage')
  })

  it('keeps every subfield when converting between card kinds', () => {
    const card = createUntitledCard()
    const withThree = {
      ...card,
      body: {
        axis: 'x' as const,
        weights: [1, 2, 3],
        subfields: [
          { id: 'a', doc: paragraphDoc('En') },
          { id: 'b', doc: paragraphDoc('To') },
          { id: 'c', doc: paragraphDoc('Tre') },
        ],
      },
    }
    const converted = convertContentKind(withThree, 'titled-card')
    expect(converted.kind).toBe('titled-card')
    if (converted.kind === 'titled-card') {
      expect(converted.body.subfields).toHaveLength(3)
      expect(converted.body.axis).toBe('x')
      expect(converted.body.weights).toEqual([1, 2, 3])
    }
    expect(textOf(converted)).toContain('En')
    expect(textOf(converted)).toContain('To')
    expect(textOf(converted)).toContain('Tre')
  })

  it('merges every subfield into a container', () => {
    const card = createUntitledCard()
    const withTwo = {
      ...card,
      body: {
        ...card.body,
        weights: [1, 1],
        subfields: [
          { id: 'a', doc: paragraphDoc('Første') },
          { id: 'b', doc: paragraphDoc('Andre') },
        ],
      },
    }
    const converted = convertContentKind(withTwo, 'container')
    expect(textOf(converted)).toContain('Første')
    expect(textOf(converted)).toContain('Andre')
  })

  it('is a no-op for the same kind', () => {
    const card = createUntitledCard()
    expect(convertContentKind(card, 'untitled-card')).toBe(card)
  })

  it('gives the converted content a fresh id', () => {
    const card = createUntitledCard()
    expect(convertContentKind(card, 'container').id).not.toBe(card.id)
  })
})
