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
 *
 * And one thing the brief itself made possible, which the prompt closes: the
 * order for a single picture used to be reachable only as part of a *plan* —
 * «BILDE 3 AV 9», nine motifs in one message — so a generator could not be
 * handed one picture without being handed the set. `composeImageGenerationPrompt`
 * can see one entry, and the brief is now the internal, human-readable half.
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
import { IMAGE_FILE_EXTENSION_LIST } from './imageBytes'
import { reviewDepositFiles } from './imageDeposit'
import { validatePresentation } from './schema'
import { contentAt, sectionAt } from './testDecks'
import {
  aspectRatioLabel,
  checkImagePlan,
  composeImageBrief,
  composeImageGenerationContract,
  composeImageGenerationPrompt,
  isPlaceholderCaption,
  orientationOf,
  placeholderCaption,
  resolveImagePlan,
  IMAGE_PROMPT_SECTION_HEADINGS,
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

/**
 * A deck of `count` slides, each one full-slide picture zone.
 *
 * The many-picture case, and the one the generation contract exists for: a plan
 * big enough that the composed brief stops looking like an order for several
 * files and starts looking like one long prompt.
 */
function deckOfPictures(count: number): {
  deck: Presentation
  zones: { slideId: string; nodeId: string }[]
} {
  const base = createPresentation({ title: 'Menneskets evolusjon' })
  const template = contentAt(base, 1)
  const slides = Array.from({ length: count }, (_, index) => {
    const leaf = createLeaf(createImage())
    return {
      ...template,
      id: `bildeslide-${index + 1}`,
      title: titleDoc(`Bilde ${index + 1}`),
      root: leaf,
    }
  })
  return {
    deck: { ...base, imageContext: CONTEXT, slides: [sectionAt(base, 0), ...slides] },
    zones: slides.map((slide) => ({ slideId: slide.id, nodeId: slide.root.id })),
  }
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

/*
 * The brief, which is now the internal half.
 *
 * Everything below still holds — an author copies this text out of the editor's
 * brief dialog, and documentation and debugging read it — and it is precisely
 * because it counts the pictures, numbers them and lists every motif that it is
 * no longer what a generation call carries. See `prompten for ett bilde` below
 * for what does.
 */
describe('den samlede briefen', () => {
  it('teller bildene i stedet for å oppgi et tall, og sier at de er separate', () => {
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur på savannen.'),
      entry(slideId, nodeIds[1], 'Homo erectus som bearbeider en steinøks.'),
    ])
    const brief = composeImageBrief(written) ?? ''

    expect(brief).toContain('Lag nøyaktig 2 separate bilder')
    expect(brief).toContain('Generer deretter alle 2 bildene enkeltvis, ett kall per oppføring.')
    expect(brief).toContain('Ikke kombiner flere nummer i samme bilde.')
    expect(brief).toMatch(/collage, kontaktark, storyboard/)
    // Exactly as many picture sections as pictures — the failure a written
    // count invites is a brief that says one number and lists another.
    expect(brief.match(/^BILDE \d+ AV 2$/gm)).toHaveLength(2)
  })

  it('navngir hver oppføring med sin egen id og sitt eget filnavn', () => {
    // The brief is what an agent and a person actually read while the pictures
    // are being made, so the identity has to be *in* it — not only in the
    // structured half beside it. This is the line that makes «which entry is
    // this file for?» answerable from the text somebody pasted.
    const { deck, slideId, nodeIds } = threeColumns()
    const written = planned(deck, [
      entry(slideId, nodeIds[0], 'Australopithecus afarensis i helfigur på savannen.'),
      entry(slideId, nodeIds[1], 'Homo erectus som bearbeider en steinøks.'),
    ])
    const brief = composeImageBrief(written) ?? ''

    for (const image of resolveImagePlan(written)) {
      expect(brief).toContain(`Bildeplan-ID: ${image.id}`)
      expect(brief).toContain(`Filnavn: ${image.number}.<filendelse>`)
    }
    // And the one rule that makes the ids worth printing.
    expect(brief).toMatch(/Rekkefølgen bildene blir ferdige i/)
    expect(brief).toMatch(/Bruk aldri «det første bildet som kom tilbake» som bilde 1/)
    expect(brief).toMatch(/ETTER GENERERING/)
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

/*
 * The prompt one picture is generated from.
 *
 * The root cause this answers was not a missing warning. It was that the order
 * for one picture only existed inside a plan: the brief said «BILDE 3 AV 9» and
 * listed every motif, and the structured list handed the other entries over
 * beside this one — so a generator could not be given one picture without being
 * given the set, and the ordinary answer to a set is one merged image.
 *
 * Everything below is a property of one composed prompt: it says everything
 * that one picture needs, and nothing that implies a second one exists.
 */
describe('prompten for ett bilde', () => {
  /** Three planned pictures with distinguishable motifs, and their prompts. */
  function promptsFor(): { deck: Presentation; images: ReturnType<typeof resolveImagePlan>; prompts: string[] } {
    const { deck, zones } = deckOfPictures(3)
    const written = planned(deck, [
      entry(zones[0].slideId, zones[0].nodeId, 'Australopithecus afarensis i helfigur på savannen.'),
      entry(zones[1].slideId, zones[1].nodeId, 'Homo erectus som bearbeider en steinøks ved elven.'),
      entry(zones[2].slideId, zones[2].nodeId, 'Et neandertalerbarn foran en hulemaling i fakkellys.'),
    ])
    const images = resolveImagePlan(written)
    return {
      deck: written,
      images,
      prompts: images.map((image) => composeImageGenerationPrompt(image, written.imageContext ?? '')),
    }
  }

  it('inneholder alt det ene bildet trenger: stil, motiv, komposisjon, krav, unngå og format', () => {
    const { images, prompts } = promptsFor()
    const image = images[0]
    const prompt = prompts[0]

    expect(prompt).toContain('Lag ett bilde.')
    expect(prompt).toContain(`Stil og kvalitet:\n${CONTEXT}`)
    for (const field of PLANNED_IMAGE_FIELDS) {
      expect(prompt).toContain(`${IMAGE_PROMPT_SECTION_HEADINGS[field]}:\n${image.plan[field]}`)
    }
    // The format is the zone's own measurement, never prose about a shape.
    expect(prompt).toContain(`Aspect ratio ${image.aspectRatio} (${image.orientation})`)
    expect(prompt).toMatch(/Ett motiv i ett bilde/)
  })

  it('nevner ikke et eneste av de andre bildene', () => {
    // The isolation itself, asserted the only way that means anything: the
    // other entries' motifs are absent from this entry's prompt.
    const { images, prompts } = promptsFor()
    prompts.forEach((prompt, index) => {
      images.forEach((other, otherIndex) => {
        if (otherIndex === index) return
        expect(prompt).not.toContain(other.plan.subject)
        expect(prompt).not.toContain(other.id)
      })
    })
  })

  it('sier ikke hvilket nummer bildet har, hvor det skal, eller at det finnes flere', () => {
    const { images, prompts } = promptsFor()
    prompts.forEach((prompt, index) => {
      const image = images[index]
      // The bookkeeping belongs beside the call: an id, a number, a file name,
      // a slide and a deck are all things the agent needs and the generator
      // must not be told, because each of them says «one of several».
      expect(prompt).not.toContain(image.id)
      expect(prompt).not.toContain(image.slideLabel)
      expect(prompt).not.toContain(`${image.fileNameStem}.`)
      expect(prompt).not.toMatch(/bilde \d/i)
      expect(prompt).not.toMatch(/\bslide\b/i)
      expect(prompt).not.toMatch(/presentasjon/i)
      expect(prompt).not.toMatch(/Bildeplan-ID/)
      expect(prompt).not.toMatch(/\d+ separate bilder/i)
      expect(prompt).not.toMatch(/felles/i)
    })
  })

  it('kaller ikke «unngå» for noe som gjelder akkurat dette bildet blant andre', () => {
    // The brief's own heading is «Unngå i akkurat dette bildet», which only
    // means something beside the other entries. In a prompt that is the only
    // picture there is, «akkurat dette» is a reference to the others.
    const { prompts } = promptsFor()
    expect(PLANNED_IMAGE_SECTION_HEADINGS.avoid).toContain('akkurat dette bildet')
    expect(IMAGE_PROMPT_SECTION_HEADINGS.avoid).toBe('Unngå')
    for (const prompt of prompts) expect(prompt).not.toContain('akkurat dette bildet')
  })

  it('skriver bare de seksjonene som faktisk sier noe', () => {
    // Same rule as the brief's, and for the same reason: a heading over silence
    // is an instruction to render nothing in particular.
    const optional = PLANNED_IMAGE_FIELDS.filter(
      (field) => !REQUIRED_PLANNED_IMAGE_FIELDS.includes(field),
    )
    expect(optional.length).toBeGreaterThan(0)

    const { deck, zones } = deckOfPictures(1)
    const blanked = { ...entry(zones[0].slideId, zones[0].nodeId, 'Nærbilde av en flintøks.') }
    for (const field of optional) blanked[field] = ''
    const written = planned(deck, [blanked])
    const prompt = composeImageGenerationPrompt(
      resolveImagePlan(written)[0],
      written.imageContext ?? '',
    )

    for (const field of PLANNED_IMAGE_FIELDS) {
      const heading = `${IMAGE_PROMPT_SECTION_HEADINGS[field]}:`
      expect(prompt.includes(heading), heading).toBe(!optional.includes(field))
    }
  })

  it('utelater stilseksjonen helt når dekket ikke har noen felles kontekst', () => {
    // A plan without a context is `MISSING_CONTEXT`, which is the plan's own
    // finding. The prompt must not turn it into a sentence about a missing
    // brief, which is what the brief does for its author.
    const { deck, zones } = deckOfPictures(1)
    const written = planned(
      { ...deck, imageContext: undefined },
      [entry(zones[0].slideId, zones[0].nodeId, 'Nærbilde av en flintøks.')],
    )
    const prompt = composeImageGenerationPrompt(
      resolveImagePlan(written)[0],
      written.imageContext ?? '',
    )
    expect(prompt).not.toContain('Stil og kvalitet')
    expect(prompt).not.toMatch(/Ingen felles bildekontekst/i)
    expect(prompt).toContain('Nærbilde av en flintøks.')
  })

  it('følger formatet til sin egen sone, ikke et format flere bilder deler', () => {
    // Two zones on one slide with different shapes: each prompt states its own
    // measurement, which is the whole reason the format is not prose.
    const bare = createLeaf(createImage())
    const titled = createLeaf(createTitledImageCard())
    const deck = deckWith(createSplit('x', [3, 1], [bare, titled]))
    const slideId = deck.slides[1].id
    const written = planned(deck, [
      entry(slideId, bare.id, 'En vid savannescene i morgenlys.'),
      entry(slideId, titled.id, 'Et portrett av en neandertaler.'),
    ])
    const images = resolveImagePlan(written)
    const prompts = images.map((image) =>
      composeImageGenerationPrompt(image, written.imageContext ?? ''),
    )
    expect(images[0].aspectRatio).not.toBe(images[1].aspectRatio)
    expect(prompts[0]).toContain(`Aspect ratio ${images[0].aspectRatio}`)
    expect(prompts[1]).toContain(`Aspect ratio ${images[1].aspectRatio}`)
    expect(prompts[0]).not.toContain(`Aspect ratio ${images[1].aspectRatio}`)
  })
})

describe('bildeplanen som genereringskontrakt', () => {
  /** The plan, written across `count` one-picture slides. */
  function contractFor(count: number) {
    const { deck, zones } = deckOfPictures(count)
    const written = planned(
      deck,
      zones.map((zone, index) =>
        entry(zone.slideId, zone.nodeId, `Rekonstruksjon nummer ${index + 1}, et eget motiv.`),
      ),
    )
    const contract = composeImageGenerationContract(written)
    if (!contract) throw new Error('Forventet en genereringskontrakt')
    return { written, contract }
  }

  it('beskriver ett bilde som én genereringsjobb', () => {
    const { contract } = contractFor(1)
    expect(contract.expectedFileCount).toBe(1)
    expect(contract.rule).toMatch(/ett kall til bildegeneratoren, ett motiv, én aspect ratio, én bildefil/i)
    expect(contract.rule).toMatch(/bare den ene oppføringens ferdige `prompt`/i)
  })

  it('gjør åtte planlagte bilder til åtte selvstendige genereringsjobber', () => {
    // The observed failure, stated as a number: eight entries came back as one
    // storyboard. The count is still what a finished delivery is measured
    // against — but it is stated as a check, never as the task, because an
    // agent that repeats «eight pictures» to a generator has handed it a set.
    const { written, contract } = contractFor(8)
    expect(contract.expectedFileCount).toBe(8)
    expect(contract.rule).toMatch(/hver oppføring i `images` er én selvstendig bildegenereringsoppgave/i)
    expect(contract.rule).toMatch(
      /`expectedFileCount` er tallet den ferdige leveransen kontrolleres mot, ikke noe som skal sies i samtalen/i,
    )
    // The multi-picture framing the rule used to open with is gone: nothing
    // hands the executing agent a count to pass on.
    expect(contract.rule).not.toMatch(/Lag nøyaktig 8 separate bilder/i)
    expect(contract.rule).not.toMatch(/kalles 8 ganger/i)
    // The entries are the jobs: one per file, numbered 1‥8 in deck order.
    expect(resolveImagePlan(written).map((image) => image.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it('teller nøyaktig like mange filer som planen har oppføringer', () => {
    // Derived from one array in one module, so the contract and the brief
    // cannot disagree about how many pictures a finished delivery has.
    for (const count of [1, 2, 8, 12]) {
      const { written, contract } = contractFor(count)
      expect(contract.expectedFileCount).toBe(count)
      expect(contract.expectedFileCount).toBe(resolveImagePlan(written).length)
      expect(contract.beforeDeposit.join(' ')).toContain(`nøyaktig ${count} separate bildefiler`)
      expect(contract.beforeDeposit.join(' ')).toContain(`Numrene 1‥${count}`)
    }
  })

  it('sier at ett samlet bilde aldri teller som flere, uansett hvor mange motiv det har', () => {
    // A generator handed the whole brief still answers, and the answer still
    // looks like a success — so the check has to be about the files.
    const checks = contractFor(8).contract.beforeDeposit.join(' ')
    expect(checks).toMatch(/collage-, storyboard-, kontaktark-, split-screen- eller infografikkbilde/i)
    expect(checks).toMatch(/teller aldri som flere bilder/i)
    expect(checks).toMatch(/generer de manglende bildene enkeltvis før deponering/i)
  })

  it('henter instruksen for ett bilde fra oppføringen alene', () => {
    // Test 2 of the isolation work: one generation call carries the entry and
    // the deck's shared context, and nothing else — no other entry, no part of
    // the rest of the plan.
    const { contract } = contractFor(3)
    for (const field of PLANNED_IMAGE_FIELDS) {
      expect(contract.perImageInstruction).toContain(
        IMAGE_PROMPT_SECTION_HEADINGS[field].toLowerCase(),
      )
    }
    expect(contract.perImageInstruction).toMatch(/oppføringens egen `prompt`/i)
    expect(contract.perImageInstruction).toMatch(/felles bildekontekst/i)
    expect(contract.perImageInstruction).toMatch(/bare denne oppføringens egne felter/i)
    expect(contract.perImageInstruction).toMatch(
      /Ingen annen oppføring, ingen del av resten av planen/i,
    )
    // The bookkeeping travels beside the call, never inside it: the prompt has
    // no id, no number and no file name in it, and does not need one.
    expect(contract.perImageInstruction).toMatch(/din egen bokføring ved siden av kallet/i)
  })

  it('markerer den samlede briefen som intern, ikke som et steg', () => {
    // Test 4: the brief may be kept — the editor's dialog and debugging read
    // it — but it is labelled for what it is, so it cannot come back as the
    // first step of generation.
    const { contract } = contractFor(3)
    expect(contract.briefRole).toMatch(/^Intern\./)
    expect(contract.briefRole).toMatch(/dokumentasjon, for feilsøking og for manuell kopiering/i)
    expect(contract.briefRole).toMatch(/ikke et steg i normalflyten/i)
    expect(contract.briefRole).toMatch(/ikke en bildegenereringsprompt/i)
    expect(contract.briefRole).toMatch(/skal ikke skrives ut i samtalen/i)
    expect(contract.briefRole).toMatch(/Bruk `prompt` på den ene oppføringen i stedet/i)
  })

  it('holder flerbildekonteksten ute av samtalen rundt kallet', () => {
    // The root cause this closes: the prompts were already separate, and the
    // conversation around them was not. An agent that prints the brief, lists
    // the motifs or announces «nå lager jeg de ni bildene» has told the
    // generator the task is a set, whatever the next prompt says.
    const { contract } = contractFor(9)
    expect(contract.isolation).toMatch(/fullstendig selvstendig oppgave/i)
    expect(contract.isolation).toMatch(/ikke skriv en innledning/i)
    expect(contract.isolation).toMatch(/en oppsummering av bildeplanen/i)
    expect(contract.isolation).toMatch(/en punktliste over bildene/i)
    expect(contract.isolation).toMatch(/en opptelling/i)
    expect(contract.isolation).toMatch(/«nå går jeg videre til neste bilde»/i)
    expect(contract.isolation).toMatch(/Ikke skriv ut `brief`/i)
    expect(contract.isolation).toMatch(/nøytral og ikke røpe at flere bilder er planlagt/i)
    // And it is named as the main mechanism rather than as etiquette around
    // the warnings, which is the point of the change.
    expect(contract.isolation).toMatch(/hovedgrepet mot sammenslåtte bilder/i)
  })

  it('sier hvordan én oppføring behandles av gangen, og at rekkefølgen ikke er identitet', () => {
    // The sequencing half of the fix. The observed failure was not a step done
    // wrong — every generation call was correct — it was the *binding* being
    // left until after all of them, when there was nothing left to bind from.
    const { contract } = contractFor(9)
    const steps = contract.perImageSteps.join(' ')
    expect(contract.perImageSteps.length).toBeGreaterThan(3)
    expect(steps).toMatch(/stigende `number`/)
    expect(steps).toMatch(/Kall bildegeneratoren nøyaktig én gang, med bare denne teksten/)
    expect(steps).toMatch(/med en gang, før noe annet gjøres/)
    expect(steps).toMatch(/ikke et løpenummer for genereringen/)
    expect(steps).toMatch(/til ingen står igjen/)

    expect(contract.orderIsNotIdentity).toMatch(/ikke en identitetskilde/)
    expect(contract.orderIsNotIdentity).toMatch(/`imagePlanItemId`/)
    expect(contract.orderIsNotIdentity).toMatch(/aldri bilde 1/)
  })

  it('sier ingenting om andre bilder i teksten for ett enkelt bilde', () => {
    // Test 3, as a property of every single-generation text there is: the
    // composed prompt, the instruction for one picture, and the loop's own
    // steps. A phrase from this list in any of them is the multi-picture
    // context reaching the one place it must never reach.
    const { written, contract } = contractFor(9)
    const singles = [
      ...resolveImagePlan(written).map((image) =>
        composeImageGenerationPrompt(image, written.imageContext ?? ''),
      ),
      contract.perImageInstruction,
      ...contract.perImageSteps,
    ]
    const forbidden = [
      /bilde \d+ av \d+/i,
      /generer (deretter )?alle( de)? \d* ?bildene/i,
      /neste bilde i serien/i,
      /samlede? brief/i,
      /\bserie\b/i,
      /\bsettet?\b/i,
      /\bpakke\b/i,
      /\d+ separate bilder/i,
    ]
    for (const text of singles) {
      for (const pattern of forbidden) {
        expect(text, `«${pattern}» i «${text.slice(0, 80)}…»`).not.toMatch(pattern)
      }
    }
  })

  it('kontrollerer koblingen, ikke bare antallet, før deponering', () => {
    const checks = contractFor(9).contract.beforeDeposit.join(' ')
    expect(checks).toMatch(/`imagePlanItemId`/)
    expect(checks).toMatch(/brukt nøyaktig én gang/)
    expect(checks).toMatch(/ikke bildets plass i genereringsrekkefølgen/)
    expect(contractFor(9).contract.perImageInstruction).toMatch(/`imagePlanItemId`/)
  })

  it('navngir filene med bildets eget nummer, med deponeringens egne filendelser', () => {
    // The numbering is what ties «bilde 3» to the zone it was ordered for, so
    // it has to survive the trip back as the file's own name.
    const { contract } = contractFor(8)
    expect(contract.fileNamePattern).toBe('<nummer>.<filendelse>')
    expect(contract.fileExtensions).toBe(IMAGE_FILE_EXTENSION_LIST)
    expect(contract.fileExtensions).toContain('png')
  })

  it('er det samme tallet deponeringen slipper filer inn mot', () => {
    // The count is not advice: the deposit already refuses anything but 1‥N,
    // so one storyboard handed back as `1.png` is one file and one file is not
    // eight pictures. What the contract adds is that the executing agent can
    // see that before it gets there.
    const { written, contract } = contractFor(8)
    expect(written.imageDeposit?.expectedCount).toBe(contract.expectedFileCount)

    const collage = reviewDepositFiles(['1.png'], contract.expectedFileCount)
    expect(collage.ready).toBe(false)
    expect(collage.missing).toEqual([2, 3, 4, 5, 6, 7, 8])

    const complete = Array.from(
      { length: contract.expectedFileCount },
      (_, index) => `${index + 1}.png`,
    )
    expect(reviewDepositFiles(complete, contract.expectedFileCount).ready).toBe(true)
  })

  it('genererer fortsatt den samlede briefen ved siden av kontrakten', () => {
    // The brief is still generated, as the internal, human-readable half: the
    // editor's dialog, documentation and debugging read it, and it still counts
    // the same pictures. What changed is who reads it — see `briefRole`.
    const { written, contract } = contractFor(8)
    const brief = composeImageBrief(written) ?? ''
    expect(brief).toContain('Lag nøyaktig 8 separate bilder')
    expect(brief).toContain('Hvert nummer nedenfor er én selvstendig bildefil.')
    expect(brief).toMatch(/collage, kontaktark, storyboard/)
    expect(brief.match(/^BILDE \d+ AV 8$/gm)).toHaveLength(contract.expectedFileCount)
  })

  it('er null nøyaktig når briefen er det', () => {
    const { deck } = deckOfPictures(3)
    expect(composeImageBrief(deck)).toBeNull()
    expect(composeImageGenerationContract(deck)).toBeNull()
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
