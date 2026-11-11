/**
 * Logoens geometri (§ 15.2): hvor den står, hvor stor den kan bli, og at den
 * aldri ligger over tittel, innhold, overskrifter eller fremdriftsindikatoren.
 */

import { describe, expect, it } from 'vitest'
import {
  LOGO_MIN_HEIGHT,
  LOGO_SLIDE_POSITIONS,
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type LogoSectionPlacement,
  type LogoSlidePosition,
} from './constants'
import { addSection, setSectionSubtitle, setSlideTitle } from './commands'
import { createUntitledCard } from './content'
import { computeSectionGeometry, computeSlideGeometry, minimumSizeFor } from './geometry'
import {
  deckLogoLayout,
  geometryForDeck,
  logoLimits,
  sectionFloor,
  sectionLogoRect,
  slideLogoRect,
  themeAssetIds,
} from './logo'
import { geometryForTheme, sectionGeometryForTheme } from './metrics'
import { createPresentation } from './presentation'
import { titleDoc } from './richdoc'
import { contentAt, sectionAt } from './testDecks'
import type { LayoutNode, Presentation, Rect, ThemeLogo } from './types'

const EPSILON = 1e-6

function unwrap<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`Forventet ok, fikk ${JSON.stringify(result.error)}`)
  }
  return result.value
}

function logo(overrides: Partial<ThemeLogo> = {}): ThemeLogo {
  return {
    assetId: 'a_logo',
    aspect: 2,
    sections: { visibility: 'all', placement: 'above', height: 160 },
    slides: { visible: true, position: 'top-right', height: 72 },
    ...overrides,
  }
}

function withLogo(presentation: Presentation, value: ThemeLogo): Presentation {
  return { ...presentation, theme: { ...presentation.theme, logo: value } }
}

/** Forside, en slide med tittel, en uten, og en inndeling til – med og uten underoverskrift. */
function deck(): Presentation {
  let presentation = createPresentation({ title: 'Logo' })
  presentation = unwrap(addSection(presentation, { title: 'Del to' }))
  presentation = unwrap(
    setSectionSubtitle(presentation, presentation.slides[0].id, titleDoc('Undertittel')),
  )
  return presentation
}

function deckWithUntitled(): Presentation {
  const base = deck()
  const titled = contentAt(base, 1)
  const untitled = { ...titled, id: 's_untitled', title: null }
  const [front, ...rest] = base.slides
  return { ...base, slides: [front, rest[0], untitled, ...rest.slice(1)] }
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width - EPSILON &&
    b.x < a.x + a.width - EPSILON &&
    a.y < b.y + b.height - EPSILON &&
    b.y < a.y + a.height - EPSILON
  )
}

function inside(rect: Rect, outer: Rect): boolean {
  return (
    rect.x >= outer.x - EPSILON &&
    rect.y >= outer.y - EPSILON &&
    rect.x + rect.width <= outer.x + outer.width + EPSILON &&
    rect.y + rect.height <= outer.y + outer.height + EPSILON
  )
}

describe('themeAssetIds', () => {
  it('er logoens fil, eller ingenting', () => {
    expect(themeAssetIds(createPresentation({ title: 'x' }).theme)).toEqual([])
    expect(themeAssetIds(withLogo(deck(), logo()).theme)).toEqual(['a_logo'])
  })
})

describe('logo på vanlige slides', () => {
  const aspects = [0.4, 1, 2, 6]

  for (const position of LOGO_SLIDE_POSITIONS) {
    for (const aspect of aspects) {
      it(`${position}, forhold ${aspect}: innenfor sideflaten og aldri over tittel eller innhold`, () => {
        // Ønsket er hele sidens høyde: det som tegnes er det plassen tillater.
        const presentation = withLogo(
          deckWithUntitled(),
          logo({ aspect, slides: { visible: true, position, height: SLIDE_HEIGHT } }),
        )
        const layout = deckLogoLayout(presentation)
        expect(layout?.slides).not.toBeNull()
        const options = geometryForDeck(presentation)
        const { inset } = geometryForTheme(presentation.theme)
        const page: Rect = {
          x: inset,
          y: inset,
          width: SLIDE_WIDTH - inset * 2,
          height: SLIDE_HEIGHT - inset * 2 - PROGRESS_BAR_HEIGHT,
        }

        for (const slide of presentation.slides) {
          if (slide.kind !== 'content') continue
          const rect = slideLogoRect(layout, slide.title !== null, options)!
          const geometry = computeSlideGeometry(slide, options)
          expect(rect.height).toBeGreaterThanOrEqual(LOGO_MIN_HEIGHT)
          expect(rect.width / rect.height).toBeCloseTo(aspect, 6)
          expect(inside(rect, page)).toBe(true)
          if (geometry.titleRect) expect(overlaps(rect, geometry.titleRect)).toBe(false)
          expect(overlaps(rect, geometry.mainRect)).toBe(false)
          // Hovedsonens tre holder fortsatt sitt harde minstemål.
          const minimum = minimumSizeFor(slide.root, options)
          expect(geometry.mainRect.width).toBeGreaterThanOrEqual(minimum.width - EPSILON)
          expect(geometry.mainRect.height).toBeGreaterThanOrEqual(minimum.height - EPSILON)
        }
      })
    }
  }

  it('tegner ønsket høyde når den får plass, og står i hjørnet den er satt i', () => {
    const presentation = withLogo(deck(), logo({ slides: { visible: true, position: 'top-left', height: 60 } }))
    const options = geometryForDeck(presentation)
    const { inset } = geometryForTheme(presentation.theme)
    const rect = slideLogoRect(deckLogoLayout(presentation), true, options)!
    expect(rect).toEqual({ x: inset, y: inset, width: 120, height: 60 })
    // Tittelen flyttes ned under logoen, med det vanlige gapet mellom.
    const geometry = computeSlideGeometry(contentAt(presentation, 1), options)
    expect(geometry.titleRect!.y).toBe(inset + 60 + options.gap!)
  })

  it('plasserer de tre øverste og de tre nederste langs kanten', () => {
    const at = (position: LogoSlidePosition) => {
      const presentation = withLogo(deck(), logo({ slides: { visible: true, position, height: 50 } }))
      return slideLogoRect(deckLogoLayout(presentation), true, geometryForDeck(presentation))!
    }
    expect(at('top').x).toBeCloseTo((SLIDE_WIDTH - 100) / 2)
    expect(at('top-right').x + 100).toBeCloseTo(SLIDE_WIDTH - geometryForTheme().inset)
    expect(at('bottom-left').y + 50).toBeCloseTo(
      SLIDE_HEIGHT - geometryForTheme().inset - PROGRESS_BAR_HEIGHT,
    )
    expect(at('bottom').y).toBe(at('bottom-right').y)
  })

  it('reserverer ingenting når logoen er slått av på slides', () => {
    const presentation = withLogo(deck(), logo({ slides: { visible: false, position: 'top', height: 72 } }))
    expect(deckLogoLayout(presentation)?.slides).toBeNull()
    expect(geometryForDeck(presentation).logo).toBeNull()
  })

  it('blir mindre når en slide trenger mer plass, og forsvinner under minstemålet', () => {
    const base = withLogo(
      deck(),
      logo({ aspect: 4, slides: { visible: true, position: 'left', height: SLIDE_HEIGHT } }),
    )
    const before = logoLimits(base)!.slides
    // Kort side om side: hvert av dem har et minstemål, og det gjør raden bred.
    const columns = (count: number): Presentation => {
      const slide = contentAt(base, 1)
      const root: LayoutNode = {
        id: 'n_row',
        kind: 'split',
        axis: 'x',
        weights: Array.from({ length: count }, () => 1),
        children: Array.from({ length: count }, (_, index) => ({
          id: `n_${index}`,
          kind: 'leaf' as const,
          content: createUntitledCard(),
        })),
      }
      const [front, ...rest] = base.slides
      return {
        ...base,
        slides: [front, ...rest.map((entry) => (entry.id === slide.id ? { ...slide, root } : entry))],
      }
    }
    const some = logoLimits(columns(4))!.slides
    expect(some).toBeLessThan(before)
    expect(deckLogoLayout(columns(4))?.slides?.height).toBe(some)
    const crowded = columns(40)
    expect(logoLimits(crowded)!.slides).toBeLessThan(LOGO_MIN_HEIGHT)
    expect(deckLogoLayout(crowded)?.slides).toBeNull()
    expect(geometryForDeck(crowded).logo).toBeNull()
  })

  it('husker svaret for det samme dekket', () => {
    const presentation = withLogo(deck(), logo())
    expect(deckLogoLayout(presentation)).toBe(deckLogoLayout({ ...presentation }))
    const retitled = unwrap(
      setSlideTitle(presentation, contentAt(presentation, 1).id, titleDoc('Ny')),
    )
    expect(deckLogoLayout(retitled)).not.toBe(deckLogoLayout(presentation))
  })
})

describe('logo på inndelinger', () => {
  const placements: LogoSectionPlacement[] = ['above', 'below']

  for (const placement of placements) {
    for (const aspect of [0.5, 2, 8]) {
      it(`${placement}, forhold ${aspect}: midtstilt og klar av begge linjene og indikatoren`, () => {
        const presentation = withLogo(
          deck(),
          logo({ aspect, sections: { visibility: 'all', placement, height: SLIDE_HEIGHT } }),
        )
        const layout = deckLogoLayout(presentation)
        const options = sectionGeometryForTheme(presentation.theme)
        const geometry = computeSectionGeometry(options)
        for (const index of [0, 2]) {
          const floor = sectionFloor(index === 0)
          const section = sectionAt(presentation, index)
          const rect = sectionLogoRect(layout, section, presentation.theme)!
          expect(rect.height).toBeGreaterThanOrEqual(LOGO_MIN_HEIGHT)
          expect(rect.x + rect.width / 2).toBeCloseTo(SLIDE_WIDTH / 2)
          expect(rect.x).toBeGreaterThanOrEqual(options.inset! - EPSILON)
          expect(rect.y).toBeGreaterThanOrEqual(options.inset! - EPSILON)
          expect(rect.y + rect.height).toBeLessThanOrEqual(floor - options.inset! + EPSILON)
          // Begge linjene slik editoren tegner dem, også den tomme plassholderen.
          const block = {
            ...geometry.blockRect,
            y: geometry.blockRect.y - options.gap!,
            height: geometry.blockRect.height + options.gap! * 2,
          }
          expect(overlaps(rect, block)).toBe(false)
        }
      })
    }
  }

  it('står midt mellom linjene og sidens faktiske kant, med og uten underoverskrift', () => {
    const presentation = withLogo(
      deck(),
      logo({ sections: { visibility: 'all', placement: 'below', height: 40 } }),
    )
    const layout = deckLogoLayout(presentation)
    const geometry = computeSectionGeometry(sectionGeometryForTheme(presentation.theme))
    const centre = (rect: Rect) => rect.y + rect.height / 2

    // Forsiden har underoverskrift og ingen fremdriftsindikator: slidens bunn.
    const front = sectionLogoRect(layout, sectionAt(presentation, 0), presentation.theme)!
    const frontBottom = geometry.blockRect.y + geometry.blockRect.height
    expect(centre(front)).toBeCloseTo((frontBottom + SLIDE_HEIGHT) / 2, 9)

    // En senere inndeling uten underoverskrift: overskriftens underkant, og
    // oversiden av indikatoren.
    const later = sectionLogoRect(layout, sectionAt(presentation, 2), presentation.theme)!
    const area = geometry.areaRect
    const titleBottom = area.y + (area.height + geometry.titlePillHeight) / 2
    expect(centre(later)).toBeCloseTo((titleBottom + SLIDE_HEIGHT - PROGRESS_BAR_HEIGHT) / 2, 9)

    // Og over overskriften: midt mellom slidens overkant og overskriftens overkant.
    const above = withLogo(deck(), logo({ sections: { visibility: 'all', placement: 'above', height: 40 } }))
    const aboveLayout = deckLogoLayout(above)
    expect(centre(sectionLogoRect(aboveLayout, sectionAt(above, 0), above.theme)!)).toBeCloseTo(
      geometry.blockRect.y / 2,
      9,
    )
    const titleTop = area.y + (area.height - geometry.titlePillHeight) / 2
    expect(centre(sectionLogoRect(aboveLayout, sectionAt(above, 2), above.theme)!)).toBeCloseTo(titleTop / 2, 9)
  })

  it('står bare på forsiden når det er valgt', () => {
    const presentation = withLogo(deck(), logo({ sections: { visibility: 'front', placement: 'below', height: 80 } }))
    const layout = deckLogoLayout(presentation)
    expect(sectionLogoRect(layout, sectionAt(presentation, 0), presentation.theme)).not.toBeNull()
    expect(sectionLogoRect(layout, sectionAt(presentation, 2), presentation.theme)).toBeNull()
  })

  it('står ikke på noen inndeling når det er valgt', () => {
    const presentation = withLogo(deck(), logo({ sections: { visibility: 'none', placement: 'above', height: 80 } }))
    expect(deckLogoLayout(presentation)?.sections).toBeNull()
  })

  it('har samme størrelse på alle inndelingene', () => {
    const presentation = withLogo(deck(), logo({ sections: { visibility: 'all', placement: 'above', height: SLIDE_HEIGHT } }))
    const layout = deckLogoLayout(presentation)
    const front = sectionLogoRect(layout, sectionAt(presentation, 0), presentation.theme)!
    const later = sectionLogoRect(layout, sectionAt(presentation, 2), presentation.theme)!
    expect(front.height).toBe(later.height)
    expect(front.width).toBe(later.width)
  })
})
