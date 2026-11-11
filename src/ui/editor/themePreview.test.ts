/**
 * Temaeditorens komposisjon (§ 15.1) er et gyldig sonetre i den formen
 * spesifikasjonen sier, med all tekst midtstilt, og den får plass i normal
 * størrelse i hvert tema editoren tilbyr – så forhåndsvisningen viser temaet,
 * ikke en forminsket nødløsning.
 */

import { describe, expect, it } from 'vitest'
import { collectLeaves, validateTree } from '../../domain/layout'
import { computeSlideGeometry, validateSlideGeometry } from '../../domain/geometry'
import { estimateFit } from '../../domain/fit'
import { FIT_TOLERANCE, TITLED_CARD_STYLES } from '../../domain/constants'
import { FONT_SCALE_PRESETS, SPACING_PRESETS, geometryForTheme } from '../../domain/metrics'
import { defaultTheme } from '../../domain/presentation'
import { ACCENT_NODE, docToPlainText } from '../../domain/richdoc'
import type { CardBody, RichDoc, ZoneContent } from '../../domain/types'
import { themePreviewSlide } from './ThemePreview'

function bodyOf(content: ZoneContent): CardBody {
  if (!('body' in content)) throw new Error(`${content.kind} har ikke innhold`)
  return content.body
}

function blocks(doc: RichDoc) {
  return doc.content ?? []
}

describe('themePreviewSlide', () => {
  const slide = themePreviewSlide()
  const [card, container, untitled] = collectLeaves(slide.root).map((leaf) => leaf.content!)

  it('er et kort med tittel til venstre og en beholder over et kort uten tittel til høyre', () => {
    expect(validateTree(slide.root)).toEqual([])
    expect(slide.title).toBeNull()
    expect(slide.root).toMatchObject({ kind: 'split', axis: 'x', weights: [1, 1] })
    expect(card.kind).toBe('titled-card')
    expect(container.kind).toBe('container')
    expect(untitled.kind).toBe('untitled-card')
    if (card.kind !== 'titled-card') return
    expect(docToPlainText(card.title)).toBe('Tittel')
    const [accent, paragraph] = blocks(bodyOf(card).subfields[0].doc)
    expect(accent.type).toBe(ACCENT_NODE)
    expect(docToPlainText({ type: 'doc', content: [accent] })).toBe('Aksent')
    expect(docToPlainText({ type: 'doc', content: [paragraph] })).toBe('Slik ser brødtekst ut.')
    expect(docToPlainText(bodyOf(container).subfields[0].doc)).toBe('Her er mer brødtekst.')
    expect(docToPlainText(bodyOf(untitled).subfields[0].doc)).toBe('Og her er atter mer brødtekst.')
  })

  it('midtstiller all tekst vannrett og loddrett', () => {
    const docs = [card, container, untitled].flatMap((content) => bodyOf(content).subfields)
    for (const field of docs) {
      expect(field.verticalAlign).toBe('middle')
      for (const block of blocks(field.doc)) expect(block.attrs?.textAlign).toBe('center')
    }
    if (card.kind === 'titled-card') {
      for (const block of blocks(card.title)) expect(block.attrs?.textAlign).toBe('center')
    }
  })

  it('er gyldig og får plass i normal størrelse i hvert tema editoren tilbyr', () => {
    for (const spacing of SPACING_PRESETS) {
      for (const fontScale of FONT_SCALE_PRESETS) {
        for (const titledCardStyle of TITLED_CARD_STYLES) {
          const theme = { ...defaultTheme(), spacing: spacing.value, fontScale: fontScale.value, titledCardStyle }
          const options = { ...geometryForTheme(theme), progressHeight: 0 }
          expect(validateSlideGeometry(slide, options)).toEqual([])
          const geometry = computeSlideGeometry(slide, options)
          for (const leaf of collectLeaves(slide.root)) {
            const fit = estimateFit(leaf.content!, geometry.rects.get(leaf.id)!, { theme })
            expect(fit.overflow, `${leaf.content!.kind} i ${spacing.label}/${fontScale.label}/${titledCardStyle}`).toBeLessThanOrEqual(FIT_TOLERANCE)
          }
        }
      }
    }
  })
})
