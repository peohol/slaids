/**
 * En person nektes aldri en endring fordi innholdet ikke får plass; en agent
 * gjør det.
 *
 * Hver test gjør den samme endringen to ganger: med fit-sjekkene en agent
 * alltid får (`structuralOptions`), og med `HUMAN_EDIT`, som grensesnittet
 * kjører alt med. Den første skal avvises – eller, for en deling, flytte
 * innholdet ut av sonen – og den andre skal gå gjennom med innholdet der det
 * var, så det tegnes mindre.
 */

import { describe, expect, it } from 'vitest'
import { containerWithDoc } from '../content'
import { estimateFitChecker, estimateTitleFitChecker } from '../fit'
import { createLeaf, createSplit, findLeaf } from '../layout'
import { FONT_SCALE_PRESETS } from '../metrics'
import { createPresentation, withSlide } from '../presentation'
import { paragraphDoc, titleDoc } from '../richdoc'
import { contentAt } from '../testDecks'
import type { Presentation, ZoneContent } from '../types'
import { addContentToSandbox, placeSandboxItem } from './sandbox'
import { addSection, setSlideTitle, setTheme } from './slides'
import { setZoneContent, splitLeaf } from './layout'
import { HUMAN_EDIT } from './manualLayout'
import type { StructuralOptions } from './types'

const AGENT: StructuralOptions = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }

const words = (count: number): ZoneContent =>
  containerWithDoc(paragraphDoc(Array.from({ length: count }, (_, at) => `ord${at % 7}`).join(' ')))

/** En slide med to soner side om side, begge tomme. */
function row(): { presentation: Presentation; slideId: string; left: string; right: string } {
  const base = createPresentation({ title: 'Plass' })
  const slide = contentAt(base, 1)
  const left = createLeaf()
  const right = createLeaf()
  const presentation = withSlide(base, { ...slide, root: createSplit('x', [1, 1], [left, right]) })
  return { presentation, slideId: slide.id, left: left.id, right: right.id }
}

/** Den mest tekst sonen tar imot i normal størrelse, som agenten måler den. */
function fullestFitting(presentation: Presentation, slideId: string, nodeId: string): Presentation {
  let fullest: Presentation | null = null
  for (let count = 20; ; count += 20) {
    const placed = setZoneContent(presentation, { slideId, nodeId, content: words(count), ...AGENT })
    if (!placed.ok) break
    fullest = placed.value.presentation
  }
  if (!fullest) throw new Error('Sonen tok ikke imot noe')
  return fullest
}

describe('HUMAN_EDIT', () => {
  it('har ingen fit-sjekker og kan ikke få en', () => {
    expect(HUMAN_EDIT).toEqual({})
    expect(Object.isFrozen(HUMAN_EDIT)).toBe(true)
  })

  it('lar en person gjøre skriften større i temaet når en full sone da ikke får plass', () => {
    const { presentation, slideId, left } = row()
    const full = fullestFitting(presentation, slideId, left)
    const larger = { fontScale: FONT_SCALE_PRESETS[FONT_SCALE_PRESETS.length - 1].value }

    const agent = setTheme(full, larger, AGENT)
    expect(agent.ok).toBe(false)
    if (!agent.ok) expect(agent.error.code).toBe('CONTENT_DOES_NOT_FIT')

    const person = setTheme(full, larger, HUMAN_EDIT)
    expect(person.ok).toBe(true)
    if (person.ok) expect(person.value.theme.fontScale).toBe(larger.fontScale)
  })

  it('lar en person plassere innhold fra sandkassen i en sone det ikke får plass i', () => {
    const { presentation, slideId, right } = row()
    const sandboxed = addContentToSandbox(presentation, words(4000))
    if (!sandboxed.ok) throw new Error(sandboxed.error.message)
    const itemId = sandboxed.value.sandbox[0].id

    const agent = placeSandboxItem(sandboxed.value, { itemId, slideId, nodeId: right, ...AGENT })
    expect(agent.ok).toBe(false)
    if (!agent.ok) expect(agent.error.code).toBe('CONTENT_DOES_NOT_FIT')

    const person = placeSandboxItem(sandboxed.value, { itemId, slideId, nodeId: right, ...HUMAN_EDIT })
    expect(person.ok).toBe(true)
    if (person.ok) {
      expect(person.value.presentation.sandbox).toHaveLength(0)
      expect(findLeaf(contentAt(person.value.presentation, 1).root, right)?.content).not.toBeNull()
    }
  })

  it('lar innholdet bli i sonen når en person deler den for smått, der agentens deling flytter det ut', () => {
    const { presentation, slideId, left } = row()
    const full = fullestFitting(presentation, slideId, left)
    const split = { slideId, nodeId: left, axis: 'y' as const, weights: [1, 1], contentTargetIndex: 0 }

    const agent = splitLeaf(full, { ...split, ...AGENT })
    expect(agent.ok).toBe(true)
    if (agent.ok) expect(agent.value.movedToSandbox).toHaveLength(1)

    const person = splitLeaf(full, { ...split, ...HUMAN_EDIT })
    expect(person.ok).toBe(true)
    if (person.ok) {
      expect(person.value.movedToSandbox).toHaveLength(0)
      expect(person.value.presentation.sandbox).toHaveLength(0)
    }
  })

  it('lar en person gi en slidetittel og en ny inndeling en overskrift for lang for linjen', () => {
    const { presentation, slideId } = row()
    const long = Array.from({ length: 40 }, () => 'overskrift').join(' ')

    expect(setSlideTitle(presentation, slideId, titleDoc(long), AGENT).ok).toBe(false)
    expect(setSlideTitle(presentation, slideId, titleDoc(long), HUMAN_EDIT).ok).toBe(true)

    expect(addSection(presentation, { title: long, ...AGENT }).ok).toBe(false)
    expect(addSection(presentation, { title: long, ...HUMAN_EDIT }).ok).toBe(true)
  })

  it('holder fortsatt den harde minstegrensen: innhold som ikke kan tegnes i sonen i det hele tatt', () => {
    const base = createPresentation({ title: 'Hard' })
    const slide = contentAt(base, 1)
    const tiny = createLeaf()
    const presentation = withSlide(base, {
      ...slide,
      root: createSplit('x', [1, 10], [tiny, createLeaf()]),
    })
    const sandboxed = addContentToSandbox(presentation, words(3))
    if (!sandboxed.ok) throw new Error(sandboxed.error.message)
    const placed = placeSandboxItem(sandboxed.value, {
      itemId: sandboxed.value.sandbox[0].id,
      slideId: slide.id,
      nodeId: tiny.id,
      ...HUMAN_EDIT,
    })
    expect(placed.ok).toBe(false)
    if (!placed.ok) expect(placed.error.code).not.toBe('CONTENT_DOES_NOT_FIT')
  })
})
