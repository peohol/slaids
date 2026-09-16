/**
 * The picture plan, the brief it generates, and the checks between them.
 *
 * The workflow this replaces failed in a way worth pinning down: a note parked
 * in a zone held the motif while the zone held the shape, the two were written
 * by different hands, and the deck's «brief» was a paragraph about style that
 * nobody could paste anywhere. Everything asserted here is one of the three
 * things that made that possible, and is now impossible:
 *
 *  - the count, the numbering and the aspect ratios are *derived*, so a brief
 *    cannot say seven and list six, and cannot describe a shape the zone does
 *    not have;
 *  - the placeholder caption on the slide and the number in the brief come out
 *    of the same call, so they cannot mean different pictures;
 *  - the checks are asked of plan, zones and geometry at once, which is the one
 *    question an agent re-reading its own prompt cannot answer.
 */

import { describe, expect, it } from 'vitest'
import { setImagePlan, syncImagePlaceholders } from './commands/imagePlan'
import { setContentKind, setImageAsset, setImageCaption } from './commands/content'
import { moveSlide } from './commands/slides'
import { setImageContext } from './commands/slides'
import { registerAsset } from './commands/assets'
import { createImage, createTitledImageCard } from './content'
import { createLeaf, createSplit } from './layout'
import { createPresentation } from './presentation'
import { titleDoc, docToPlainText } from './richdoc'
import { PLANNED_IMAGE_FIELDS, REQUIRED_PLANNED_IMAGE_FIELDS } from './constants'
import { validatePresentation } from './schema'
import { contentAt, sectionAt } from './testDecks'
import {
  aspectRatioLabel,
  checkImagePlan,
  composeImageBrief,
  isPlaceholderCaption,
  orientationOf,
  placeholderCaption,
  resolveImagePlan,
  PLANNED_IMAGE_SECTION_HEADINGS,
  type PlannedImage,
} from './imagePlan'
import type { LayoutNode, Presentation } from './types'

const CONTEXT =
  'Fotorealistiske rekonstruksjoner, naturlig dagslys, dempet jordfargepalett, ingen tekst i bildene.'

/** A deck whose one content slide has the zones a test asks for. */
function deckWith(root: LayoutNode): Presentation {
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  return {
    ...base,
    imageContext: CONTEXT,
    slides: [sectionAt(base, 0), { ...contentAt(base, 1), title: titleDoc('Tre arter'), root }],
  }
}

/** Three side-by-side picture zones: the narrow, upright columns a row makes. */
function threeColumns(): { deck: Presentation; slideId: string; nodeIds: string[] } {
  const leaves = [createLeaf(createImage()), createLeaf(createImage()), createLeaf(createImage())]
  const deck = deckWith(createSplit('x', [1, 1, 1], leaves))
  return { deck, slideId: deck.slides[1].id, nodeIds: leaves.map((leaf) => leaf.id) }
}

interface OneZone {
  deck: Presentation
  slideId: string
  nodeId: string
}

/** One zone filling the whole main area: the widest rectangle a slide has. */
function wideZone(): OneZone {
  const leaf = createLeaf(createImage())
  const deck = deckWith(leaf)
  return { deck, slideId: deck.slides[1].id, nodeId: leaf.id }
}

/** One of three columns: the upright rectangle a row of peers makes. */
function uprightZone(): OneZone {
  const { deck, slideId, nodeIds } = threeColumns()
  return { deck, slideId, nodeId: nodeIds[0] }
}

function entry(slideId: string, nodeId: string, subject: string): PlannedImage {
  return {
    slideId,
    nodeId,
    subject,
    composition: 'Motivet sentrert, rolig bakgrunn.',
    requirements: 'Anatomisk korrekte proporsjoner.',
    avoid: 'Moderne klær og bygninger.',
  }
}

function planned(deck: Presentation, entries: PlannedImage[]): Presentation {
  const written = setImagePlan(deck, entries)
  if (!written.ok) throw new Error(`Forventet suksess: ${written.error.message}`)
  return written.value
}

function captionAt(deck: Presentation, nodeId: string): string | null {
  const slide = deck.slides[1]
  if (slide.kind !== 'content') return null
  const walk = (node: LayoutNode): string | null => {
    if (node.kind === 'split') {
      for (const child of node.children) {
        const hit = walk(child)
        if (hit !== null) return hit
      }
      return null
    }
    if (node.id !== nodeId) return null
    const content = node.content
    if (!content || !('image' in content)) return ''
    return content.image.caption ? docToPlainText(content.image.caption.doc) : ''
  }
  return walk(slide.root)
}

describe('aspect ratio', () => {
  it('er det minste hele forholdstallet som fortsatt beskriver rektangelet', () => {
    expect(aspectRatioLabel({ width: 800, height: 1000 })).toBe('4:5')
    expect(aspectRatioLabel({ width: 1600, height: 900 })).toBe('16:9')
    expect(aspectRatioLabel({ width: 500, height: 500 })).toBe('1:1')
    expect(aspectRatioLabel({ width: 900, height: 600 })).toBe('3:2')
    // A rectangle nobody would call a ratio still has to print as one.
    expect(aspectRatioLabel({ width: 1600, height: 901 })).toBe('16:9')
  })

  it('kaller nær kvadratisk for nær kvadratisk, ikke liggende', () => {
    // The whole failure this model exists for: a zone that is almost a square
    // getting a wide, landscape prompt written for it.
    expect(orientationOf(1)).toBe('nær kvadratisk')
    expect(orientationOf(1.05)).toBe('nær kvadratisk')
    expect(orientationOf(1.5)).toBe('liggende')
    expect(orientationOf(0.8)).toBe('stående')
  })
})

describe('bildeplanen mot dekket', () => {
  it('nummererer etter dekkets rekkefølge, ikke etter rekkefølgen oppføringene kom i', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      entry(slideId, nodeIds[2], 'Homo neanderthalensis i helfigur.'),
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur.'),
      entry(slideId, nodeIds[1], 'Homo erectus i helfigur.'),
    ])

    const resolved = resolveImagePlan(written)
    expect(resolved.map((image) => image.number)).toEqual([1, 2, 3])
    expect(resolved.map((image) => image.plan.nodeId)).toEqual(nodeIds)
  })

  it('stempler plassholderteksten med det samme nummeret briefen bruker', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(
      deck,
      nodeIds.map((nodeId, index) => entry(slideId, nodeId, `Motiv nummer ${index + 1}, en art.`)),
    )

    for (const [index, nodeId] of nodeIds.entries()) {
      expect(captionAt(written, nodeId)).toBe(placeholderCaption(index + 1))
    }
    const brief = composeImageBrief(written) ?? ''
    expect(brief).toContain('BILDE 1 AV 3')
    expect(brief).toContain('BILDE 3 AV 3')
  })

  it('rører aldri en bildetekst forfatteren selv har skrevet', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const authored = setImageCaption(deck, {
      slideId,
      nodeId: nodeIds[0],
      doc: titleDoc('Lucy, 3,2 millioner år'),
    })
    expect(authored.ok).toBe(true)
    if (!authored.ok) return

    const written = planned(authored.value, [
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur.'),
      entry(slideId, nodeIds[1], 'Homo erectus i halvfigur.'),
    ])
    expect(captionAt(written, nodeIds[0])).toBe('Lucy, 3,2 millioner år')
    expect(captionAt(written, nodeIds[1])).toBe(placeholderCaption(2))
  })

  it('tar plassholderen bort igjen når filen kommer', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    expect(captionAt(written, nodeIds[0])).toBe(placeholderCaption(1))

    const withAsset = registerAsset(written, {
      id: 'a1',
      name: 'erectus.png',
      mimeType: 'image/png',
      byteSize: 10,
      width: 800,
      height: 1000,
      isVector: false,
    })
    expect(withAsset.ok).toBe(true)
    if (!withAsset.ok) return

    const filled = setImageAsset(withAsset.value, {
      slideId,
      nodeId: nodeIds[0],
      assetId: 'a1',
    })
    expect(filled.ok).toBe(true)
    if (!filled.ok) return
    // The instruction has been carried out; leaving it would print it over the
    // finished deck.
    expect(captionAt(filled.value, nodeIds[0])).toBe('')
    // And the picture keeps its number, so the brief is still readable.
    expect(resolveImagePlan(filled.value)[0].number).toBe(1)
  })

  it('fjerner en plassholder fra en sone som ikke lenger er planlagt', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const two = planned(deck, [
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur.'),
      entry(slideId, nodeIds[1], 'Homo erectus i halvfigur.'),
    ])
    const one = planned(two, [entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur.')])
    expect(captionAt(one, nodeIds[0])).toBe(placeholderCaption(1))
    expect(captionAt(one, nodeIds[1])).toBe('')
  })

  it('avviser en oppføring som peker på noe annet enn en bildesone', () => {
    const { deck, slideId } = threeColumns()
    const missing = setImagePlan(deck, [entry(slideId, 'finnes-ikke', 'Et motiv.')])
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NODE_NOT_FOUND')
  })

  it.each(PLANNED_IMAGE_FIELDS)(
    'avviser et blankt «%s» nøyaktig når feltet er påkrevd',
    (field) => {
      // The general rule, not today's two field names: a blank value is refused
      // if and only if the field is in `REQUIRED_PLANNED_IMAGE_FIELDS`. Moving a
      // field into or out of that list changes what this test expects, which is
      // the only way a test can protect a rule rather than a snapshot of it.
      const required = REQUIRED_PLANNED_IMAGE_FIELDS.includes(field)
      const { deck, slideId, nodeIds } = threeColumns()
      for (const blank of ['', '   ', '\n\t']) {
        const written = setImagePlan(deck, [
          { ...entry(slideId, nodeIds[0], 'Et motiv.'), [field]: blank },
        ])
        expect(written.ok, `${field}: ${JSON.stringify(blank)}`).toBe(!required)
        if (!written.ok) expect(written.error.code).toBe('INVALID_ARGUMENT')
      }
    },
  )

  it('avviser to oppføringer på den samme sonen', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const twice = setImagePlan(deck, [
      entry(slideId, nodeIds[0], 'Ett motiv.'),
      entry(slideId, nodeIds[0], 'Et annet motiv.'),
    ])
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.error.code).toBe('INVALID_ARGUMENT')
  })

  it('skriver ingenting når planen som sendes inn er den som allerede står der', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    const again = setImagePlan(written, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value).toBe(written)
  })
})

describe('nummeret på sliden mot nummeret i briefen', () => {
  /** Two planned pictures, one per slide, so the deck's order is what numbers them. */
  function twoSlides() {
    const base = createPresentation({ title: 'To slides' })
    const first = createLeaf(createImage())
    const second = createLeaf(createImage())
    const deck: Presentation = {
      ...base,
      imageContext: CONTEXT,
      slides: [
        sectionAt(base, 0),
        { ...contentAt(base, 1), id: 's1', title: titleDoc('Først'), root: first },
        { ...contentAt(base, 1), id: 's2', title: titleDoc('Så'), root: second },
      ],
    }
    const written = planned(deck, [
      entry('s1', first.id, 'Australopithecus afarensis i helfigur.'),
      entry('s2', second.id, 'Homo erectus som bearbeider en steinøks.'),
    ])
    return { deck: written, first: first.id, second: second.id }
  }

  function captionOnAnySlide(deck: Presentation, nodeId: string): string | null {
    for (const slide of deck.slides) {
      if (slide.kind !== 'content' || slide.root.kind !== 'leaf') continue
      if (slide.root.id !== nodeId) continue
      const content = slide.root.content
      if (!content || !('image' in content)) return ''
      return content.image.caption ? docToPlainText(content.image.caption.doc) : ''
    }
    return null
  }

  it('melder fra når slidene er flyttet og plassholderne har blitt hengende igjen', () => {
    const { deck, first, second } = twoSlides()
    expect(captionOnAnySlide(deck, first)).toBe(placeholderCaption(1))

    // Dragging a slide in the filmstrip renumbers the brief — the numbering is
    // deck order — while the captions keep saying what they said. That is the
    // one way an author puts a generated file into the wrong zone.
    const moved = moveSlide(deck, 's2', 1)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    expect(resolveImagePlan(moved.value).map((image) => image.plan.nodeId)).toEqual([second, first])
    expect(captionOnAnySlide(moved.value, second)).toBe(placeholderCaption(2))

    const stale = checkImagePlan(moved.value).filter((issue) => issue.code === 'PLACEHOLDER_STALE')
    expect(stale.map((issue) => issue.nodeId).sort()).toEqual([first, second].sort())
  })

  it('rettes opp av én idempotent kommando', () => {
    const { deck, first, second } = twoSlides()
    const moved = moveSlide(deck, 's2', 1)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    const synced = syncImagePlaceholders(moved.value)
    expect(synced.ok).toBe(true)
    if (!synced.ok) return

    expect(captionOnAnySlide(synced.value, second)).toBe(placeholderCaption(1))
    expect(captionOnAnySlide(synced.value, first)).toBe(placeholderCaption(2))
    expect(checkImagePlan(synced.value)).toEqual([])

    // Idempotent: a deck already in line comes back untouched, so running it on
    // every open of the dialog cannot churn the document.
    const again = syncImagePlaceholders(synced.value)
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value).toBe(synced.value)
  })

  it('melder fra når plassholderen er slettet for hånd', () => {
    const { deck, first } = twoSlides()
    const removed = setImageCaption(deck, { slideId: 's1', nodeId: first, remove: true })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return

    // No command could have caught this one — which is why the check is asked
    // of the document rather than re-stamped inside the structural commands.
    const stale = checkImagePlan(removed.value).find((issue) => issue.code === 'PLACEHOLDER_STALE')
    expect(stale?.nodeId).toBe(first)
  })

  it('regner ikke en bildetekst forfatteren skrev som utdatert', () => {
    const { deck, first } = twoSlides()
    const authored = setImageCaption(deck, {
      slideId: 's1',
      nodeId: first,
      doc: titleDoc('Lucy, 3,2 millioner år'),
    })
    expect(authored.ok).toBe(true)
    if (!authored.ok) return
    expect(checkImagePlan(authored.value)).toEqual([])
  })
})

describe('den samlede briefen', () => {
  it('teller bildene i stedet for å oppgi et tall, og sier at de er separate', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur på savannen.'),
      entry(slideId, nodeIds[1], 'Homo erectus som bearbeider en steinøks.'),
    ])
    const brief = composeImageBrief(written) ?? ''

    expect(brief).toContain('Lag nøyaktig 2 separate bilder')
    expect(brief).toContain('Generer deretter alle 2 bildene som separate bilder.')
    expect(brief).toContain('Ikke kombiner flere nummer i samme bilde.')
    expect(brief).toMatch(/collage, kontaktark, storyboard/)
    // Exactly as many picture sections as pictures — the failure a written
    // count invites is a brief that says one number and lists another.
    expect(brief.match(/^BILDE \d+ AV 2$/gm)).toHaveLength(2)
  })

  it('oppgir aspect ratio per bilde, målt fra sonen', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    const image = resolveImagePlan(written)[0]
    const brief = composeImageBrief(written) ?? ''

    expect(brief).toContain(`Aspect ratio: ${image.aspectRatio} (${image.orientation})`)
    // One of three columns on a 1600×900 slide is upright, which is what a
    // prose description of «a reconstruction» would never have said.
    expect(image.orientation).toBe('stående')
  })

  it('trekker fra tittellinjen når bildet ligger i et kort med tittel', () => {
    const bare = createLeaf(createImage())
    const titled = createLeaf(createTitledImageCard())
    const deck = deckWith(createSplit('x', [1, 1], [bare, titled]))
    const slideId = deck.slides[1].id

    const written = planned(deck, [
      entry(slideId, bare.id, 'Et bart bilde av en steinøks.'),
      entry(slideId, titled.id, 'Et innrammet portrett av en neandertaler.'),
    ])
    const [first, second] = resolveImagePlan(written)
    // Same zone, different content kind: the card spends its header on a title
    // line, so the picture it holds is shorter than the bare one beside it.
    expect(second.frame.height).toBeLessThan(first.frame.height)
    expect(second.frame.width).toBe(first.frame.width)
  })

  it('bruker den felles konteksten som egen seksjon, og sier fra når den mangler', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    expect(composeImageBrief(written)).toContain(`FELLES BILDEKONTEKST\n${CONTEXT}`)

    const stripped = setImageContext(written, null)
    expect(stripped.ok).toBe(true)
    if (!stripped.ok) return
    expect(checkImagePlan(stripped.value).map((issue) => issue.code)).toContain('MISSING_CONTEXT')
    // The brief still generates: a deck being worked on is not a deck that
    // refuses to show what it has.
    expect(composeImageBrief(stripped.value)).toContain('FELLES BILDEKONTEKST')
  })

  it('skriver bare de seksjonene som faktisk sier noe', () => {
    // Derived from the same rule: every optional field is blanked, and the
    // brief must then print the required headings and none of the optional
    // ones. A heading over «(ikke beskrevet)» is an instruction to render
    // nothing in particular, and reads to the author as a defect in the brief.
    const optional = PLANNED_IMAGE_FIELDS.filter(
      (field) => !REQUIRED_PLANNED_IMAGE_FIELDS.includes(field),
    )
    expect(optional.length).toBeGreaterThan(0)

    const { deck, slideId, nodeIds } = threeColumns()
    const blanked = { ...entry(slideId, nodeIds[0], 'Nærbilde av en bearbeidet flintøks.') }
    for (const field of optional) blanked[field] = ''
    const brief = composeImageBrief(planned(deck, [blanked])) ?? ''

    for (const field of PLANNED_IMAGE_FIELDS) {
      const heading = `${PLANNED_IMAGE_SECTION_HEADINGS[field]}:`
      expect(brief.includes(heading), heading).toBe(!optional.includes(field))
    }
    expect(brief).not.toContain('ikke beskrevet')
  })

  it('er null når dekket ikke planlegger bilder', () => {
    const { deck } = threeColumns()
    expect(composeImageBrief(deck)).toBeNull()
  })
})

describe('kontrollene', () => {
  it('finner en bildesone som venter uten at noe i planen beskriver den', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])

    const missing = checkImagePlan(written).filter((issue) => issue.code === 'ZONE_NOT_PLANNED')
    expect(missing.map((issue) => issue.nodeId)).toEqual([nodeIds[1], nodeIds[2]])
  })

  it('finner en oppføring som peker på en sone som er blitt noe annet', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    // The tree moved under the plan — a deleted zone, a re-split slide.
    const slide = written.slides[1]
    if (slide.kind !== 'content') throw new Error('Forventet en innholdsslide')
    const orphaned: Presentation = {
      ...written,
      slides: [written.slides[0], { ...slide, root: createLeaf(null) }],
    }

    expect(checkImagePlan(orphaned).map((issue) => issue.code)).toContain('ZONE_GONE')
    // And the brief leaves it out rather than numbering a picture nobody can
    // place: a gap in the numbering is worse than one picture fewer.
    expect(resolveImagePlan(orphaned)).toEqual([])
    expect(composeImageBrief(orphaned)).toBeNull()
  })

  it('finner en oppføring hvis sone har sluttet å være en bildesone', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    const converted = setContentKind(written, { slideId, nodeId: nodeIds[0], kind: 'titled-card' })
    expect(converted.ok).toBe(true)
    if (!converted.ok) return

    expect(checkImagePlan(converted.value).map((issue) => issue.code)).toContain('ZONE_GONE')
    // And it is left out of the brief rather than described as a picture: a
    // text card in a list of motifs is worse than one picture fewer.
    expect(resolveImagePlan(converted.value)).toEqual([])
  })

  it('finner et motiv som er beskrevet i et annet format enn sonen har', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      {
        ...entry(slideId, nodeIds[0], 'Bredt panorama over riftdalen.'),
        composition: 'Liggende utsnitt, horisonten i nedre tredjedel.',
      },
    ])
    const mismatch = checkImagePlan(written).find((issue) => issue.code === 'ASPECT_MISMATCH')
    expect(mismatch?.number).toBe(1)
    expect(mismatch?.message).toMatch(/liggende/i)
  })

  it('leser ikke en positur eller en fasong som en formatpåstand', () => {
    // «stående», «liggende» and «kvadratisk» describe the *subject* at least as
    // often as the frame in Norwegian. Reading them as format claims turned a
    // standing figure in a wide zone into an error and told the agent to
    // rewrite the motif — backwards, and the kind of false positive that
    // teaches an agent to write vaguer prompts.
    const wide = wideZone()
    const upright = uprightZone()
    const cases: [OneZone, string, string][] = [
      [wide, 'Stående helfigur av Homo erectus på savannen.', 'Motivet midt i bildet.'],
      [upright, 'Liggende skjelett i utgravningsfeltet.', 'Sett ovenfra.'],
      [upright, 'Kvadratisk steinplate med hulemalerier.', 'Motivet fyller flaten.'],
    ]
    for (const [zone, subject, composition] of cases) {
      const written = planned(zone.deck, [
        { ...entry(zone.slideId, zone.nodeId, subject), composition },
      ])
      // The zone really is the shape the adjective would have contradicted.
      expect(resolveImagePlan(written)[0].orientation, subject).not.toBe(
        subject.startsWith('Stående') ? 'stående' : 'liggende',
      )
      expect(
        checkImagePlan(written).filter((issue) => issue.code === 'ASPECT_MISMATCH'),
        subject,
      ).toEqual([])
    }
  })

  it('leser fortsatt et uttrykkelig format som en formatpåstand', () => {
    // The adjective counts when it is attached to a word that means the
    // picture's own shape. That is the claim the check exists for.
    const wide = wideZone()
    const upright = uprightZone()
    const cases: [OneZone, string][] = [
      [wide, 'Stående utsnitt, hodet i øvre tredjedel.'],
      [wide, 'Portrettformat, hele figuren synlig.'],
      [upright, 'Liggende format, horisonten i nedre tredjedel.'],
      [upright, 'Bredformat over hele scenen.'],
      [upright, 'Kvadratisk utsnitt av flaten.'],
    ]
    for (const [zone, composition] of cases) {
      const written = planned(zone.deck, [
        { ...entry(zone.slideId, zone.nodeId, 'Et entydig motiv.'), composition },
      ])
      const mismatch = checkImagePlan(written).find((issue) => issue.code === 'ASPECT_MISMATCH')
      expect(mismatch, composition).toBeDefined()
    }
  })

  it('finner et forholdstall som er skrevet inn i teksten og ikke stemmer', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      {
        ...entry(slideId, nodeIds[0], 'Rekonstruksjon i 16:9.'),
        composition: 'Motivet sentrert.',
      },
    ])
    const mismatch = checkImagePlan(written).find((issue) => issue.code === 'ASPECT_MISMATCH')
    expect(mismatch?.message).toMatch(/16:9/)
  })

  it('lar et motiv som faktisk passer sonen stå i fred', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      {
        ...entry(slideId, nodeIds[0], 'Stående helfigur av Homo erectus.'),
        composition: 'Stående utsnitt, hodet i øvre tredjedel.',
      },
      entry(slideId, nodeIds[1], 'Nærbilde av en bearbeidet flintøks i hånden.'),
      entry(slideId, nodeIds[2], 'Kart over utbredelsen i Afrika og Eurasia.'),
    ])
    expect(checkImagePlan(written)).toEqual([])
  })

  it('finner to motiver som i praksis beskriver det samme bildet', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      entry(slideId, nodeIds[0], 'Vitenskapelig rekonstruksjon av Homo erectus i helfigur.'),
      entry(slideId, nodeIds[1], 'Vitenskapelig rekonstruksjon av Homo erectus i helfigur.'),
      entry(slideId, nodeIds[2], 'Kart over utbredelsen i Afrika og Eurasia.'),
    ])
    const duplicate = checkImagePlan(written).find((issue) => issue.code === 'NEAR_DUPLICATE')
    expect(duplicate?.number).toBe(2)
  })

  it('finner en felles kontekst som har overtatt motivet til ett enkelt bilde', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const subject = 'Vitenskapelig rekonstruksjon av Homo erectus i helfigur.'
    const withContext = setImageContext(deck, `${CONTEXT} ${subject}`)
    expect(withContext.ok).toBe(true)
    if (!withContext.ok) return

    const written = planned(withContext.value, [entry(slideId, nodeIds[0], subject)])
    expect(checkImagePlan(written).map((issue) => issue.code)).toContain('CONTEXT_OVERREACH')
  })
})

describe('plassholderteksten', () => {
  it('kjennes igjen uansett nummer, og aldri på noe forfatteren skrev', () => {
    expect(isPlaceholderCaption('Sett inn bilde 1 her')).toBe(true)
    expect(isPlaceholderCaption('  sett inn bilde 12 her ')).toBe(true)
    expect(isPlaceholderCaption('Sett inn bilde her')).toBe(false)
    expect(isPlaceholderCaption('Lucy, 3,2 millioner år')).toBe(false)
    expect(isPlaceholderCaption('Sett inn bilde 1 her, gjerne i farger')).toBe(false)
  })
})

describe('planen er dokumentdata, ikke publikumsdata', () => {
  it('validerer som en del av presentasjonen', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
    expect(validatePresentation(written).ok).toBe(true)
  })

  it.each(PLANNED_IMAGE_FIELDS)(
    'avvises ved persistensgrensen for et blankt «%s» nøyaktig når feltet er påkrevd',
    (field) => {
      // The other system boundary, held to the same derived rule. A `.slaids`
      // archive is a file a person can edit, so the schema has to refuse what
      // the command refuses — otherwise an imported deck could carry a plan the
      // normal write path would never have produced.
      const required = REQUIRED_PLANNED_IMAGE_FIELDS.includes(field)
      const { deck, slideId, nodeIds } = threeColumns()
      const written = planned(deck, [entry(slideId, nodeIds[0], 'Homo erectus i helfigur.')])
      for (const blank of ['', '   ']) {
        const tampered: Presentation = {
          ...written,
          imagePlan: [{ ...written.imagePlan![0], [field]: blank }],
        }
        const result = validatePresentation(JSON.parse(JSON.stringify(tampered)))
        expect(result.ok, `${field}: ${JSON.stringify(blank)}`).toBe(!required)
      }
    },
  )
})
