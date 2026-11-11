/**
 * Temamaler (§ 15.4): øyeblikksbildet av et dekk, hvordan lagret innhold leses,
 * og kommandoen som bruker en mal på et annet dekk i ett steg.
 */

import { describe, expect, it } from 'vitest'
import { applyThemeTemplate, registerAsset, setThemeLogo, splitLeaf, setZoneContent } from './commands'
import { HUMAN_EDIT } from './commands/manualLayout'
import { createContainer } from './content'
import { estimateFitChecker, estimateTitleFitChecker } from './fit'
import { collectLeaves } from './layout'
import { DEFAULT_SPACING, SPACING_RANGE } from './metrics'
import { createPresentation, defaultTheme } from './presentation'
import { contentAt } from './testDecks'
import {
  THEME_TEMPLATE_NAME_MAX,
  normalizeThemeTemplateName,
  parseThemeTemplateContent,
  themeTemplateContent,
  type ThemeTemplateContent,
} from './themeTemplate'
import type { AssetRef, Presentation } from './types'

const LOGO: AssetRef = {
  id: 'a_logo',
  name: 'logo.png',
  mimeType: 'image/png',
  byteSize: 512,
  width: 300,
  height: 100,
  isVector: false,
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error(`Forventet ok, fikk ${JSON.stringify(result.error)}`)
  return result.value
}

/** Et dekk med logo, egne farger og et tema som ikke er standard. */
function styledDeck(): Presentation {
  const base = createPresentation({
    title: 'Kilde',
    theme: { ...defaultTheme(), boxShadows: false, titledCardStyle: 'floating', fontScale: 1.5 },
  })
  const withLogo = unwrap(setThemeLogo(unwrap(registerAsset(base, LOGO)), LOGO.id))
  return {
    ...withLogo,
    theme: {
      ...withLogo.theme,
      logo: { ...withLogo.theme.logo!, slides: { visible: true, position: 'top-left', height: 70 } },
    },
    slides: [{ ...withLogo.slides[0], backgroundColor: '#112233', accentColor: '#ddeeff' }, ...withLogo.slides.slice(1)],
  }
}

describe('øyeblikksbildet', () => {
  it('tar med tema, forsidens farger og logoen – uten fil-id og uten bytene', () => {
    const { content, logoAssetId } = themeTemplateContent(styledDeck())
    expect(logoAssetId).toBe(LOGO.id)
    expect(content.front).toEqual({ backgroundColor: '#112233', accentColor: '#ddeeff' })
    expect(content.theme).not.toHaveProperty('logo')
    expect(content.theme.titledCardStyle).toBe('floating')
    const { id: _id, ...file } = LOGO
    expect(content.logo?.file).toEqual(file)
    expect(content.logo?.settings).toMatchObject({ aspect: 3, slides: { position: 'top-left', height: 70 } })
    expect(JSON.stringify(content)).not.toContain(LOGO.id)
    expect(parseThemeTemplateContent(JSON.parse(JSON.stringify(content)))).toEqual(content)
  })

  it('har ingen logo når dekket ikke har det', () => {
    const { content, logoAssetId } = themeTemplateContent(createPresentation({ title: 'Ren' }))
    expect(logoAssetId).toBeNull()
    expect(content.logo).toBeNull()
  })
})

describe('lagret innhold', () => {
  it('gir en mal fra før en innstilling fantes den nye innstillingens standard', () => {
    const { content } = themeTemplateContent(createPresentation({ title: 'Gammel' }))
    const { titledCardStyle: _style, ...olderTheme } = content.theme
    expect(parseThemeTemplateContent({ ...content, theme: olderTheme })?.theme).toEqual(defaultTheme())
  })

  it('avviser innhold som ikke er en mal', () => {
    expect(parseThemeTemplateContent(null)).toBeNull()
    expect(parseThemeTemplateContent({ theme: {}, front: { backgroundColor: 'rød', accentColor: '#fff' }, logo: null })).toBeNull()
    expect(parseThemeTemplateContent('tull')).toBeNull()
  })

  it('rydder navnet og holder det innenfor grensen', () => {
    expect(normalizeThemeTemplateName('  Min   mal ')).toBe('Min mal')
    expect(normalizeThemeTemplateName('x'.repeat(200))).toHaveLength(THEME_TEMPLATE_NAME_MAX)
  })
})

describe('applyThemeTemplate', () => {
  const target = (): Presentation => createPresentation({ title: 'Mål' })
  const template = (): ThemeTemplateContent => themeTemplateContent(styledDeck()).content
  const copy: AssetRef = { ...LOGO, id: 'a_copy' }

  it('setter temaet, forsidens to farger og logoen i ett steg', () => {
    const before = unwrap(registerAsset(target(), copy))
    const after = unwrap(applyThemeTemplate(before, template(), copy.id, HUMAN_EDIT))
    expect(after.theme).toEqual({
      ...template().theme,
      logo: { ...template().logo!.settings, assetId: copy.id },
    })
    expect(after.slides[0]).toMatchObject({ backgroundColor: '#112233', accentColor: '#ddeeff' })
    // Senere inndelinger og slides berøres ikke.
    expect(after.slides.slice(1)).toEqual(before.slides.slice(1))
  })

  it('tar logoen bort når malen ikke har noen', () => {
    const withLogo = styledDeck()
    const plain = themeTemplateContent(createPresentation({ title: 'Ren' })).content
    const after = unwrap(applyThemeTemplate(withLogo, plain, null, HUMAN_EDIT))
    expect(after.theme.logo).toBeUndefined()
  })

  it('avviser en logo som ikke ligger i presentasjonen', () => {
    expect(applyThemeTemplate(target(), template(), null, HUMAN_EDIT)).toMatchObject({ ok: false })
    expect(applyThemeTemplate(target(), template(), 'a_mangler', HUMAN_EDIT)).toMatchObject({
      ok: false,
      error: { code: 'ASSET_NOT_FOUND' },
    })
  })

  it('måler for en agent, som alle andre temaendringer', () => {
    const checkers = { fits: estimateFitChecker, fitsTitle: estimateTitleFitChecker }
    // Sju smale kolonner med tekstbeholdere: «Normal» luft gjør dem mindre enn
    // minstemålet (se `fitGuard.test.ts`).
    const deck = createPresentation({ title: 'Trangt', firstSlideHasTitle: false, theme: { spacing: SPACING_RANGE.min } })
    const slide = contentAt(deck, 1)
    let filled = unwrap(
      splitLeaf(deck, { slideId: slide.id, nodeId: slide.root.id, axis: 'x', weights: [1, 1, 1, 1, 1, 1, 1], ...checkers }),
    ).presentation
    for (const leaf of collectLeaves(contentAt(filled, 1).root)) {
      filled = unwrap(
        setZoneContent(filled, { slideId: slide.id, nodeId: leaf.id, content: createContainer(), ...checkers }),
      ).presentation
    }
    const plain = themeTemplateContent(createPresentation({ title: 'Ren' })).content
    const airy = { ...plain, theme: { ...plain.theme, spacing: DEFAULT_SPACING } }
    expect(applyThemeTemplate(filled, airy, null, checkers)).toMatchObject({
      ok: false,
      error: { code: 'ZONE_TOO_SMALL' },
    })
  })
})
