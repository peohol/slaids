/**
 * The binding between a planned picture and the file made for it.
 *
 * Everything here is one observed failure, stated as tests. Slaids planned nine
 * pictures for a deck about linen — såing, høsting, røyting, bråking, hegling,
 * spinning, veving, vasking, ferdig lin — and asked for them in that order. The
 * image generator produced them in the order 1, 3, 9, 6, 5, 8, 2, 4, 7, the
 * files were named `1`‥`9` **by the order they came back in**, and seven of nine
 * pictures went onto a slide they were never made for. Nothing in the flow could
 * tell that apart from success: the plan was right, the count was right, the
 * names were well-formed, and the deposit placed exactly what it was handed.
 *
 * So the tests come in two kinds, and both are needed:
 *
 *  - **the right thing still works out of order.** A generator that answers
 *    C, A, D, B still produces `1.png = A`, `2.png = B`, `3.png = C`,
 *    `4.png = D`, because the file is named from the plan entry it was
 *    generated from rather than from its place in the queue.
 *  - **the wrong thing is now caught.** The exact code that produced the
 *    failure — name the files in arrival order — is written out here and has to
 *    be refused. A test that only asserted the happy path would pass against
 *    the broken implementation too.
 *
 * Two further failures are asserted here because consistent metadata is not the
 * same thing as correct files, and neither is visible to any check that only
 * reads records:
 *
 *  - **swapped contents under unchanged names.** Build a correct manifest for
 *    two genuinely different image files, then exchange the bytes behind
 *    `1.png` and `2.png`. Every id, number, zone and name still agrees. Only
 *    the files' own digests disagree, so the digests are what the tests below
 *    use real image bytes to check.
 *  - **an order that moved under finished pictures.** `composition`,
 *    `requirements`, `avoid`, the deck's shared context and the measured aspect
 *    ratio are all part of what a generator was told, so each of them has to
 *    invalidate a binding on its own — while an edit a generator was never told
 *    about must not.
 */

import { describe, expect, it } from 'vitest'
import { hashBytes } from './assetHash'
import { setImagePlan, syncImagePlaceholders } from './commands/imagePlan'
import { setImageContext } from './commands/slides'
import { setSplitWeights } from './commands/layout'
import { createImage } from './content'
import {
  checkGeneratedImages,
  composeImageGenerationManifest,
  expectedGeneratedImages,
  imageBindingCheck,
  IMAGE_MANIFEST_FILE_NAME,
  isImageManifestFileName,
  manifestPresentationIssue,
  parseImageGenerationManifest,
  type DeliveredImageFile,
  type GeneratedImageRecord,
} from './imageGeneration'
import { resolveImagePlan } from './imagePlan'
import { createLeaf, createSplit } from './layout'
import { createPresentation } from './presentation'
import { titleDoc } from './richdoc'
import { contentAt, sectionAt } from './testDecks'
import { realImages } from './testImages'
import type { ContentSlide, DeckSlides, PlannedImage, Presentation } from './types'

const CONTEXT = 'Fotorealistiske rekonstruksjoner, naturlig dagslys, ingen tekst i bildene.'

/** The four motifs, in the order the deck asks for them. */
const MOTIFS = [
  { label: 'A', subject: 'Såing av linfrø i nypløyd åker om våren.' },
  { label: 'B', subject: 'Høsting av moden lin som rykkes opp med rota.' },
  { label: 'C', subject: 'Røyting av linstrå i et grunt vann over flere uker.' },
  { label: 'D', subject: 'Hegling av linfibre gjennom en tett jernkam.' },
] as const

type Label = (typeof MOTIFS)[number]['label']

interface Deck {
  deck: Presentation
  /** The zone each motif was planned for, addressed by its label. */
  zones: Record<Label, { slideId: string; nodeId: string }>
}

/**
 * One picture zone per content slide, in the order the motifs are listed.
 *
 * A slide each rather than four zones on one, so the numbering is deck order
 * and nothing about the tree can make two orderings plausible: the picture
 * called 3 is the one on the third picture slide, full stop.
 */
function deckOfFour(): Deck {
  const base = createPresentation({ title: 'Fra lin til lerret' })
  const leaves = MOTIFS.map(() => createLeaf(createImage()))
  const template = contentAt(base, 1)
  const slides: DeckSlides = [
    sectionAt(base, 0),
    ...MOTIFS.map(
      (motif, index): ContentSlide => ({
        ...template,
        id: `s_${index + 1}`,
        title: titleDoc(motif.label),
        root: leaves[index],
      }),
    ),
  ]
  const deck: Presentation = { ...base, imageContext: CONTEXT, slides }
  const planned = setImagePlan(
    deck,
    MOTIFS.map((motif, index) => ({
      slideId: slides[index + 1].id,
      nodeId: leaves[index].id,
      subject: motif.subject,
      composition: 'Motivet sentrert i rolig omgivelse, naturlig øyehøyde.',
      requirements: '',
      avoid: '',
    })),
  )
  if (!planned.ok) throw new Error(planned.error.message)
  return {
    deck: planned.value,
    zones: Object.fromEntries(
      MOTIFS.map((motif, index) => [
        motif.label,
        { slideId: slides[index + 1].id, nodeId: leaves[index].id },
      ]),
    ) as Deck['zones'],
  }
}

/**
 * The plan entry for one motif, by the label the test speaks in.
 *
 * By position, because the deck is built one picture slide per motif in the
 * order `MOTIFS` lists them — so label A is deck-order 1 whatever its motif text
 * has been edited to since. Looking it up by subject would stop working in
 * exactly the tests that edit a subject on purpose.
 */
function entryFor(deck: Presentation, label: Label) {
  const position = MOTIFS.findIndex((motif) => motif.label === label)
  const found = resolveImagePlan(deck)[position]
  if (!found) throw new Error(`No plan entry for ${label}`)
  return found
}

/**
 * A generator that answers in whatever order it likes, and an agent that binds
 * each answer to the entry it generated it from.
 *
 * This is the correct implementation, written out as the thing under test: the
 * file name comes from `entry.fileNameStem`, so the order of `order` cannot
 * reach it.
 */
function generateBound(deck: Presentation, order: readonly Label[]): GeneratedImageRecord[] {
  return order.map((label) => {
    const entry = entryFor(deck, label)
    return {
      imagePlanItemId: entry.id,
      number: entry.number,
      slideId: entry.plan.slideId,
      nodeId: entry.plan.nodeId,
      fileName: `${entry.fileNameStem}.png`,
    }
  })
}

/**
 * The failure itself: files named by the order they came back in.
 *
 * Kept as executable code rather than described in a comment, because it is the
 * only way to assert that the check would have caught the original bug. The one
 * line that matters is `${index + 1}.png`.
 */
function generateByArrival(deck: Presentation, order: readonly Label[]): GeneratedImageRecord[] {
  return order.map((label, index) => {
    const entry = entryFor(deck, label)
    return {
      imagePlanItemId: entry.id,
      number: index + 1,
      slideId: entry.plan.slideId,
      nodeId: entry.plan.nodeId,
      fileName: `${index + 1}.png`,
    }
  })
}

/** Which file each motif ended up in, which is the only thing that matters. */
function fileByMotif(records: readonly GeneratedImageRecord[], deck: Presentation) {
  return Object.fromEntries(
    records.map((record) => {
      const motif = resolveImagePlan(deck).find((image) => image.id === record.imagePlanItemId)
      return [motif?.plan.subject ?? record.imagePlanItemId, record.fileName]
    }),
  )
}

/**
 * Two genuinely different pictures, as bytes.
 *
 * Real encoder output rather than two byte arrays assembled here, for the same
 * reason `testImages.ts` exists at all: the scenario under test is two *files*
 * whose contents were exchanged, and a fixture that is not a file would leave
 * the test proving something about strings.
 */
const PICTURES: Record<Label, () => Uint8Array> = {
  A: realImages.png,
  B: realImages.jpeg,
  C: realImages.webp,
  D: realImages.gif,
}

/** The files as the deposit receives them: a name, and a digest of the bytes. */
async function deliver(
  contents: readonly { fileName: string; bytes: Uint8Array }[],
): Promise<DeliveredImageFile[]> {
  return Promise.all(
    contents.map(async (file) => ({
      fileName: file.fileName,
      contentHash: await hashBytes(file.bytes),
    })),
  )
}

/** A bound delivery: the records the agent wrote, and the files it hands over. */
async function generateFiles(
  deck: Presentation,
  order: readonly Label[],
): Promise<{ records: GeneratedImageRecord[]; delivered: DeliveredImageFile[] }> {
  const named = order.map((label) => ({
    label,
    entry: entryFor(deck, label),
    bytes: PICTURES[label](),
  }))
  const records = await Promise.all(
    named.map(async (file) => ({
      imagePlanItemId: file.entry.id,
      number: file.entry.number,
      slideId: file.entry.plan.slideId,
      nodeId: file.entry.plan.nodeId,
      fileName: `${file.entry.fileNameStem}.png`,
      /* Taken from the bytes this generation call returned, which is the whole
         point: a digest taken later, from the folder, would agree with whatever
         mix-up had happened in between. */
      contentHash: await hashBytes(file.bytes),
    })),
  )
  const delivered = await deliver(
    named.map((file) => ({ fileName: `${file.entry.fileNameStem}.png`, bytes: file.bytes })),
  )
  return { records, delivered }
}

const SCRAMBLED: readonly Label[] = ['C', 'A', 'D', 'B']

describe('bildeplanens stabile identitet', () => {
  it('gir hver oppføring en id som overlever at planen leses på nytt', () => {
    const { deck } = deckOfFour()
    const first = expectedGeneratedImages(deck)
    const second = expectedGeneratedImages(deck)
    expect(first).toEqual(second)
    expect(new Set(first.map((item) => item.imagePlanItemId)).size).toBe(4)
    for (const item of first) expect(item.imagePlanItemId).toMatch(/^imgplan_[0-9a-f]{16}$/)
  })

  it('binder id-en til dekket, sonen, nummeret og motivet', () => {
    // Each of the five facts the id is derived from changes it, and that is the
    // point: an id that survived a rewritten motif would vouch for a picture
    // generated from a brief the deck no longer holds.
    const { deck, zones } = deckOfFour()
    const original = entryFor(deck, 'A').id

    const otherDeck = { ...deck, id: `${deck.id}x` }
    expect(entryFor(otherDeck, 'A').id).not.toBe(original)

    const rewritten = setImagePlan(
      deck,
      (deck.imagePlan ?? []).map((entry) =>
        entry.nodeId === zones.A.nodeId ? { ...entry, subject: 'Et helt annet motiv, tydelig ulikt.' } : entry,
      ),
    )
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    expect(resolveImagePlan(rewritten.value)[0].id).not.toBe(original)
  })

  it('er upåvirket av en rettet skrivefeil i motivet', () => {
    // Normalised, so «fixed a capital letter» is not «a different picture». The
    // distinction has to hold in both directions or the check becomes noise
    // that agents learn to work around.
    const { deck, zones } = deckOfFour()
    const before = entryFor(deck, 'B').id
    const retyped = setImagePlan(
      deck,
      (deck.imagePlan ?? []).map((entry) =>
        entry.nodeId === zones.B.nodeId
          ? { ...entry, subject: `  ${entry.subject.toUpperCase()}  ` }
          : entry,
      ),
    )
    if (!retyped.ok) throw new Error(retyped.error.message)
    expect(entryFor(retyped.value, 'B').id).toBe(before)
  })
})

describe('genereringsrekkefølge er ikke identitet', () => {
  it('plasserer riktig motiv i riktig fil når generatoren svarer i en annen rekkefølge', () => {
    const { deck } = deckOfFour()
    const records = generateBound(deck, SCRAMBLED)

    expect(checkGeneratedImages(deck, records)).toEqual([])
    // The whole point, spelled out: plan 1=A, 2=B, 3=C, 4=D and a generator
    // that answered C, A, D, B still ends with A in `1.png`.
    expect(fileByMotif(records, deck)).toEqual({
      [MOTIFS[0].subject]: '1.png',
      [MOTIFS[1].subject]: '2.png',
      [MOTIFS[2].subject]: '3.png',
      [MOTIFS[3].subject]: '4.png',
    })
  })

  it('holder i alle rekkefølger, ikke bare den ene som ble observert', () => {
    const { deck } = deckOfFour()
    const orders: Label[][] = [
      ['A', 'B', 'C', 'D'],
      ['D', 'C', 'B', 'A'],
      ['B', 'D', 'A', 'C'],
      ['C', 'B', 'D', 'A'],
    ]
    for (const order of orders) {
      const records = generateBound(deck, order)
      expect(checkGeneratedImages(deck, records)).toEqual([])
      for (const record of records) {
        const entry = resolveImagePlan(deck).find((image) => image.id === record.imagePlanItemId)
        expect(record.fileName).toBe(`${entry?.number}.png`)
      }
    }
  })

  it('avviser den opprinnelige feilen: filnavn etter genereringsrekkefølge', () => {
    // `${index + 1}.png`. This is the assertion that would have failed before
    // the binding existed, and the reason the happy path above is not enough.
    const { deck } = deckOfFour()
    const issues = checkGeneratedImages(deck, generateByArrival(deck, SCRAMBLED))
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.map((issue) => issue.code)).toContain('NUMBER_MISMATCH')
  })

  it('godtar en korrekt rekkefølge også når den er tilfeldig generert', () => {
    const { deck } = deckOfFour()
    const labels: Label[] = ['A', 'B', 'C', 'D']
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const shuffled = [...labels].sort(() => Math.random() - 0.5)
      expect(checkGeneratedImages(deck, generateBound(deck, shuffled))).toEqual([])
    }
  })
})

describe('kontrollen før deponering', () => {
  it('melder en oppføring som er generert to ganger', () => {
    const { deck } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    const issues = checkGeneratedImages(deck, [...records, records[2]])
    expect(issues.map((issue) => issue.code)).toContain('DUPLICATE_ITEM')
  })

  it('melder et bilde som ikke er generert', () => {
    const { deck } = deckOfFour()
    const issues = checkGeneratedImages(deck, generateBound(deck, ['A', 'B', 'D']))
    const missing = issues.filter((issue) => issue.code === 'MISSING_ITEM')
    expect(missing).toHaveLength(1)
    expect(missing[0].number).toBe(3)
  })

  it('melder et bilde planen ikke har bedt om', () => {
    const { deck } = deckOfFour()
    const extra: GeneratedImageRecord = {
      imagePlanItemId: 'imgplan_0123456789abcdef',
      number: 5,
      slideId: 's_9',
      nodeId: 'n_9',
      fileName: '5.png',
    }
    const issues = checkGeneratedImages(deck, [...generateBound(deck, ['A', 'B', 'C', 'D']), extra])
    expect(issues.map((issue) => issue.code)).toContain('UNKNOWN_ITEM')
  })

  it('melder riktig antall med feil id', () => {
    // Four files, numbers 1‥4, nothing missing and nothing extra *by count* —
    // and one of them carries an id no entry has. A check that only counted
    // would call this a finished delivery.
    const { deck } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    const forged = 'imgplan_ffffffffffffffff'
    records[3] = { ...records[3], imagePlanItemId: forged }

    const issues = checkGeneratedImages(deck, records)
    expect(records).toHaveLength(4)
    expect(issues.some((issue) => issue.imagePlanItemId === forged)).toBe(true)
    // And the picture that id was standing in for is reported as not generated.
    const missing = issues.filter((issue) => issue.code === 'MISSING_ITEM')
    expect(missing.map((issue) => issue.number)).toEqual([4])
  })

  it('melder en id som peker på en annen sone enn planen', () => {
    const { deck, zones } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    records[0] = { ...records[0], nodeId: zones.D.nodeId }
    expect(checkGeneratedImages(deck, records).map((issue) => issue.code)).toContain('ZONE_MISMATCH')
  })

  it('melder et filnavn som ikke er oppføringens nummer', () => {
    const { deck } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    records[1] = { ...records[1], fileName: 'bilde2.png' }
    expect(checkGeneratedImages(deck, records).map((issue) => issue.code)).toContain(
      'FILE_NAME_MISMATCH',
    )
  })

  it('skiller en endret plan fra en ukjent id', () => {
    // Two ways for an id to stop resolving, and they need different answers: a
    // plan that moved under finished pictures is «generate these again», and an
    // id from nowhere is «these files are not this deck's».
    const { deck, zones } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    const rewritten = setImagePlan(
      deck,
      (deck.imagePlan ?? []).map((entry) =>
        entry.nodeId === zones.C.nodeId
          ? { ...entry, subject: 'Røyting erstattet av tørking på stubbåker.' }
          : entry,
      ),
    )
    if (!rewritten.ok) throw new Error(rewritten.error.message)
    const issues = checkGeneratedImages(rewritten.value, records)
    expect(issues.map((issue) => issue.code)).toContain('PLAN_CHANGED')
    expect(issues.find((issue) => issue.code === 'PLAN_CHANGED')?.message).toMatch(/endret seg/)
  })

  it('krysser koblingene mot filene som faktisk er levert', async () => {
    const { deck } = deckOfFour()
    const records = generateBound(deck, ['A', 'B', 'C', 'D'])
    const short = await deliver(
      ['1.png', '2.png', '3.png'].map((fileName) => ({ fileName, bytes: realImages.png() })),
    )
    const stray = await deliver([{ fileName: 'ekstra.png', bytes: realImages.gif() }])
    const issues = checkGeneratedImages(deck, records, [...short, ...stray])
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['FILE_MISSING', 'FILE_UNACCOUNTED']),
    )

    const complete = await deliver(
      ['1.png', '2.png', '3.png', '4.png'].map((fileName) => ({
        fileName,
        bytes: realImages.png(),
      })),
    )
    // Records without digests: consistent, complete, and therefore no issues —
    // which is exactly why the level below is reported beside them.
    expect(checkGeneratedImages(deck, records, complete)).toEqual([])
    expect(imageBindingCheck(records)).toBe('unchecked')
  })

  it('melder alt som er galt, ikke bare det første', () => {
    // A check that stopped at the first conflict would have an agent regenerate
    // one picture per round trip, and regenerate pictures that were fine.
    const { deck } = deckOfFour()
    const records = generateBound(deck, ['A', 'B'])
    expect(checkGeneratedImages(deck, records).filter((i) => i.code === 'MISSING_ITEM')).toHaveLength(2)
  })
})

describe('manifestet som følger filene', () => {
  it('kjenner igjen sin egen fil, og ingen andre', () => {
    expect(isImageManifestFileName(IMAGE_MANIFEST_FILE_NAME)).toBe(true)
    expect(isImageManifestFileName(`bilder/${IMAGE_MANIFEST_FILE_NAME}`)).toBe(true)
    expect(isImageManifestFileName('SLAIDS-BILDER.JSON')).toBe(true)
    expect(isImageManifestFileName('bilder.json')).toBe(false)
    expect(isImageManifestFileName('1.png')).toBe(false)
  })

  it('leser tilbake det den skrev', () => {
    const { deck } = deckOfFour()
    const manifest = {
      presentationId: deck.id,
      images: generateBound(deck, SCRAMBLED),
    }
    const parsed = parseImageGenerationManifest(composeImageGenerationManifest(manifest))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toEqual(manifest)
    expect(checkGeneratedImages(deck, parsed.value.images)).toEqual([])
  })

  it('avviser noe som ikke er et manifest, med en grunn', () => {
    expect(parseImageGenerationManifest('ikke json').ok).toBe(false)
    expect(parseImageGenerationManifest('{}').ok).toBe(false)
    expect(
      parseImageGenerationManifest(
        JSON.stringify({ presentationId: 'p_1', images: [{ number: 1 }] }),
      ).ok,
    ).toBe(false)
    // An id that is not shaped like one is refused at the boundary rather than
    // reported as «unknown» later: the file has been out of the process.
    expect(
      parseImageGenerationManifest(
        JSON.stringify({
          presentationId: 'p_1',
          images: [{ imagePlanItemId: 'noe_annet', number: 1, slideId: 's', nodeId: 'n', fileName: '1.png' }],
        }),
      ).ok,
    ).toBe(false)
  })

  it('melder et manifest som hører til et annet dekk', () => {
    const { deck } = deckOfFour()
    const manifest = { presentationId: 'p_et_annet_dekk', images: generateBound(deck, SCRAMBLED) }
    const issue = manifestPresentationIssue(deck, manifest)
    expect(issue?.code).toBe('WRONG_PRESENTATION')
    expect(manifestPresentationIssue(deck, { ...manifest, presentationId: deck.id })).toBeNull()
  })
})

describe('koblingen til de faktiske filene', () => {
  it('godtar en riktig koblet levering i stokket rekkefølge, med filenes egne avtrykk', async () => {
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, SCRAMBLED)

    expect(checkGeneratedImages(deck, records, delivered)).toEqual([])
    expect(imageBindingCheck(records)).toBe('file-checked')
    // Each picture's own bytes are behind the number its plan entry gave it.
    for (const label of ['A', 'B', 'C', 'D'] as Label[]) {
      const entry = entryFor(deck, label)
      const file = delivered.find((item) => item.fileName === `${entry.number}.png`)
      expect(file?.contentHash).toBe(await hashBytes(PICTURES[label]()))
    }
  })

  it('avviser to filer som har byttet innhold, med navn og manifest urørt', async () => {
    // The scenario a metadata-only check cannot see. Everything agrees: ids,
    // numbers, zones, names, count. Only the bytes behind two of the names have
    // changed places, and two pictures are on the wrong slides.
    const { deck } = deckOfFour()
    const { records } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    const swapped = await deliver([
      { fileName: '1.png', bytes: PICTURES.B() },
      { fileName: '2.png', bytes: PICTURES.A() },
      { fileName: '3.png', bytes: PICTURES.C() },
      { fileName: '4.png', bytes: PICTURES.D() },
    ])

    const issues = checkGeneratedImages(deck, records, swapped)
    const mismatched = issues.filter((issue) => issue.code === 'CONTENT_MISMATCH')
    expect(mismatched.map((issue) => issue.number).sort()).toEqual([1, 2])
    // And it is the whole set that is refused, not the two files: `ready` is
    // what the deposit gates on, and it is all-or-nothing by construction.
    expect(issues.length).toBeGreaterThan(0)
  })

  it('avviser en fil som er byttet ut med en annen etter genereringen', async () => {
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    const tampered = await deliver([{ fileName: '3.png', bytes: realImages.webpLossless() }])
    const issues = checkGeneratedImages(deck, records, [
      ...delivered.filter((file) => file.fileName !== '3.png'),
      ...tampered,
    ])
    expect(issues.map((issue) => issue.code)).toEqual(['CONTENT_MISMATCH'])
    expect(issues[0].number).toBe(3)
  })

  it('nedgraderer aldri en manglende kontroll til «kontrollert»', async () => {
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, ['A', 'B', 'C', 'D'])

    // No digests at all: nothing contradicts itself, and nothing was checked.
    const bare = records.map(({ contentHash: _dropped, ...rest }) => rest)
    expect(checkGeneratedImages(deck, bare, delivered)).toEqual([])
    expect(imageBindingCheck(bare)).toBe('unchecked')

    // One missing out of four is still a delivery nobody can vouch for: the
    // other three passing is not «mostly verified», it is unverified with three
    // pictures that happen to be checkable.
    const partial = records.map((record, index) =>
      index === 2 ? { ...record, contentHash: undefined } : record,
    )
    expect(imageBindingCheck(partial)).toBe('unchecked')
    // The three that *do* carry a digest are still compared — a missing digest
    // excuses its own record, never the others.
    const swappedElsewhere = await deliver([
      { fileName: '1.png', bytes: PICTURES.B() },
      { fileName: '2.png', bytes: PICTURES.A() },
      { fileName: '3.png', bytes: PICTURES.C() },
      { fileName: '4.png', bytes: PICTURES.D() },
    ])
    expect(
      checkGeneratedImages(deck, partial, swappedElsewhere).map((issue) => issue.code),
    ).toContain('CONTENT_MISMATCH')
  })

  it('avviser et avtrykk som ikke er en SHA-256, ved grensen', async () => {
    // At the boundary rather than as a mismatch later: «this field is not a
    // digest» and «these are the wrong bytes» need different answers.
    const { deck } = deckOfFour()
    const { records } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    const manifest = JSON.stringify({
      presentationId: deck.id,
      images: records.map((record, index) =>
        index === 0 ? { ...record, contentHash: 'ikke-en-hash' } : record,
      ),
    })
    expect(parseImageGenerationManifest(manifest).ok).toBe(false)
  })

  it('bærer avtrykkene gjennom manifestet', async () => {
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, SCRAMBLED)
    const parsed = parseImageGenerationManifest(
      composeImageGenerationManifest({ presentationId: deck.id, images: records }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(imageBindingCheck(parsed.value.images)).toBe('file-checked')
    expect(checkGeneratedImages(deck, parsed.value.images, delivered)).toEqual([])
  })
})

describe('bestillingen som helhet, ikke bare motivet', () => {
  /** The deck's plan with one entry's field rewritten. */
  function rewrite(deck: Presentation, label: Label, change: Partial<PlannedImage>): Presentation {
    const zone = entryFor(deck, label).plan
    const written = setImagePlan(
      deck,
      (deck.imagePlan ?? []).map((entry) =>
        entry.nodeId === zone.nodeId ? { ...entry, ...change } : entry,
      ),
    )
    if (!written.ok) throw new Error(written.error.message)
    return written.value
  }

  it('ugyldiggjør en kobling når hvert enkelt bestillingsfelt endres', async () => {
    // One field at a time, because the first version of the id covered only
    // `subject`: everything else in the order could be rewritten while a picture
    // generated from the old wording still passed the check.
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    expect(checkGeneratedImages(deck, records, delivered)).toEqual([])

    const changes: Partial<PlannedImage>[] = [
      { subject: 'Et helt annet motiv, tydelig ulikt alt annet i planen.' },
      { composition: 'Ekstrem nærbildeutsnitt ovenfra, motivet i nedre hjørne.' },
      { requirements: 'Redskapene må være av jern, ikke av tre.' },
      { avoid: 'Ingen moderne klesdrakt og ingen maskiner.' },
    ]
    for (const change of changes) {
      const moved = rewrite(deck, 'A', change)
      const issues = checkGeneratedImages(moved, records, delivered)
      expect(issues.map((issue) => issue.code)).toContain('PLAN_CHANGED')
    }
  })

  it('ugyldiggjør alle koblinger når den felles bildekonteksten endres', async () => {
    // The shared context is part of every picture's order, so it invalidates
    // every one of them — which is correct, and is why it must not be edited
    // after the handoff.
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    const recontexted = setImageContext(
      deck,
      'Grove tresnitt i svart og hvitt, hard strek, ingen gråtoner.',
    )
    if (!recontexted.ok) throw new Error(recontexted.error.message)

    const issues = checkGeneratedImages(recontexted.value, records, delivered)
    expect(issues.filter((issue) => issue.code === 'PLAN_CHANGED')).toHaveLength(4)
  })

  it('ugyldiggjør koblingen når en layoutendring endrer bildeformatet', async () => {
    // The format is measured off the zone and printed into the brief, so it is
    // part of the order even though nobody typed it: a weight change that makes
    // the rectangle a different shape is a different order for that picture,
    // and a picture generated for the old shape comes back cropped.
    const base = createPresentation({ title: 'Fra lin til lerret' })
    const picture = createLeaf(createImage())
    const beside = createLeaf(null)
    const template = contentAt(base, 1)
    const slides: DeckSlides = [
      sectionAt(base, 0),
      { ...template, root: createSplit('x', [1, 1], [picture, beside]) },
    ]
    const planned = setImagePlan({ ...base, imageContext: CONTEXT, slides }, [
      {
        slideId: slides[1].id,
        nodeId: picture.id,
        subject: MOTIFS[0].subject,
        composition: 'Motivet sentrert i rolig omgivelse, naturlig øyehøyde.',
        requirements: '',
        avoid: '',
      },
    ])
    if (!planned.ok) throw new Error(planned.error.message)
    const deck = planned.value

    const entry = resolveImagePlan(deck)[0]
    const bytes = realImages.png()
    const records: GeneratedImageRecord[] = [
      {
        imagePlanItemId: entry.id,
        number: entry.number,
        slideId: entry.plan.slideId,
        nodeId: entry.plan.nodeId,
        fileName: '1.png',
        contentHash: await hashBytes(bytes),
      },
    ]
    const delivered = await deliver([{ fileName: '1.png', bytes }])
    expect(checkGeneratedImages(deck, records, delivered)).toEqual([])

    const widened = setSplitWeights(deck, {
      slideId: slides[1].id,
      nodeId: deck.slides[1].kind === 'content' ? deck.slides[1].root.id : '',
      weights: [4, 1],
    })
    if (!widened.ok) throw new Error(widened.error.message)
    const resynced = syncImagePlaceholders(widened.value.presentation)
    if (!resynced.ok) throw new Error(resynced.error.message)

    expect(resolveImagePlan(resynced.value)[0].aspectRatio).not.toBe(entry.aspectRatio)
    expect(checkGeneratedImages(resynced.value, records, delivered).map((i) => i.code)).toContain(
      'PLAN_CHANGED',
    )
  })

  it('lar en endring generatoren aldri fikk høre om stå urørt', async () => {
    // The other half of the rule, and the one that keeps it usable: a deck title
    // or a slide title is never sent to a generator, so editing one must not
    // invalidate finished pictures.
    const { deck } = deckOfFour()
    const { records, delivered } = await generateFiles(deck, SCRAMBLED)

    const retitled: Presentation = {
      ...deck,
      title: 'Lin gjennom året',
      slides: [
        deck.slides[0],
        ...deck.slides.slice(1).map((slide) =>
          slide.kind === 'content' ? { ...slide, title: titleDoc('En annen tittel') } : slide,
        ),
      ] as typeof deck.slides,
    }
    expect(checkGeneratedImages(retitled, records, delivered)).toEqual([])
    // And re-reading the untouched deck still accepts the same binding.
    expect(checkGeneratedImages(deck, records, delivered)).toEqual([])
    expect(expectedGeneratedImages(retitled)).toEqual(expectedGeneratedImages(deck))
  })
})

describe('nivået krever begge sider', () => {
  it('er uverifisert når avtrykket finnes i manifestet men filen ikke er lest', async () => {
    // A guard rather than a path the dialog can take: it hashes whenever a
    // manifest is present. But the type allows a record with a digest beside a
    // file nobody read, and «could have been checked» must never be reported as
    // «was checked».
    const { deck } = deckOfFour()
    const { records } = await generateFiles(deck, ['A', 'B', 'C', 'D'])
    const unread = records.map((record) => ({ fileName: record.fileName }))

    expect(imageBindingCheck(records)).toBe('file-checked')
    expect(imageBindingCheck(records, unread)).toBe('unchecked')
    // And nothing is invented: a file nobody read is not a mismatch.
    expect(checkGeneratedImages(deck, records, unread)).toEqual([])
  })
})
