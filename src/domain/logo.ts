/**
 * Logoen: hvor stor den kan være, hvor den står, og hva den reserverer (§ 15.2).
 *
 * Alt her er ren, deterministisk geometri i det logiske 1600 × 900-rommet, og
 * det er det eneste stedet logoens plass regnes ut. Stage, miniatyrbilder,
 * presentasjonsmodus, delte presentasjoner, headless rendering, kommandoenes
 * fit-kontroll og agentens geometri leser alle det samme svaret – en logo kan
 * derfor ikke stå ett sted i editoren og et annet i presentasjonen.
 *
 * To grupper, hver med én størrelse og én plassering for alle sidene i den:
 *
 *  - **Inndelinger**: forsiden alene eller alle inndelinger, over eller under
 *    overskriften, alltid vannrett midtstilt. Logoen flytter aldri linjene.
 *  - **Vanlige slides**: én av åtte plasser. Logoen reserverer en stripe langs
 *    én kant av innholdsområdet (`LogoReservation`), og tittelsonen og
 *    hovedsonen deler det som er igjen – med det samme ene gapet mellom seg
 *    og logoen som mellom alt annet.
 *
 * Den lagrede høyden er et ønske. Det som tegnes er det minste av ønsket og
 * den største høyden **hver** side i gruppen har plass til – for en vanlig
 * slide er det den som lar hovedsonens tre fortsatt holde sitt harde
 * minstemål. En senere endring i innholdet (en underoverskrift, en ny deling)
 * gjør derfor logoen mindre i stedet for å legge den over noe, uten at
 * dokumentet skrives om. Er det ikke plass til `LOGO_MIN_HEIGHT` en gang,
 * tegnes logoen ikke i den gruppen.
 */

import {
  LOGO_MIN_HEIGHT,
  PROGRESS_BAR_HEIGHT,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type LogoSectionPlacement,
  type LogoSlidePosition,
} from './constants'
import {
  computeMainRect,
  computeSectionGeometry,
  minimumSizeFor,
  type GeometryOptions,
  type LogoReservation,
  type SectionGeometry,
} from './geometry'
import { geometryForTheme, sectionGeometryForTheme } from './metrics'
import { isDocEmpty } from './richdoc'
import type { PresentationTheme, Rect, SectionSlide, Slide, ThemeLogo } from './types'

/** Det logoens plass avhenger av: temaet og sidene. Et snapshot har det samme. */
export interface LogoDeck {
  theme: PresentationTheme
  slides: readonly Slide[]
}

export interface SectionLogoLayout {
  /** Forsiden alene, eller alle inndelinger. */
  pages: 'front' | 'all'
  frontId: string
  placement: LogoSectionPlacement
  height: number
  width: number
}

export interface SlideLogoLayout {
  position: LogoSlidePosition
  height: number
  width: number
  reservation: LogoReservation
}

/** Logoen slik den tegnes i dette dekket, eller `null` uten logo. */
export interface DeckLogoLayout {
  assetId: string
  aspect: number
  /** `null` når logoen ikke står på noen inndeling, eller ikke får plass. */
  sections: SectionLogoLayout | null
  /** `null` når logoen er slått av på vanlige slides, eller ikke får plass. */
  slides: SlideLogoLayout | null
}

/** Den største høyden hver gruppe har plass til akkurat nå. */
export interface LogoLimits {
  sections: number
  slides: number
}

/** Filene temaet viser: logoen, når det har en. */
export function themeAssetIds(theme: PresentationTheme): string[] {
  return theme.logo ? [theme.logo.assetId] : []
}

/**
 * Temaet med logoen pekt om til en ny fil-id – samme kart som innholdet får
 * ved import, innliming, kopiering og sammenslåing av like filer.
 */
export function remapThemeAssetIds(
  theme: PresentationTheme,
  map: ReadonlyMap<string, string>,
): PresentationTheme {
  const logo = theme.logo
  const assetId = logo ? map.get(logo.assetId) : undefined
  return logo && assetId && assetId !== logo.assetId ? { ...theme, logo: { ...logo, assetId } } : theme
}

/**
 * Temaet uten logoen når filen dens forsvinner. En logo som peker på en fil
 * som ikke finnes, kan ikke tegnes – akkurat som et bilde i teksten.
 */
export function dropThemeAssetIds(
  theme: PresentationTheme,
  ids: ReadonlySet<string>,
): PresentationTheme {
  return theme.logo && ids.has(theme.logo.assetId) ? themeWithoutLogo(theme) : theme
}

/** Temaet uten logo. */
export function themeWithoutLogo(theme: PresentationTheme): PresentationTheme {
  if (!theme.logo) return theme
  const next = { ...theme }
  delete next.logo
  return next
}

/* ------------------------------------------------------------------ *
 * Inndelinger
 * ------------------------------------------------------------------ */

/** Hvor høy og hvor bred den tegnede blokken er for en inndeling, og hvor den står. */
interface SectionBlock {
  /** Overkant og underkant av linjene slik de tegnes i dekket. */
  top: number
  bottom: number
}

/**
 * Hvor linjene står når dekket vises – underoverskriften er med bare når den
 * har tekst – og hvor de står i editoren, der den tomme plassholderen også
 * tegnes. Logoen plasseres etter det første og holder avstand til begge, så
 * den aldri ligger over noe, verken i presentasjonen eller mens det skrives.
 */
function sectionBlocks(geometry: SectionGeometry, section: SectionSlide): {
  shown: SectionBlock
  drawn: SectionBlock
} {
  const both = { top: geometry.blockRect.y, bottom: geometry.blockRect.y + geometry.blockRect.height }
  if (!isDocEmpty(section.subtitle)) return { shown: both, drawn: both }
  const area = geometry.areaRect
  const top = area.y + (area.height - geometry.titlePillHeight) / 2
  return { shown: { top, bottom: top + geometry.titlePillHeight }, drawn: both }
}

/**
 * Sideflatens nederste kant for en inndeling: slidens bunn på forsiden, som
 * ikke har fremdriftsindikator, og oversiden av indikatoren på de senere.
 */
export function sectionFloor(isFront: boolean): number {
  return isFront ? SLIDE_HEIGHT : SLIDE_HEIGHT - PROGRESS_BAR_HEIGHT
}

/** Logoens sentrum på en inndeling, i høyden. */
function sectionLogoCentre(block: SectionBlock, placement: LogoSectionPlacement, floor: number): number {
  return placement === 'above' ? block.top / 2 : (block.bottom + floor) / 2
}

/** Den største logohøyden én inndeling har plass til. */
function sectionMaxHeight(
  section: SectionSlide,
  isFront: boolean,
  placement: LogoSectionPlacement,
  geometry: SectionGeometry,
  gap: number,
  inset: number,
): number {
  const { shown, drawn } = sectionBlocks(geometry, section)
  const floor = sectionFloor(isFront)
  const centre = sectionLogoCentre(shown, placement, floor)
  if (placement === 'above') {
    return Math.min(2 * (drawn.top - gap - centre), 2 * (centre - inset))
  }
  return Math.min(2 * (centre - drawn.bottom - gap), 2 * (floor - inset - centre))
}

function sectionsWithLogo(logo: ThemeLogo, slides: readonly Slide[]): SectionSlide[] {
  const sections = slides.filter((slide): slide is SectionSlide => slide.kind === 'section')
  if (logo.sections.visibility === 'none') return []
  return logo.sections.visibility === 'front' ? sections.slice(0, 1) : sections
}

function sectionLimit(deck: LogoDeck, logo: ThemeLogo): number {
  const options = sectionGeometryForTheme(deck.theme)
  const geometry = computeSectionGeometry(options)
  const widest = (SLIDE_WIDTH - options.inset * 2) / logo.aspect
  let limit = widest
  const frontId = deck.slides[0]?.id
  for (const section of sectionsWithLogo(logo, deck.slides)) {
    limit = Math.min(
      limit,
      sectionMaxHeight(
        section,
        section.id === frontId,
        logo.sections.placement,
        geometry,
        options.gap,
        options.inset,
      ),
    )
  }
  return Math.max(0, Math.floor(limit))
}

/** Logoens rektangel på én inndeling, eller `null` når den ikke står der. */
export function sectionLogoRect(
  layout: DeckLogoLayout | null,
  section: SectionSlide,
  theme: PresentationTheme,
): Rect | null {
  const placed = layout?.sections
  if (!placed) return null
  if (placed.pages === 'front' && section.id !== placed.frontId) return null
  const geometry = computeSectionGeometry(sectionGeometryForTheme(theme))
  const floor = sectionFloor(section.id === placed.frontId)
  const centre = sectionLogoCentre(sectionBlocks(geometry, section).shown, placed.placement, floor)
  return {
    x: (SLIDE_WIDTH - placed.width) / 2,
    y: centre - placed.height / 2,
    width: placed.width,
    height: placed.height,
  }
}

/* ------------------------------------------------------------------ *
 * Vanlige slides
 * ------------------------------------------------------------------ */

function edgeOf(position: LogoSlidePosition): LogoReservation['edge'] {
  if (position.startsWith('top')) return 'top'
  if (position.startsWith('bottom')) return 'bottom'
  return position === 'left' ? 'left' : 'right'
}

/** Hvor logoen står på tvers av en vannrett stripe. */
function alongOf(position: LogoSlidePosition): 'start' | 'centre' | 'end' {
  if (position.endsWith('left')) return 'start'
  if (position.endsWith('right')) return 'end'
  return 'centre'
}

/**
 * Den største logohøyden én vanlig slide har plass til i en plassering: det
 * som lar hovedsonens tre fortsatt holde sitt harde minstemål.
 */
function slideMaxHeight(
  hasTitle: boolean,
  minimum: { width: number; height: number },
  edge: LogoReservation['edge'],
  aspect: number,
  geometry: ReturnType<typeof geometryForTheme>,
): number {
  const { gap, inset, titleHeight } = geometry
  const width = SLIDE_WIDTH - inset * 2
  const height = SLIDE_HEIGHT - inset * 2 - PROGRESS_BAR_HEIGHT
  const titlePart = hasTitle ? titleHeight + gap : 0
  if (edge === 'top' || edge === 'bottom') {
    return Math.min(height - titlePart - gap - minimum.height, width / aspect)
  }
  // Bredden rundes ned før den blir en høyde, så stripen som reserveres – rundet
  // opp til hele enheter – aldri blir bredere enn plassen.
  return Math.min(Math.floor(width - gap - minimum.width) / aspect, height - titlePart)
}

function slideLimit(deck: LogoDeck, logo: ThemeLogo): number {
  const geometry = geometryForTheme(deck.theme)
  const edge = edgeOf(logo.slides.position)
  // En referanseslide har tittel og fordeler innholdet sitt på så mange sider
  // som trengs, så den stiller bare kravet en tom slide med tittel stiller.
  let limit = slideMaxHeight(true, { width: 0, height: 0 }, edge, logo.aspect, geometry)
  for (const slide of deck.slides) {
    if (slide.kind !== 'content') continue
    const minimum = minimumSizeFor(slide.root, geometry)
    limit = Math.min(
      limit,
      slideMaxHeight(slide.title !== null, minimum, edge, logo.aspect, geometry),
    )
  }
  return Math.max(0, Math.floor(limit))
}

/** Logoens rektangel på en vanlig slide. `options` er dekkets egne (`geometryForDeck`). */
export function slideLogoRect(
  layout: DeckLogoLayout | null,
  hasTitle: boolean,
  options: GeometryOptions,
): Rect | null {
  const placed = layout?.slides
  if (!placed) return null
  const inset = options.inset ?? geometryForTheme().inset
  const progress = options.progressHeight ?? PROGRESS_BAR_HEIGHT
  const { height, width } = placed
  const edge = placed.reservation.edge
  if (edge === 'top' || edge === 'bottom') {
    const along = alongOf(placed.position)
    const x =
      along === 'start' ? inset : along === 'end' ? SLIDE_WIDTH - inset - width : (SLIDE_WIDTH - width) / 2
    const y = edge === 'top' ? inset : SLIDE_HEIGHT - inset - progress - height
    return { x, y, width, height }
  }
  const main = computeMainRect(hasTitle, { ...options, logo: placed.reservation })
  return {
    x: edge === 'left' ? inset : SLIDE_WIDTH - inset - width,
    y: main.y + (main.height - height) / 2,
    width,
    height,
  }
}

/* ------------------------------------------------------------------ *
 * Dekket
 * ------------------------------------------------------------------ */

/** Hvor stor logoen kan bli i hver gruppe, slik dekket står nå. */
export function logoLimits(deck: LogoDeck): LogoLimits | null {
  const logo = deck.theme.logo
  if (!logo) return null
  return { sections: sectionLimit(deck, logo), slides: slideLimit(deck, logo) }
}

/** Det som tegnes: ønsket høyde, men aldri mer enn plassen – og ingenting under minstemålet. */
function drawnHeight(wanted: number, limit: number): number | null {
  const height = Math.min(Math.floor(wanted), limit)
  return height >= LOGO_MIN_HEIGHT ? height : null
}

/** Svaret for et dekk, husket så lenge sidene og temaet er de samme objektene. */
const layouts = new WeakMap<readonly Slide[], { theme: PresentationTheme; layout: DeckLogoLayout | null }>()

/**
 * Logoen slik den tegnes i dette dekket.
 *
 * Kalles fra hver vei som spør om geometri, så svaret huskes per dekk: et
 * dokument er uforanderlig, og samme sider og samme tema gir samme svar.
 */
export function deckLogoLayout(deck: LogoDeck): DeckLogoLayout | null {
  const cached = layouts.get(deck.slides)
  if (cached && cached.theme === deck.theme) return cached.layout
  const layout = computeDeckLogoLayout(deck)
  layouts.set(deck.slides, { theme: deck.theme, layout })
  return layout
}

function computeDeckLogoLayout(deck: LogoDeck): DeckLogoLayout | null {
  const logo = deck.theme.logo
  if (!logo) return null
  const limits = logoLimits(deck)!
  const front = deck.slides[0]

  let sections: SectionLogoLayout | null = null
  const sectionHeight =
    logo.sections.visibility === 'none' ? null : drawnHeight(logo.sections.height, limits.sections)
  if (sectionHeight !== null && front?.kind === 'section') {
    sections = {
      pages: logo.sections.visibility === 'all' ? 'all' : 'front',
      frontId: front.id,
      placement: logo.sections.placement,
      height: sectionHeight,
      width: sectionHeight * logo.aspect,
    }
  }

  let slides: SlideLogoLayout | null = null
  const slideHeight = logo.slides.visible ? drawnHeight(logo.slides.height, limits.slides) : null
  if (slideHeight !== null) {
    const edge = edgeOf(logo.slides.position)
    const width = slideHeight * logo.aspect
    slides = {
      position: logo.slides.position,
      height: slideHeight,
      width,
      reservation: { edge, size: edge === 'top' || edge === 'bottom' ? slideHeight : Math.ceil(width) },
    }
  }

  return { assetId: logo.assetId, aspect: logo.aspect, sections, slides }
}

/** Stripen logoen reserverer på dekkets vanlige slides, eller `null`. */
export function logoReservationFor(deck: LogoDeck): LogoReservation | null {
  return deckLogoLayout(deck)?.slides?.reservation ?? null
}

/**
 * Geometrien til en vanlig slide i dette dekket: temaets gap og tittelsone,
 * og logoens stripe. Den ene inngangen alle som spør hvor noe er på en slide i
 * et dekk, går gjennom.
 */
export function geometryForDeck(deck: LogoDeck): ReturnType<typeof geometryForTheme> & {
  logo: LogoReservation | null
} {
  return { ...geometryForTheme(deck.theme), logo: logoReservationFor(deck) }
}
