import { describe, expect, it } from 'vitest'
import { convertContentKind } from './content'
import { createContainer, createTitledCard, createUntitledCard } from '../content'
import { docToPlainText, paragraphDoc } from '../richdoc'
import type { ZoneContent } from '../types'

function textOf(content: ZoneContent): string {
  switch (content.kind) {
    case 'container':
      return content.payload.type === 'richdoc' ? docToPlainText(content.payload.doc) : ''
    case 'untitled-card':
      return content.body.subfields.map((field) => docToPlainText(field.doc)).join('\n')
    case 'titled-card':
      return [docToPlainText(content.title), ...content.body.subfields.map((f) => docToPlainText(f.doc))].join('\n')
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
    const container = createContainer({ type: 'asset', assetId: 'asset-7', fit: 'contain' })
    const converted = convertContentKind(container, 'untitled-card')
    expect(converted.kind).toBe('untitled-card')
    expect(JSON.stringify(converted)).toContain('asset-7')
    expect(JSON.stringify(converted)).toContain('slaidsImage')
  })

  it('carries a figure from a container into a card body', () => {
    const container = createContainer({
      type: 'shape',
      shape: { kind: 'ellipse', fill: '#bfccd9', stroke: '#263340', strokeWidth: 3 },
    })
    const converted = convertContentKind(container, 'titled-card')
    expect(JSON.stringify(converted)).toContain('slaidsShape')
    expect(JSON.stringify(converted)).toContain('ellipse')
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
