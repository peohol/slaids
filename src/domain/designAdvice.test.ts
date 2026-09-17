/**
 * The design findings.
 *
 * Every case here is a *legal* document — the commands would have written all
 * of them — so what is being asserted is never «this was refused», but «this
 * was noticed» or, at least as often, «this was left alone». The second half is
 * the load-bearing one: a check that flags an untitled card whenever it sees an
 * accent would stop the anti-pattern and take four legitimate compositions with
 * it, so each of those is written out as its own case rather than trusted to
 * the implementation.
 */

import { describe, expect, it } from 'vitest'
import { createPresentation } from './presentation'
import { accentUsedAsCardTitle, findPresentationAdvice, findSlideAdvice } from './designAdvice'
import { contentAt, sectionAt } from './testDecks'
import type { Axis, CardBody, ContentSlide, Presentation, RichNode, ZoneContent } from './types'

function accent(text: string): RichNode {
  return { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] }
}

function paragraph(text: string): RichNode {
  return text
    ? { type: 'paragraph', content: [{ type: 'text', text }] }
    : { type: 'paragraph' }
}

function quote(text: string): RichNode {
  return { type: 'blockquote', content: [paragraph(text)] }
}

/** One field per argument, laid out along `axis` the way the renderer does. */
function body(axis: Axis, fields: RichNode[][]): CardBody {
  return {
    axis,
    weights: fields.map(() => 1),
    subfields: fields.map((blocks, index) => ({
      id: `f${index + 1}`,
      doc: { type: 'doc', content: blocks },
    })),
  }
}

/** Fields stacked over each other: the card reads straight through. */
function untitledCard(...fields: RichNode[][]): ZoneContent {
  return { id: 'c1', kind: 'untitled-card', backgroundColor: '#ffffff', body: body('y', fields) }
}

/** The same fields side by side, which is a different thing to read. */
function untitledRow(...fields: RichNode[][]): ZoneContent {
  return { id: 'c1', kind: 'untitled-card', backgroundColor: '#ffffff', body: body('x', fields) }
}

function titledCard(title: string, ...fields: RichNode[][]): ZoneContent {
  return {
    id: 'c1',
    kind: 'titled-card',
    headerColor: null,
    title: { type: 'doc', content: [paragraph(title)] },
    body: body('y', fields),
  }
}

function container(...fields: RichNode[][]): ZoneContent {
  return { id: 'c1', kind: 'container', body: body('y', fields) }
}

/** The deck's one content slide, with this content filling its single zone. */
function deckWith(content: ZoneContent): Presentation {
  const presentation = createPresentation({ title: 'Råd' })
  const slide = contentAt(presentation, 1)
  const filled: ContentSlide = {
    ...slide,
    root: { id: slide.root.id, kind: 'leaf', content },
  }
  return { ...presentation, slides: [sectionAt(presentation, 0), filled] }
}

function codesFor(content: ZoneContent): string[] {
  return findPresentationAdvice(deckWith(content)).map((advice) => advice.code)
}

describe('aksent brukt som korttittel', () => {
  it('finner et kort uten tittel der aksenten står øverst og brødteksten under', () => {
    expect(codesFor(untitledCard([accent('Første bosetning'), paragraph('Da innlandsisen …')]))).toEqual([
      'ACCENT_AS_CARD_TITLE',
    ])
  })

  it('finner mønsteret slik det faktisk ble laget: en datering over to avsnitt', () => {
    // Fra «Da isen slapp taket» i p_a45fsbjf9lj: kortet har ingen tittel, og
    // aksenten er i praksis overskriften for teksten under.
    const content = untitledCard([
      accent('ca. 10 000–9000 fvt.'),
      paragraph('Da innlandsisen trakk seg tilbake, ble kysten gradvis tilgjengelig.'),
      paragraph('De første gruppene fulgte etter viltet nordover.'),
    ])
    expect(codesFor(content)).toEqual(['ACCENT_AS_CARD_TITLE'])
  })

  it('leser kortet som én enhet, ikke ett felt om gangen', () => {
    // Aksenten står alene i det første feltet og teksten i det andre. Kortet
    // tegner fortsatt en overskrift med brødtekst under.
    expect(codesFor(untitledCard([accent('Første bosetning')], [paragraph('Da innlandsisen …')]))).toEqual([
      'ACCENT_AS_CARD_TITLE',
    ])
  })

  it('flagger aksent med brødtekst under seg i samme kolonne, også i et kort med kolonner', () => {
    const content = untitledRow(
      [accent('Første bosetning'), paragraph('Da innlandsisen …')],
      [paragraph('Funnene er få og spredte.')],
    )
    expect(codesFor(content)).toEqual(['ACCENT_AS_CARD_TITLE'])
  })

  it('bryr seg ikke om tomme avsnitt foran aksenten', () => {
    expect(codesFor(untitledCard([paragraph(''), accent('Første bosetning'), paragraph('Tekst')]))).toEqual([
      'ACCENT_AS_CARD_TITLE',
    ])
  })

  it('navngir sliden og sonen, og hvilken innholdstype det gjelder', () => {
    const presentation = deckWith(untitledCard([accent('Navn'), paragraph('Tekst')]))
    const slide = contentAt(presentation, 1)
    expect(findSlideAdvice(slide)).toEqual([
      {
        code: 'ACCENT_AS_CARD_TITLE',
        message: expect.stringContaining('titled-card'),
        slideId: slide.id,
        nodeId: slide.root.id,
        details: { contentKind: 'untitled-card' },
      },
    ])
  })
})

describe('det som ikke skal flagges', () => {
  it('lar aksenten være i fred inne i et kort som har tittel', () => {
    expect(codesFor(titledCard('Første bosetning', [accent('Kysten'), paragraph('Tekst')]))).toEqual([])
  })

  it('lar en container med samme blokker være i fred', () => {
    // Containeren er det sekundære formatet for støttetekst, og den er ikke
    // mønsteret dette finner.
    expect(codesFor(container([accent('Kilde'), paragraph('Tekst')]))).toEqual([])
  })

  it('lar et kort uten tittel som bare er én aksent være i fred', () => {
    expect(codesFor(untitledCard([accent('47 %')]))).toEqual([])
  })

  it('lar et sitatkort være i fred', () => {
    expect(codesFor(untitledCard([quote('Historien gjentar seg aldri helt.')]))).toEqual([])
  })

  it('lar et kort uten tittel uten aksent i det hele tatt være i fred', () => {
    expect(codesFor(untitledCard([paragraph('Ett kort utsagn som er hele budskapet.')]))).toEqual([])
  })

  it('lar side-om-side-felter være i fred: et nøkkeltall til venstre forklart til høyre', () => {
    // Subfeltaksen er den samme aksen rendereren legger feltene langs. Står de
    // ved siden av hverandre, er ingenting i venstre felt *over* noe i høyre,
    // og aksenten er da et parallelt poeng — ikke en overskrift for teksten.
    const fields: RichNode[][] = [[accent('47 %')], [paragraph('Andel som flyttet nordover.')]]
    expect(codesFor(untitledRow(...fields))).toEqual([])
    // De samme feltene stablet over hverandre leses derimot i rekkefølge.
    expect(codesFor(untitledCard(...fields))).toEqual(['ACCENT_AS_CARD_TITLE'])
  })

  it('lar en aksent lenger nede i teksten være i fred', () => {
    expect(codesFor(untitledCard([paragraph('Innledning'), accent('Poenget'), paragraph('Tekst')]))).toEqual(
      [],
    )
  })

  it('lar et kort som er delt opp av flere aksenter være i fred', () => {
    // Flere navngitte delpoenger er intern oppdeling, og da later ingen av
    // aksentene som om den er kortets overskrift.
    const content = untitledCard([
      accent('Først'),
      paragraph('Tekst'),
      accent('Deretter'),
      paragraph('Tekst'),
    ])
    expect(codesFor(content)).toEqual([])
  })

  it('sier ingenting om et dekk laget av domenets egne kommandoer', () => {
    expect(findPresentationAdvice(createPresentation({ title: 'Tomt' }))).toEqual([])
  })

  it('sier ingenting om en seksjonsslide', () => {
    const presentation = createPresentation({ title: 'Råd' })
    expect(findSlideAdvice(sectionAt(presentation, 0))).toEqual([])
  })
})

describe('spørsmålet på innholdet alene', () => {
  it('er det samme spørsmålet, uavhengig av hvilken slide innholdet ligger på', () => {
    expect(accentUsedAsCardTitle(untitledCard([accent('Navn'), paragraph('Tekst')]))).toBe(true)
    expect(accentUsedAsCardTitle(untitledCard([accent('Navn')]))).toBe(false)
    expect(accentUsedAsCardTitle({ id: 'c1', kind: 'negative-space' })).toBe(false)
  })
})
