import { describe, expect, it } from 'vitest'
import { createPresentation } from '../presentation'
import {
  DEFAULT_CARD_BACKGROUND,
  ZONE_CONTENT_KINDS,
  bodyOf,
  createCaption,
  createContentOfKind,
  imagePanelOf,
  withBody,
  withDefaultColors,
  withImagePanel,
} from '../content'
import { estimateFitChecker } from '../fit'
import { ACCENT_NODE, walkRichNodes } from '../richdoc'
import { findLeaf } from '../layout'
import { contentAt } from '../testDecks'
import type { RichDoc, ZoneContent } from '../types'
import { resetContentColors, setZoneContent } from './index'

const PICKED = '#a64d79'

const accentDoc = (color: string | null): RichDoc => ({
  type: 'doc',
  content: [
    { type: ACCENT_NODE, attrs: { level: 1, color }, content: [{ type: 'text', text: 'Aksent' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Tekst' }] },
  ],
})

/**
 * The content with every colour it can carry set to `color` — or, for `null`,
 * to what it has when nobody picked one.
 */
function paint(content: ZoneContent, color: string | null): ZoneContent {
  let next = content
  if (next.kind === 'untitled-card') next = { ...next, backgroundColor: color ?? DEFAULT_CARD_BACKGROUND }
  if (next.kind === 'titled-card' || next.kind === 'titled-image-card') next = { ...next, headerColor: color }
  const body = bodyOf(next)
  if (body) {
    next = withBody(next, {
      ...body,
      subfields: body.subfields.map((field) => ({ ...field, doc: accentDoc(color) })),
    })
  }
  const panel = imagePanelOf(next)
  if (panel) next = withImagePanel(next, { ...panel, caption: { ...createCaption(), color } })
  return next
}

/** Every colour the content still carries that somebody chose. */
function pickedColors(content: ZoneContent): string[] {
  const colors: string[] = []
  if (content.kind === 'untitled-card' && content.backgroundColor !== DEFAULT_CARD_BACKGROUND) {
    colors.push(content.backgroundColor)
  }
  if ((content.kind === 'titled-card' || content.kind === 'titled-image-card') && content.headerColor) {
    colors.push(content.headerColor)
  }
  for (const field of bodyOf(content)?.subfields ?? []) {
    walkRichNodes(field.doc, (node) => {
      if (node.type === ACCENT_NODE && typeof node.attrs?.color === 'string') colors.push(node.attrs.color)
    })
  }
  const caption = imagePanelOf(content)?.caption
  if (caption?.color) colors.push(caption.color)
  return colors
}

describe('withDefaultColors', () => {
  it.each(ZONE_CONTENT_KINDS)('takes every picked colour off %s and changes nothing else', (kind) => {
    const base = createContentOfKind(kind)
    const reset = withDefaultColors(paint(base, PICKED))
    expect(pickedColors(reset)).toEqual([])
    expect(reset).toEqual(paint(base, null))
  })

  it.each(ZONE_CONTENT_KINDS)('hands back the very same %s when no colour was picked', (kind) => {
    const content = createContentOfKind(kind)
    expect(withDefaultColors(content)).toBe(content)
  })
})

describe('resetContentColors', () => {
  it('resets the colours of the content in a zone', () => {
    const deck = createPresentation({ title: 'Farger' })
    const slide = contentAt(deck, 1)
    const placed = setZoneContent(deck, {
      slideId: slide.id,
      nodeId: slide.root.id,
      content: paint(createContentOfKind('titled-card'), PICKED),
      fits: estimateFitChecker,
    })
    if (!placed.ok) throw new Error(placed.error.message)
    const reset = resetContentColors(placed.value.presentation, {
      slideId: slide.id,
      nodeId: slide.root.id,
      fits: estimateFitChecker,
    })
    if (!reset.ok) throw new Error(reset.error.message)
    const content = findLeaf(contentAt(reset.value, 1).root, slide.root.id)?.content
    expect(content && pickedColors(content)).toEqual([])
  })
})
