/**
 * The theme, through the agent surface.
 *
 * Everything here goes through `runOperation` against a real Dexie store, for
 * the reason `workflow.test.ts` states: dispatch is where an agent actually
 * enters, and the claims worth making are about what ended up stored.
 *
 * The subject is a global change. That is what makes it different from every
 * other mutation an agent can make: `set_zone_text` can only ruin the zone it
 * writes to, while a wider font, more air or bigger type moves every line in
 * the deck at once. So the cases below are mostly about the refusals — that the
 * whole change is refused together, that nothing at all is written when it is,
 * and that the answer says where it went wrong.
 *
 * They also pin down the one thing that could quietly be wrong: these run with
 * no DOM, no browser and no font loaded anywhere, and a font change is still
 * decided by the font that was *named*. See `operations/theme.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { FONT_OPTIONS, GUARANTEED_FONT_IDS, findFontById, isGuaranteedFont } from '../domain/fonts'
import { MIN_TEXT_WIDTH } from '../domain/constants'
import { computeMainRect, computeSlideGeometry } from '../domain/geometry'
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_SPACING,
  FONT_SCALE_RANGE,
  SPACING_RANGE,
  geometryForTheme,
} from '../domain/metrics'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import type { Presentation } from '../domain/types'
import { setThemeLogo } from '../domain/commands/logo'
import { DEFAULT_LOGO_SECTION_HEIGHT, DEFAULT_LOGO_SLIDE_HEIGHT } from '../domain/constants'
import { contentAt } from '../domain/testDecks'
import type { PresentationView, ContentSlideInspection } from './operations/deck'
import type { ThemeView } from './operations/theme'
import { describeOperations, runOperation } from './registry'
import type { AgentContext, AgentError, AgentResult } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-theme-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function call<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentResult<T>> {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

async function ok<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const result = await call<T>(context, name, input)
  if (!result.ok) {
    throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

async function fails(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentError> {
  const result = await call(context, name, input)
  if (result.ok) throw new Error(`Forventet at «${name}» ble avvist.`)
  return result.error
}

function stored(context: AgentContext, presentationId: string): Promise<Presentation> {
  return context.repository.loadPresentation(presentationId)
}

/** A deck with no title zone, so one zone is the whole slide. */
async function newDeck(context: AgentContext): Promise<{ presentationId: string; slideId: string; nodeId: string }> {
  const created = await ok<PresentationView>(context, 'create_presentation', {
    title: 'Temadekk',
    firstSlideHasTitle: false,
  })
  const slideId = created.slides[1].slideId
  const inspected = await ok<{ rootNodeId: string }>(context, 'inspect_slide', {
    presentationId: created.presentationId,
    slideId,
  })
  return { presentationId: created.presentationId, slideId, nodeId: inspected.rootNodeId }
}

function words(chars: number): string {
  return 'ord '.repeat(Math.round(chars / 4))
}

/**
 * A deck whose one zone is close enough to full that the theme decides.
 *
 * The length is chosen so the text fits at the deck's own typography and stops
 * fitting the moment either dial is turned up. Asserted rather than assumed —
 * the point of every case below is what happens *from* this state, so it has to
 * be the state.
 */
async function filledDeck(
  context: AgentContext,
): Promise<{ presentationId: string; slideId: string; nodeId: string }> {
  const deck = await newDeck(context)
  await ok(context, 'set_zone_text', {
    ...deck,
    blocks: [{ type: 'paragraph', spans: [{ text: words(1600) }] }],
  })
  return deck
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

describe('å lese temaet', () => {
  it('kommer med get_presentation, ikke fra en egen operasjon', async () => {
    const context = freshContext()
    const deck = await newDeck(context)

    const view = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    expect(view.theme).toEqual({
      headingFont: {
        fontId: 'quicksand',
        label: 'Quicksand',
        stack: expect.any(String),
        guaranteed: true,
      },
      bodyFont: {
        fontId: 'atkinson',
        label: 'Atkinson Hyperlegible Next',
        stack: expect.any(String),
        guaranteed: true,
      },
      spacing: DEFAULT_SPACING,
      fontScale: DEFAULT_FONT_SCALE,
      boxShadows: true,
      titledCardStyle: 'joined',
      logo: null,
    })
    // The id is the name `set_theme` takes back, and the stack is what the
    // document stores — an agent can see both without being handed the JSON.
    expect(view.theme.headingFont.stack).toBe(findFontById('quicksand')?.stack)
  })

  it('viser logoen, hvor stor den tegnes og stripen den tar, og sonene er regnet uten den', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const before = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: deck.presentationId,
      name: 'logo',
      svgMarkup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100"/></svg>',
    })
    // Logoen settes i editoren; agenten kan bare lese den.
    const document = await stored(context, deck.presentationId)
    const withLogo = setThemeLogo(document, asset.assetId)
    if (!withLogo.ok) throw new Error(withLogo.error.message)
    await context.repository.savePresentation(withLogo.value)

    const view = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })
    const { gap } = geometryForTheme(document.theme)
    expect(view.theme.logo).toEqual({
      assetId: asset.assetId,
      aspect: 3,
      sections: { visibility: 'front', placement: 'above', height: DEFAULT_LOGO_SECTION_HEIGHT, drawnHeight: expect.any(Number) },
      slides: {
        visible: true,
        position: 'bottom-right',
        height: DEFAULT_LOGO_SLIDE_HEIGHT,
        drawnHeight: DEFAULT_LOGO_SLIDE_HEIGHT,
        reservedEdge: 'bottom',
        reservedSize: DEFAULT_LOGO_SLIDE_HEIGHT + gap,
      },
    })

    // Hovedsonen er nøyaktig stripen lavere enn den var.
    const after = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })
    const zone = (inspection: ContentSlideInspection) =>
      inspection.zones.find((entry) => entry.nodeId === deck.nodeId)!.rect
    expect(zone(after).height).toBe(zone(before).height - (DEFAULT_LOGO_SLIDE_HEIGHT + gap))
    expect(zone(after).y).toBe(zone(before).y)
  })

  it('svarer med det samme temaet fra create_presentation', async () => {
    const context = freshContext()
    const created = await ok<PresentationView>(context, 'create_presentation', { title: 'Nytt' })
    const read = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: created.presentationId,
    })
    expect(created.theme).toEqual(read.theme)
  })
})

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

describe('set_theme', () => {
  it('setter alle feltene i ett kall, og lagrer dem', async () => {
    const context = freshContext()
    const deck = await newDeck(context)

    const result = await ok<{ theme: ThemeView; revision: string }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      headingFont: 'space-grotesk',
      bodyFont: 'source-sans',
      spacing: 2.4,
      fontScale: 1.75,
      boxShadows: false,
      titledCardStyle: 'tab',
    })
    expect(result.theme).toMatchObject({
      headingFont: { fontId: 'space-grotesk' },
      bodyFont: { fontId: 'source-sans' },
      spacing: 2.4,
      fontScale: 1.75,
      boxShadows: false,
      titledCardStyle: 'tab',
    })

    const document = await stored(context, deck.presentationId)
    expect(document.theme).toEqual({
      headingFontFamily: findFontById('space-grotesk')?.stack,
      bodyFontFamily: findFontById('source-sans')?.stack,
      spacing: 2.4,
      fontScale: 1.75,
      boxShadows: false,
      titledCardStyle: 'tab',
    })
    // And the answer is a reading an agent can write against straight away.
    expect(result.revision).toBe(
      (
        await ok<PresentationView>(context, 'get_presentation', {
          presentationId: deck.presentationId,
        })
      ).revision,
    )
  })

  it('lar utelatte felter stå', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    await ok(context, 'set_theme', { presentationId: deck.presentationId, spacing: 2.4 })

    const after = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: 1.6,
    })
    expect(after.theme.spacing).toBe(2.4)
    expect(after.theme.bodyFont.fontId).toBe('atkinson')
  })

  it('normaliserer fargen slik domenet gjør, og avviser en som ikke er en farge', async () => {
    const context = freshContext()
    const deck = await newDeck(context)

    // A colour is a section's now, not the theme's, so the theme's own schema
    // has no field for one to normalise.
    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      backgroundColor: '#aabbcc',
    })
    expect(refused.code).toBe('INVALID_INPUT')
  })

  it('tar imot en revisjon, og avviser en som er utdatert uten å skrive', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    const read = await ok<PresentationView>(context, 'get_presentation', {
      presentationId: deck.presentationId,
    })

    await ok(context, 'set_theme', {
      presentationId: deck.presentationId,
      expectedRevision: read.revision,
      fontScale: 1.6,
    })

    const conflict = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      expectedRevision: read.revision,
      fontScale: 1.75,
    })
    expect(conflict.code).toBe('CONFLICT')
    const document = await stored(context, deck.presentationId)
    expect(document.theme.fontScale).toBe(1.6)
  })
})

/* ------------------------------------------------------------------ *
 * The contract a transport publishes
 * ------------------------------------------------------------------ */

describe('kontrakten set_theme publiserer', () => {
  const described = (): Record<string, unknown> => {
    const entry = describeOperations().find((operation) => operation.name === 'set_theme')
    if (!entry) throw new Error('set_theme mangler i katalogen')
    return entry.inputSchema.properties as Record<string, unknown>
  }

  it('gjør de gyldige fontvalgene oppdagbare, fra fontkatalogen selv', () => {
    // Generated from `domain/fonts.ts`, so a web font added to the editor's
    // chooser is a font an agent can pick in the same commit — and a
    // hand-written list here would be the copy that falls behind.
    const properties = described()
    expect(properties.headingFont).toMatchObject({ type: 'string', enum: GUARANTEED_FONT_IDS })
    expect(properties.bodyFont).toMatchObject({ type: 'string', enum: GUARANTEED_FONT_IDS })
    expect(GUARANTEED_FONT_IDS).toContain('quicksand')
  })

  it('tilbyr bare fonter Slaids kan hente selv, ikke editorens lokale', () => {
    // The contract that keeps a fit answer and a rendered preview describing the
    // same font: an agent cannot name a font the renderer would substitute.
    const enumerated = described().headingFont as { enum: string[] }
    for (const font of FONT_OPTIONS) {
      expect(enumerated.enum.includes(font.id), font.id).toBe(isGuaranteedFont(font))
    }
    // Named out loud, because these are the ones that used to be selectable:
    // a container that draws a preview has no Calibri and no Segoe UI.
    expect(enumerated.enum).not.toContain('calibri')
    expect(enumerated.enum).not.toContain('segoe')
    expect(enumerated.enum).not.toContain('times')
  })

  it('publiserer domenets egne grenser for de to skalaene', () => {
    const properties = described()
    expect(properties.spacing).toMatchObject({
      type: 'number',
      minimum: SPACING_RANGE.min,
      maximum: SPACING_RANGE.max,
    })
    expect(properties.fontScale).toMatchObject({
      type: 'number',
      minimum: FONT_SCALE_RANGE.min,
      maximum: FONT_SCALE_RANGE.max,
    })
    // The editor's named steps are quoted so an agent can say "normal" — as
    // examples inside the interval, not as the only values it accepts.
    expect(properties.spacing).toMatchObject({
      description: expect.stringContaining(`normal ${DEFAULT_SPACING}`),
    })
    expect(properties.fontScale).toMatchObject({
      description: expect.stringContaining(`normal ${DEFAULT_FONT_SCALE}`),
    })
  })

  it('avviser en font som ikke finnes, og et tall utenfor intervallet', async () => {
    const context = freshContext()
    const deck = await newDeck(context)

    const font = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      bodyFont: 'comic-sans',
    })
    expect(font.code).toBe('INVALID_INPUT')

    // And a font that exists in the editor but not in the agent's half of the
    // catalogue is refused the same way, by the schema, before anything runs.
    const local = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      bodyFont: 'calibri',
    })
    expect(local.code).toBe('INVALID_INPUT')

    const scale = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: FONT_SCALE_RANGE.max + 1,
    })
    expect(scale.code).toBe('INVALID_INPUT')
  })
})

/* ------------------------------------------------------------------ *
 * Fit
 * ------------------------------------------------------------------ */

describe('en temaendring som ville skjult innhold', () => {
  it('avvises med den vanlige fit-feilen, som peker på sonen', async () => {
    const context = freshContext()
    const deck = await filledDeck(context)

    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: 1.6,
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details).toMatchObject({
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.nodeId,
    })
    expect(refused.details?.overflow).toBeGreaterThan(0)
    // The rect is the room the zone has, which is the other half of what an
    // agent needs to decide between shortening the text and dropping the idea.
    expect(refused.details?.rect).toMatchObject({ width: expect.any(Number) })
  })

  it('gjelder også utseendet på kort med tittel: et svevende kort gir innholdet mindre høyde', async () => {
    const context = freshContext()
    const deck = await newDeck(context)
    await ok(context, 'set_zone_card', {
      ...deck,
      kind: 'titled-card',
      title: [{ text: 'Tittel' }],
    })
    // Så mye tekst som kortet i ett stykke tar, funnet og ikke antatt: den
    // lengste teksten `set_zone_text` fortsatt godtar.
    let low = 0
    let high = 4000
    while (high - low > 4) {
      const middle = Math.round((low + high) / 2)
      const written = await call(context, 'set_zone_text', {
        ...deck,
        blocks: [{ type: 'paragraph', spans: [{ text: words(middle) }] }],
      })
      if (written.ok) low = middle
      else high = middle
    }
    await ok(context, 'set_zone_text', {
      ...deck,
      blocks: [{ type: 'paragraph', spans: [{ text: words(low) }] }],
    })

    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      titledCardStyle: 'floating',
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details).toMatchObject({ nodeId: deck.nodeId })
    expect((await stored(context, deck.presentationId)).theme.titledCardStyle).toBe('joined')

    // Skygger er bare maling: de kan aldri skjule noe, så de avvises aldri.
    const shadowless = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      boxShadows: false,
    })
    expect(shadowless.theme.boxShadows).toBe(false)
  })

  it('lagrer ingenting – heller ikke feltene som i seg selv var greie', async () => {
    const context = freshContext()
    const deck = await filledDeck(context)
    const before = await stored(context, deck.presentationId)

    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      // The heading font only touches titles and could never hide this zone's
      // body text; it is refused all the same, because the theme is one value
      // and half a theme is not a state anybody asked for.
      headingFont: 'source-sans',
      spacing: SPACING_RANGE.max,
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')

    const after = await stored(context, deck.presentationId)
    expect(after.theme).toEqual(before.theme)
    expect(after.updatedAt).toBe(before.updatedAt)
  })

  it('lar agenten korte ned teksten og lykkes på neste forsøk', async () => {
    const context = freshContext()
    const deck = await filledDeck(context)
    expect(
      (await fails(context, 'set_theme', { presentationId: deck.presentationId, fontScale: 1.6 }))
        .code,
    ).toBe('CONTENT_DOES_NOT_FIT')

    await ok(context, 'set_zone_text', {
      ...deck,
      blocks: [{ type: 'paragraph', spans: [{ text: words(800) }] }],
    })
    const themed = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: 1.6,
    })
    expect(themed.theme.fontScale).toBe(1.6)
  })

  it('svarer med rektangelet det nye temaet ville gitt, ikke det gamle', async () => {
    // The overflow was measured against the gap the *new* theme implies, so the
    // room reported has to be that room too. Told the old one, an agent would
    // shorten its text by an amount that is not the amount missing.
    const context = freshContext()
    const deck = await filledDeck(context)
    const before = await ok<ContentSlideInspection>(context, 'inspect_slide', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
    })

    const spacing = SPACING_RANGE.max
    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      spacing,
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details?.rect).toEqual(computeMainRect(false, geometryForTheme({ spacing })))

    // Which is a smaller room than the one the zone has right now — the whole
    // reason the theme was refused.
    const zone = before.zones.find((entry) => entry.nodeId === deck.nodeId)
    const rect = refused.details?.rect as { width: number }
    expect(rect.width).toBeLessThan(zone?.rect.width ?? 0)
  })

  it('slipper igjennom en endring som gir innholdet mer plass', async () => {
    const context = freshContext()
    const deck = await filledDeck(context)
    const roomier = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      fontScale: FONT_SCALE_RANGE.min,
      spacing: SPACING_RANGE.min,
    })
    expect(roomier.theme.fontScale).toBe(FONT_SCALE_RANGE.min)
  })
})

/* ------------------------------------------------------------------ *
 * Zone minimums
 * ------------------------------------------------------------------ */

describe('en temaendring som ville gjort soner ulovlig små', () => {
  /**
   * A slide split as far across as the design space allows — at the tightest
   * setting the theme offers, which is the only one that allows this many.
   */
  async function splitWide(context: AgentContext): Promise<{ presentationId: string; slideId: string }> {
    const deck = await newDeck(context)
    await ok(context, 'set_theme', {
      presentationId: deck.presentationId,
      spacing: SPACING_RANGE.min,
    })
    const split = await ok<{ childNodeIds: string[] }>(context, 'split_zone', {
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: deck.nodeId,
      axis: 'x',
      weights: [1, 1, 1, 1, 1, 1, 1],
    })
    // Tekst i hver kolonne. Tomme soner har ingen minstestørrelse — de tegner
    // ingenting — mens en tekstsone har den smaleste av dem, og det er den
    // luften kan bryte uten at ett eneste tegn blir borte.
    for (const nodeId of split.childNodeIds) {
      await ok(context, 'set_zone_card', {
        presentationId: deck.presentationId,
        slideId: deck.slideId,
        nodeId,
        kind: 'container',
      })
    }
    return deck
  }

  it('avvises med ZONE_TOO_SMALL, selv om ingenting er skjult', async () => {
    // The fit guard measures content, and empty containers hide nothing:
    // without a second question this change would commit a deck that
    // validate_presentation immediately calls invalid.
    const context = freshContext()
    const deck = await splitWide(context)

    const refused = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      spacing: SPACING_RANGE.max,
    })
    expect(refused.code).toBe('ZONE_TOO_SMALL')
    expect(refused.details).toMatchObject({
      presentationId: deck.presentationId,
      slideId: deck.slideId,
      nodeId: expect.any(String),
    })
    expect((await stored(context, deck.presentationId)).theme.spacing).toBe(SPACING_RANGE.min)

    // The rect is the one the refused theme would have given the zone, not the
    // one it has today — today's is comfortably above the minimum, which is
    // exactly what the error says it is not.
    const document = await stored(context, deck.presentationId)
    const nodeId = refused.details?.nodeId as string
    const prospective = computeSlideGeometry(
      contentAt(document, 1),
      geometryForTheme({ ...document.theme, spacing: SPACING_RANGE.max }),
    ).rects.get(nodeId)
    expect(refused.details?.rect).toEqual(prospective)
    expect((refused.details?.rect as { width: number }).width).toBeLessThan(MIN_TEXT_WIDTH)
  })

  it('lar presentasjonen forbli gyldig, som validate_presentation ser den', async () => {
    const context = freshContext()
    const deck = await splitWide(context)
    await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      spacing: SPACING_RANGE.max,
    })

    // The guard and the validator ask `validateSlideGeometry` the same question,
    // so a change the guard let through can never be one the validator refuses.
    const report = await ok<{ valid: boolean; issues: unknown[] }>(
      context,
      'validate_presentation',
      { presentationId: deck.presentationId },
    )
    expect(report.issues).toEqual([])
    expect(report.valid).toBe(true)
  })

  it('slipper igjennom en mindre økning som fortsatt holder minstemålet', async () => {
    const context = freshContext()
    const deck = await splitWide(context)
    // Inside the interval rather than on a named rung: the next rung up
    // already takes a zone under the minimum, and the scale is continuous.
    const smallStep = SPACING_RANGE.min + 0.1
    const themed = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      spacing: smallStep,
    })
    expect(themed.theme.spacing).toBe(smallStep)
  })
})

/* ------------------------------------------------------------------ *
 * Web fonts, headless
 * ------------------------------------------------------------------ */

describe('fonten en hodeløs måling dømmer etter', () => {
  it('er den fonten som ble navngitt, ikke en reservefont', async () => {
    // No DOM, no browser, no font loaded — and the two fonts still get
    // different answers, because the estimator reads the catalogue's own
    // advance for the stack it was handed. That is what makes an approval here
    // describe the same font a later preview will draw in: there is no
    // measurement of a fallback face to be approved against.
    const context = freshContext()
    const deck = await filledDeck(context)

    const wide = await fails(context, 'set_theme', {
      presentationId: deck.presentationId,
      bodyFont: 'merriweather',
    })
    expect(wide.code).toBe('CONTENT_DOES_NOT_FIT')

    const narrow = await ok<{ theme: ThemeView }>(context, 'set_theme', {
      presentationId: deck.presentationId,
      bodyFont: 'source-sans',
    })
    expect(narrow.theme.bodyFont.fontId).toBe('source-sans')

    // Both are web fonts, and neither was downloaded: no network took part in
    // either answer, and they still differ — because the number comes from the
    // catalogue's entry for the font that was named.
    const document = await stored(context, deck.presentationId)
    expect(document.theme.bodyFontFamily).toBe(findFontById('source-sans')?.stack)
  })

  it('måler seksjonsslides også, og sier hvilken det var', async () => {
    // A section has no zones, and a global theme change is exactly the kind of
    // change that can push its one line off the page. An agent has to be able
    // to tell that apart from a slide that no longer fits, so the refusal
    // carries the section's own slide id.
    const context = freshContext()
    const created = await ok<PresentationView>(context, 'create_presentation', {
      title: 'Forsidemåling',
    })
    const frontId = created.slides[0].slideId
    let length = 20
    let longest = 20
    for (;;) {
      const attempt = await call(context, 'set_section', {
        presentationId: created.presentationId,
        slideId: frontId,
        title: 'A'.repeat(length),
      })
      if (!attempt.ok) break
      longest = length
      length += 5
      if (length > 400) throw new Error('Forsiden tok imot alt.')
    }
    // The longest line that still fits, so a wider font has to push *it* over.
    await ok(context, 'set_section', {
      presentationId: created.presentationId,
      slideId: frontId,
      title: 'A'.repeat(longest),
    })

    const refused = await fails(context, 'set_theme', {
      presentationId: created.presentationId,
      headingFont: 'merriweather',
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details?.slideId).toBe(frontId)
    // A section has no zone tree, so the room its one line has is the only
    // rectangle there is to report — and it is the prospective one.
    expect(refused.details?.rect).toMatchObject({ width: expect.any(Number) })
    expect((await stored(context, created.presentationId)).theme.headingFontFamily).toBe(
      findFontById('quicksand')?.stack,
    )
  })

  it('måler tittelsonen mot overskriftsfonten på samme måte', async () => {
    const context = freshContext()
    const created = await ok<PresentationView>(context, 'create_presentation', {
      title: 'Tittelmåling',
    })
    const slideId = created.slides[1].slideId
    // A title exactly as long as the zone allows in the default face. Grown one
    // character at a time on purpose: a coarser step would leave slack, and the
    // slack would be the thing the next assertion measured.
    let length = 10
    for (;;) {
      const attempt = await call(context, 'set_slide_title', {
        presentationId: created.presentationId,
        slideId,
        spans: [{ text: 'A'.repeat(length) }],
      })
      if (!attempt.ok) break
      length += 1
      if (length > 400) throw new Error('Tittelsonen tok imot alt.')
    }
    await ok(context, 'set_slide_title', {
      presentationId: created.presentationId,
      slideId,
      spans: [{ text: 'A'.repeat(length - 1) }],
    })

    const refused = await fails(context, 'set_theme', {
      presentationId: created.presentationId,
      headingFont: 'merriweather',
    })
    expect(refused.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(refused.details).toMatchObject({ subject: 'slide-title', slideId })
  })
})
