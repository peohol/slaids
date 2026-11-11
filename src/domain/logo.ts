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
  LOGO_SECTION_PLACEMENTS,
  LOGO_SLIDE_POSITIONS,
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

/** Det en endring av logoen kan si noe om. Det som ikke nevnes, står. */
export interface ThemeLogoPatch {
  sections?: Partial<ThemeLogo['sections']>
  slides?: Partial<ThemeLogo['slides']>
}

/** Logoen med endringen gjort. Det ene stedet en endring slås sammen med det som står. */
export function patchedLogo(logo: ThemeLogo, patch: ThemeLogoPatch): ThemeLogo {
  return {
    ...logo,
    sections: { ...logo.sections, ...patch.sections },
    slides: { ...logo.slides, ...patch.slides },
  }
}

/** Dekket slik det ville stått med endringen – for en forhåndsvisning, uten å lagre noe. */
export function withLogoPatch<T extends LogoDeck>(deck: T, patch: ThemeLogoPatch): T {
  const logo = deck.theme.logo
  if (!logo) return deck
  return { ...deck, theme: { ...deck.theme, logo: patchedLogo(logo, patch) } }
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

/* ------------------------------------------------------------------ *
 * Direkte manipulering (§ 15.3)
 * ------------------------------------------------------------------ */

/** De to gruppene logoen har én plassering og én størrelse i. */
export type LogoGroup = 'sections' | 'slides'

/** Et valg av plass i en gruppe: en av de åtte plassene, eller over/under overskriften. */
export type LogoChoice = LogoSlidePosition | LogoSectionPlacement

/** Siden logoen står på: den bestemmer gruppen, og hvor på siden logoen tegnes. */
export type LogoPage =
  | { kind: 'slide'; hasTitle: boolean }
  | { kind: 'section'; section: SectionSlide }

export interface Point {
  x: number
  y: number
}

export function logoGroupOf(page: LogoPage): LogoGroup {
  return page.kind === 'slide' ? 'slides' : 'sections'
}

const GROUP_CHOICES: Record<LogoGroup, readonly LogoChoice[]> = {
  slides: LOGO_SLIDE_POSITIONS,
  sections: LOGO_SECTION_PLACEMENTS,
}

/** Valget logoen står i nå, i gruppen. */
export function logoChoiceOf(logo: ThemeLogo, group: LogoGroup): LogoChoice {
  return group === 'slides' ? logo.slides.position : logo.sections.placement
}

/** Endringen som setter plassen og/eller høyden i én gruppe. */
export function logoGroupPatch(
  group: LogoGroup,
  change: { choice?: LogoChoice; height?: number },
): ThemeLogoPatch {
  const height = change.height === undefined ? {} : { height: change.height }
  if (group === 'slides') {
    const position = change.choice === undefined ? {} : { position: change.choice as LogoSlidePosition }
    return { slides: { ...position, ...height } }
  }
  const placement = change.choice === undefined ? {} : { placement: change.choice as LogoSectionPlacement }
  return { sections: { ...placement, ...height } }
}

/** Logoens rektangel på siden – den samme utregningen sidene selv tegner med. */
export function logoRectOnPage(
  layout: DeckLogoLayout | null,
  page: LogoPage,
  theme: PresentationTheme,
): Rect | null {
  if (page.kind === 'section') return sectionLogoRect(layout, page.section, theme)
  return slideLogoRect(layout, page.hasTitle, {
    ...geometryForTheme(theme),
    logo: layout?.slides?.reservation ?? null,
  })
}

function centreOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

export interface LogoMoveTarget {
  choice: LogoChoice
  /** Logoens sentrum på siden når den står her. */
  centre: Point
}

/**
 * Plassene logoen kan dras til på denne siden, med sentrum slik den ville
 * tegnes der. En plass der det ikke er plass til minstemålet, er ikke med –
 * logoen slippes aldri der den ikke kan tegnes.
 */
export function logoMoveTargets(deck: LogoDeck, page: LogoPage): LogoMoveTarget[] {
  const group = logoGroupOf(page)
  return GROUP_CHOICES[group].flatMap((choice) => {
    // Regnet uten hurtigbufferen: den husker dekkets egen logo, ikke kandidatene.
    const layout = computeDeckLogoLayout(withLogoPatch(deck, logoGroupPatch(group, { choice })))
    const rect = logoRectOnPage(layout, page, deck.theme)
    return rect ? [{ choice, centre: centreOf(rect) }] : []
  })
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Plassen nærmest punktet. Den logoen allerede står på, vinner til en annen
 * er `hysteresis` nærmere – ellers hopper logoen fram og tilbake nær grensen.
 */
export function nearestLogoTarget(
  targets: readonly LogoMoveTarget[],
  point: Point,
  current: LogoChoice,
  hysteresis: number,
): LogoChoice {
  let best: LogoChoice = current
  let bestDistance = Number.POSITIVE_INFINITY
  for (const target of targets) {
    const measured = distance(target.centre, point) - (target.choice === current ? hysteresis : 0)
    if (measured < bestDistance) {
      best = target.choice
      bestDistance = measured
    }
  }
  return best
}

/** Håndtakene: fire hjørner og fire kanter, som kompassretninger. */
export const LOGO_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type LogoHandle = (typeof LOGO_HANDLES)[number]

/** Hvilken vei «bort fra sentrum» er for hvert håndtak. */
export const LOGO_HANDLE_DIRECTION: Record<LogoHandle, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
  nw: { x: -1, y: -1 },
  n: { x: 0, y: -1 },
  ne: { x: 1, y: -1 },
  e: { x: 1, y: 0 },
  se: { x: 1, y: 1 },
  s: { x: 0, y: 1 },
  sw: { x: -1, y: 1 },
  w: { x: -1, y: 0 },
}

/** Hva som står fast langs en akse: venstre/øvre kant, høyre/nedre kant, eller midten. */
export type LogoAnchor = 'start' | 'end' | 'centre'

/**
 * Hvor logoen er festet når den vokser, langs hver akse. En logo i et hjørne
 * står fast mot de to kantene av siden; en logo midt på en kant står fast mot
 * den kanten og vokser like mye til begge sider langs den; på en inndeling
 * står sentrum fast.
 */
export function logoAnchor(layout: DeckLogoLayout, page: LogoPage): { x: LogoAnchor; y: LogoAnchor } {
  const placed = layout.slides
  if (page.kind === 'section' || !placed) return { x: 'centre', y: 'centre' }
  const edge = placed.reservation.edge
  if (edge === 'left' || edge === 'right') return { x: edge === 'left' ? 'start' : 'end', y: 'centre' }
  return { x: alongOf(placed.position), y: edge === 'top' ? 'start' : 'end' }
}

/**
 * Hvor mye en kant flytter seg når logoen blir én enhet større langs en akse:
 * 1 når den motsatte kanten står fast, ½ når logoen er midtstilt på den aksen
 * og vokser like mye til begge sider. Med den følger håndtaket pekeren i
 * stedet for å løpe fra den eller henge etter.
 */
export function logoGrowth(layout: DeckLogoLayout, page: LogoPage): Point {
  const anchor = logoAnchor(layout, page)
  return { x: anchor.x === 'centre' ? 0.5 : 1, y: anchor.y === 'centre' ? 0.5 : 1 }
}

/** Om en kant i denne retningen kan flytte seg, når aksen er festet slik. */
function movable(direction: -1 | 0 | 1, anchor: LogoAnchor): boolean {
  if (direction === 0 || anchor === 'centre') return true
  return anchor === 'start' ? direction === 1 : direction === -1
}

/**
 * Håndtakene som følger pekeren: de på kanter som faktisk flytter seg når
 * logoen vokser. Et håndtak på en kant som står fast mot siden, ville bli
 * stående mens logoen vokste vekk fra det, så det tilbys ikke.
 */
export function logoHandlesFor(layout: DeckLogoLayout, page: LogoPage): LogoHandle[] {
  const anchor = logoAnchor(layout, page)
  return LOGO_HANDLES.filter((handle) => {
    const direction = LOGO_HANDLE_DIRECTION[handle]
    return movable(direction.x, anchor.x) && movable(direction.y, anchor.y)
  })
}

/**
 * Høyden et dra i et håndtak gir. Bort fra sentrum forstørrer, mot sentrum
 * forminsker, og formen står. Et hjørne følger den aksen pekeren har flyttet
 * seg mest langs. Høyden holdes mellom minstemålet og det gruppen har plass til.
 */
export function resizedLogoHeight(input: {
  height: number
  aspect: number
  handle: LogoHandle
  delta: Point
  growth: Point
  limit: number
}): number {
  const { height, aspect, handle, delta, growth, limit } = input
  const direction = LOGO_HANDLE_DIRECTION[handle]
  const changes: number[] = []
  if (direction.y !== 0) changes.push((direction.y * delta.y) / growth.y)
  if (direction.x !== 0) changes.push((direction.x * delta.x) / growth.x / aspect)
  const change = changes.reduce((largest, each) => (Math.abs(each) > Math.abs(largest) ? each : largest), 0)
  return Math.min(Math.max(Math.round(height + change), LOGO_MIN_HEIGHT), Math.max(limit, LOGO_MIN_HEIGHT))
}
