/**
 * Temamaler gjennom agentflaten (§ 15.4): lese malene brukeren ser, og bruke
 * én på en presentasjon med logoen kopiert inn i presentasjonens eget
 * fillager. Mot et ekte Dexie-lager, som `theme.test.ts`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { themeTemplateContent } from '../domain/themeTemplate'
import type { Presentation } from '../domain/types'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import type { PresentationView } from './operations/deck'
import type { ThemeTemplateView } from './operations/themeTemplates'
import type { ThemeView } from './operations/theme'
import { runOperation } from './registry'
import type { AgentContext, AgentError, AgentResult } from './types'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-theme-templates-${counter}`)
  databases.push(database)
  const repository = new DexieSlaidsRepository(database)
  return { repository, themeTemplates: repository }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function call<T>(context: AgentContext, name: string, input: Record<string, unknown> = {}): Promise<AgentResult<T>> {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

async function ok<T>(context: AgentContext, name: string, input: Record<string, unknown> = {}): Promise<T> {
  const result = await call<T>(context, name, input)
  if (!result.ok) throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  return result.value
}

async function fails(context: AgentContext, name: string, input: Record<string, unknown> = {}): Promise<AgentError> {
  const result = await call(context, name, input)
  if (result.ok) throw new Error(`Forventet at «${name}» ble avvist.`)
  return result.error
}

const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="#1f6feb"/></svg>'

function stored(context: AgentContext, id: string): Promise<Presentation> {
  return context.repository.loadPresentation(id)
}

async function newDeck(context: AgentContext, title: string, firstSlideHasTitle = true): Promise<PresentationView> {
  return ok<PresentationView>(context, 'create_presentation', { title, firstSlideHasTitle })
}

/**
 * En mal lagret slik temaeditoren lagrer den: et øyeblikksbilde av et dekk med
 * logo, egne forsidefarger og skygger av, og logofilens byter for seg.
 */
async function savedTemplate(
  context: AgentContext,
  options: { id?: string; withLogo?: boolean; visibility?: 'private' | 'shared' } = {},
): Promise<string> {
  const source = await newDeck(context, 'Kilde')
  if (options.withLogo !== false) {
    const asset = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: source.presentationId,
      name: 'firmalogo',
      svgMarkup: LOGO_SVG,
    })
    await ok(context, 'set_theme_logo', {
      presentationId: source.presentationId,
      assetId: asset.assetId,
      slides: { position: 'top-right', height: 60 },
    })
  }
  await ok(context, 'set_theme', { presentationId: source.presentationId, boxShadows: false })
  await ok(context, 'set_section_colors', {
    presentationId: source.presentationId,
    slideId: source.slides[0].slideId,
    backgroundColor: '#112233',
    accentColor: '#ddeeff',
  })
  const deck = await stored(context, source.presentationId)
  const { content, logoAssetId } = themeTemplateContent(deck)
  const logo = logoAssetId ? ((await context.repository.getAsset(logoAssetId))?.blob ?? null) : null
  const id = options.id ?? 'tt_firma'
  const now = new Date().toISOString()
  await context.themeTemplates!.createThemeTemplate(
    { id, name: 'Firma', visibility: options.visibility ?? 'shared', content, createdAt: now, updatedAt: now },
    logo,
  )
  return id
}

describe('list_theme_templates', () => {
  it('viser malene med tema, forsidefarger og logo, og hvilken som er standard', async () => {
    const context = freshContext()
    const id = await savedTemplate(context)
    const listed = await ok<{ templates: ThemeTemplateView[] }>(context, 'list_theme_templates')
    expect(listed.templates).toEqual([
      expect.objectContaining({
        id,
        name: 'Firma',
        visibility: 'shared',
        own: true,
        isDefault: false,
        front: { backgroundColor: '#112233', accentColor: '#ddeeff' },
        theme: expect.objectContaining({ boxShadows: false }),
        logo: expect.objectContaining({
          name: 'firmalogo.svg',
          mimeType: 'image/svg+xml',
          aspect: 3,
          slides: expect.objectContaining({ position: 'top-right', height: 60 }),
        }),
      }),
    ])
    expect(listed.templates[0].theme).not.toHaveProperty('logo')

    await context.repository.updateUserSettings(null, { defaultThemeTemplateId: id })
    const again = await ok<{ templates: ThemeTemplateView[] }>(context, 'list_theme_templates')
    expect(again.templates[0].isDefault).toBe(true)
  })

  it('svarer THEME_TEMPLATES_UNAVAILABLE når installasjonen ikke har maler', async () => {
    const context = freshContext()
    const { themeTemplates: _templates, ...without } = context
    expect((await fails(without, 'list_theme_templates')).code).toBe('THEME_TEMPLATES_UNAVAILABLE')
  })
})

describe('apply_theme_template', () => {
  it('setter tema, forsidefarger og logo i ett steg, med presentasjonens egen kopi av logoen', async () => {
    const context = freshContext()
    const templateId = await savedTemplate(context)
    const target = await newDeck(context, 'Mål')
    const result = await ok<{ theme: ThemeView; revision: string }>(context, 'apply_theme_template', {
      presentationId: target.presentationId,
      templateId,
    })

    const deck = await stored(context, target.presentationId)
    const logoId = deck.theme.logo!.assetId
    expect(result.theme.logo).toMatchObject({ assetId: logoId, slides: { position: 'top-right', height: 60 } })
    expect(result.theme.boxShadows).toBe(false)
    expect(deck.slides[0]).toMatchObject({ backgroundColor: '#112233', accentColor: '#ddeeff' })
    // Filen er presentasjonens egen: den står i presentasjonens liste, og
    // bytene ligger i lageret under presentasjonens id.
    expect(deck.assets.map((asset) => asset.id)).toEqual([logoId])
    expect(await (await context.repository.getAsset(logoId))?.blob.text()).toContain('<svg')

    // Presentasjonen virker videre når malen slettes.
    await context.themeTemplates!.deleteThemeTemplate(templateId)
    const after = await ok<PresentationView>(context, 'get_presentation', { presentationId: target.presentationId })
    expect(after.theme.logo?.assetId).toBe(logoId)
    expect(await context.repository.getAsset(logoId)).not.toBeNull()
  })

  it('gjenbruker en fil presentasjonen allerede har med de samme bytene', async () => {
    const context = freshContext()
    const templateId = await savedTemplate(context)
    const target = await newDeck(context, 'Mål')
    const own = await ok<{ assetId: string }>(context, 'create_svg_asset', {
      presentationId: target.presentationId,
      name: 'samme',
      svgMarkup: LOGO_SVG,
    })
    await ok(context, 'apply_theme_template', { presentationId: target.presentationId, templateId })
    const deck = await stored(context, target.presentationId)
    expect(deck.theme.logo?.assetId).toBe(own.assetId)
    expect(deck.assets).toHaveLength(1)
  })

  it('fjerner logoen når malen ikke har noen', async () => {
    const context = freshContext()
    const withLogo = await savedTemplate(context, { id: 'tt_med' })
    const plain = await savedTemplate(context, { id: 'tt_uten', withLogo: false })
    const target = await newDeck(context, 'Mål')
    await ok(context, 'apply_theme_template', { presentationId: target.presentationId, templateId: withLogo })
    await ok(context, 'apply_theme_template', { presentationId: target.presentationId, templateId: plain })
    expect((await stored(context, target.presentationId)).theme.logo).toBeUndefined()
  })

  it('avviser en mal som ville skjult innhold, og lagrer verken filen eller temaet', async () => {
    const context = freshContext()
    const templateId = await savedTemplate(context)
    const target = await newDeck(context, 'Trangt', false)
    const slideId = target.slides[1].slideId
    const inspected = await ok<{ rootNodeId: string }>(context, 'inspect_slide', {
      presentationId: target.presentationId,
      slideId,
    })
    await ok(context, 'set_zone_text', {
      presentationId: target.presentationId,
      slideId,
      nodeId: inspected.rootNodeId,
      blocks: [{ type: 'paragraph', spans: [{ text: 'ord '.repeat(400) }] }],
    })
    const before = await stored(context, target.presentationId)
    const error = await fails(context, 'apply_theme_template', {
      presentationId: target.presentationId,
      templateId,
    })
    expect(error.code).toBe('CONTENT_DOES_NOT_FIT')
    expect(await stored(context, target.presentationId)).toEqual(before)
    // Ingen fil ble lagret i forkant av avvisningen.
    expect(await databases.at(-1)!.assets.where('presentationId').equals(target.presentationId).count()).toBe(0)
  })

  it('avviser en mal som ikke finnes, og en utdatert revisjon, uten å skrive', async () => {
    const context = freshContext()
    const templateId = await savedTemplate(context)
    const target = await newDeck(context, 'Mål')
    expect(
      (await fails(context, 'apply_theme_template', { presentationId: target.presentationId, templateId: 'tt_borte' })).code,
    ).toBe('THEME_TEMPLATE_NOT_FOUND')
    const before = await stored(context, target.presentationId)
    await ok(context, 'set_presentation_title', { presentationId: target.presentationId, title: 'Nytt navn' })
    expect(
      (
        await fails(context, 'apply_theme_template', {
          presentationId: target.presentationId,
          templateId,
          expectedRevision: target.revision,
        })
      ).code,
    ).toBe('CONFLICT')
    expect((await stored(context, target.presentationId)).assets).toEqual(before.assets)
  })
})
