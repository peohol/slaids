/**
 * What can be done to a picture without anybody noticing.
 *
 * A stored file is often far larger than what a slide ever shows of it: a
 * twelve-megapixel photograph behind a frame a quarter of a slide wide, with
 * half of it hidden by the crop. This module answers, from the document alone,
 * how much of each file is actually on screen — which pixels, and at what size
 * — so the optimiser can throw away what nobody can see and keep exactly what
 * everybody can.
 *
 * It is the *planning* half and it is pure: geometry in, a plan out, and not
 * a byte of image data anywhere in it. The pixels are read, cropped, scaled
 * and re-encoded by `state/imagePipeline.ts`, in the browser, off the main
 * thread; the document is rewritten by `commands/assets.ts`. Keeping the plan
 * here is what lets the rules be tested as arithmetic rather than as
 * screenshots, and what keeps the agent bundle — which has no canvas — able to
 * import the same reasoning.
 *
 * Three rules hold everywhere in this file:
 *
 *  - **What is shown is decided by the same geometry that draws it.** A frame is
 *    the zone rectangle `geometry.ts` computes, less a title panel's header
 *    where there is one; the crop is `imageGeometry.ts`, the very arithmetic
 *    `object-fit: cover` performs. There is no second model of where a picture
 *    sits.
 *  - **A file is never made larger than it is.** The required size is a ceiling
 *    the file may be brought down to, never a floor to scale it up to.
 *  - **A shared file is sized by its largest use.** One file behind three
 *    frames is downscaled to what the biggest of them needs, and cropped for
 *    none of them: what is hidden in one frame may be exactly what another
 *    shows. A crop for one frame is a *fork* — a new file for that one panel.
 */

import { geometryForDeck } from './logo'
import {
  INLINE_IMAGE_DEFAULT_ASPECT,
  OPTIMIZATION_PIXEL_DENSITY,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from './constants'
import { imagePanelOf } from './content'
import { slideContent } from './docs'
import { computeSlideGeometry, type Size } from './geometry'
import { coverScale, visibleSourceRect } from './imageGeometry'
import { collectLeaves, findLeaf } from './layout'
import { themeMetrics } from './metrics'
import { findContentSlide } from './presentation'
import { inlineImageOf, walkRichNodes } from './richdoc'
import type {
  AssetRef,
  CardBody,
  Presentation,
  Rect,
  RichDoc,
  ZoneContent,
} from './types'

/* ------------------------------------------------------------------ *
 * Thresholds
 *
 * Named, and here rather than spread over the places that read them, because
 * each of them is a product decision about when a change is worth making.
 * ------------------------------------------------------------------ */

/**
 * A downscale has to remove at least this much of each side to be worth a
 * re-encode: a file brought from 1000 to 950 pixels wide gains almost nothing
 * and costs a generation of compression.
 */
export const MIN_DOWNSCALE_RATIO = 0.9

/**
 * A crop has to hide at least this share of the file's pixels to count as one.
 * Below it the "hidden" part is a sliver of rounding, and rewriting a file to
 * remove it would be churn with an irreversible warning attached.
 */
export const MIN_CROP_SHARE = 0.01

/**
 * A re-encode that changes no pixels — the same picture in a smaller container
 * — has to save at least this share of the bytes to replace the file. Anything
 * that *does* change pixels (a crop, a downscale) is kept as soon as it is
 * smaller at all: the pixels are the point, the bytes follow.
 */
export const MIN_RECODE_SAVING_RATIO = 0.1

/**
 * Lossy quality, conservative on purpose: normally indistinguishable from the
 * source on a projector or a laptop screen, at a fraction of the bytes.
 */
export const WEBP_QUALITY = 0.85
export const JPEG_QUALITY = 0.88

/**
 * When a picture counts as a photograph — see `isPhotographic`.
 *
 * Read off a sample of the decoded pixels: how often a pixel is identical to
 * the one beside it, and how many distinct colours the sample holds. Text,
 * screenshots and diagrams are flat and few-coloured; a photograph is neither.
 * Both thresholds lean towards "graphics" when unsure, because the two mistakes
 * are not symmetric: a photograph stored losslessly costs bytes, a diagram
 * stored lossily costs visible artefacts around every edge.
 */
export const PHOTO_MAX_FLAT_FRACTION = 0.4
export const PHOTO_MIN_DISTINCT_FRACTION = 0.2

/* ------------------------------------------------------------------ *
 * Where a file is shown
 * ------------------------------------------------------------------ */

/**
 * One place a file is on screen, and how big that place is.
 *
 *  - `panel` — the file is the face of a zone: a picture, or the body of a
 *    titled image card. `frame` is the box it covers, in logical pixels, and
 *    `focus` says which part of the overflow is hidden.
 *  - `inline` — the file stands in the flow of a text field. `box` is the box
 *    it is contained in: its share of the column, and the height that share
 *    gives it at the aspect the document stores.
 *  - `sandbox` — the file is parked, not placed. Nothing says where it will
 *    land, so it is sized as though it could fill a whole slide, and it can
 *    never be cropped.
 */
export type AssetOccurrence =
  | PanelOccurrence
  | { kind: 'inline'; slideId: string; nodeId: string; box: Size }
  | { kind: 'sandbox'; itemId: string }

export interface PanelOccurrence {
  kind: 'panel'
  slideId: string
  nodeId: string
  frame: Size
  focus: { x: number; y: number }
}

/** The one frame a parked or unplaced picture might one day fill: the slide. */
const WHOLE_SLIDE: Size = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT }

/**
 * Every place every file is shown, keyed by asset id.
 *
 * Walks the same content `usedAssetIds` walks — zones on slides and the sandbox
 * — so a file this map does not list is a file nothing shows, and vice versa.
 * A file that is listed in `assets` but shown nowhere gets an empty list.
 */
export function assetOccurrences(presentation: Presentation): Map<string, AssetOccurrence[]> {
  const occurrences = new Map<string, AssetOccurrence[]>()
  for (const asset of presentation.assets) occurrences.set(asset.id, [])
  const add = (assetId: string, occurrence: AssetOccurrence): void => {
    const list = occurrences.get(assetId)
    if (list) list.push(occurrence)
    else occurrences.set(assetId, [occurrence])
  }

  const tokens = themeMetrics(presentation.theme)
  const options = geometryForDeck(presentation)

  for (const slide of presentation.slides) {
    if (slide.kind !== 'content') continue
    const geometry = computeSlideGeometry(slide, options)
    for (const leaf of collectLeaves(slide.root)) {
      if (!leaf.content) continue
      const rect = geometry.rects.get(leaf.id)
      if (!rect) continue
      const content = leaf.content
      const panel = imagePanelOf(content)
      if (panel?.assetId) {
        add(panel.assetId, {
          kind: 'panel',
          slideId: slide.id,
          nodeId: leaf.id,
          frame: panelFrame(content, rect, tokens.cardBodyOffset),
          focus: panel.focus,
        })
      }
      for (const { assetId, box } of inlineBoxes(content, rect, tokens)) {
        add(assetId, { kind: 'inline', slideId: slide.id, nodeId: leaf.id, box })
      }
    }
  }

  const addParked = (content: ZoneContent, itemId: string): void => {
    const panel = imagePanelOf(content)
    if (panel?.assetId) add(panel.assetId, { kind: 'sandbox', itemId })
    for (const doc of docsWithImages(content)) {
      walkRichNodes(doc, (node) => {
        const image = inlineImageOf(node)
        if (image) add(image.assetId, { kind: 'sandbox', itemId })
      })
    }
  }
  for (const item of presentation.sandbox) addParked(item.content, item.id)
  for (const slide of presentation.sandboxSlides ?? []) {
    for (const content of slideContent([slide])) addParked(content, slide.id)
  }

  return occurrences
}

/**
 * The box a picture panel covers.
 *
 * A picture that is the whole zone covers the whole zone; the body of a titled
 * image card is the zone less the header along the top (and the gap under a
 * floating one — `cardBodyOffset`) — the same subtraction
 * `estimateFit` makes for its caption, and the same header height the renderer
 * gives the panel.
 */
export function panelFrame(content: ZoneContent, rect: Rect, cardBodyOffset: number): Size {
  if (content.kind === 'titled-image-card') {
    return { width: rect.width, height: Math.max(0, rect.height - cardBodyOffset) }
  }
  return { width: rect.width, height: rect.height }
}

/**
 * The boxes of the pictures standing inline in this content's text.
 *
 * A picture in a field is `widthPercent` of the field's column, and as tall as
 * that width divided by the aspect the document stores (the file's own ratio,
 * or the stylesheet's default when the node predates it). The column is the
 * subfield's width: the zone less a card's padding, divided among side-by-side
 * subfields the way `estimateBodyOverflow` divides it — the same arithmetic,
 * because the same layout is being described.
 *
 * The field's own height caps a figure (`max-height: 100%`), which can only
 * make it *smaller* than the box says. Ignoring the cap therefore keeps more
 * pixels than strictly needed, never fewer, which is the safe error.
 */
function inlineBoxes(
  content: ZoneContent,
  rect: Rect,
  tokens: { cardPadding: number; subfieldGap: number },
): { assetId: string; box: Size }[] {
  const out: { assetId: string; box: Size }[] = []
  const collect = (doc: RichDoc, column: number): void => {
    walkRichNodes(doc, (node) => {
      const image = inlineImageOf(node)
      if (!image) return
      const width = (column * image.widthPercent) / 100
      const ratio = image.aspect ?? INLINE_IMAGE_DEFAULT_ASPECT
      out.push({ assetId: image.assetId, box: { width, height: width / ratio } })
    })
  }

  switch (content.kind) {
    case 'container':
      for (const [doc, column] of subfieldColumns(content.body, rect.width, tokens.subfieldGap)) {
        collect(doc, column)
      }
      break
    case 'untitled-card':
    case 'titled-card': {
      const inner = rect.width - tokens.cardPadding * 2
      for (const [doc, column] of subfieldColumns(content.body, inner, tokens.subfieldGap)) {
        collect(doc, column)
      }
      break
    }
    case 'image':
    case 'titled-image-card':
      // A caption is one line of text with no picture node in its schema, and
      // a card title is the same; nothing inline can stand in either.
      break
    case 'negative-space':
      // Air holds no documents at all, so there is nothing to walk.
      break
  }
  return out
}

/** Each subfield's document with the width of the column it flows in. */
function subfieldColumns(body: CardBody, width: number, gap: number): [RichDoc, number][] {
  const count = body.subfields.length
  if (body.axis !== 'x') return body.subfields.map((field) => [field.doc, width])
  const total = body.weights.reduce((sum, weight) => sum + weight, 0) || count
  const usable = width - gap * (count - 1)
  return body.subfields.map((field, index) => [
    field.doc,
    usable * ((body.weights[index] ?? 1) / total),
  ])
}

/** The documents of this content that may hold an inline picture. */
function docsWithImages(content: ZoneContent): RichDoc[] {
  switch (content.kind) {
    case 'container':
    case 'untitled-card':
    case 'titled-card':
      return content.body.subfields.map((field) => field.doc)
    default:
      return []
  }
}

/* ------------------------------------------------------------------ *
 * How big a file has to be
 * ------------------------------------------------------------------ */

/**
 * The factor one occurrence draws the file at: logical pixels per file pixel.
 *
 * A panel covers its frame, so the larger ratio wins; an inline picture is
 * contained in its box, so the smaller one does. A parked file is measured as
 * if it covered a whole slide, which is the most any zone could ever ask of it.
 */
export function displayScale(occurrence: AssetOccurrence, natural: Size): number {
  switch (occurrence.kind) {
    case 'panel':
      return coverScale(occurrence.frame, natural)
    case 'inline':
      return Math.min(
        occurrence.box.width / natural.width,
        occurrence.box.height / natural.height,
      )
    case 'sandbox':
      return coverScale(WHOLE_SLIDE, natural)
  }
}

/**
 * The size a file has to keep to look sharp everywhere it is shown.
 *
 * Its largest use decides — a file behind a full-slide frame needs all of its
 * pixels even if a thumbnail of it elsewhere needs almost none — and the answer
 * is multiplied by `OPTIMIZATION_PIXEL_DENSITY`, so a high-DPI screen or a
 * moderate later enlargement still has real pixels to draw. Never larger than
 * the file: a small file shown large stays exactly as it is. Nothing is ever
 * scaled up.
 *
 * A file shown nowhere has no size to be brought down to and comes back as it
 * is: deleting it is `pruneAssets`'s business, not this module's.
 */
export function requiredSize(natural: Size, occurrences: readonly AssetOccurrence[]): Size {
  if (occurrences.length === 0 || natural.width <= 0 || natural.height <= 0) return natural
  const largest = Math.max(...occurrences.map((occurrence) => displayScale(occurrence, natural)))
  return scaledDown(natural, largest * OPTIMIZATION_PIXEL_DENSITY)
}

/** `natural` scaled by `factor`, only ever downwards, and never below a pixel. */
function scaledDown(natural: Size, factor: number): Size {
  if (!Number.isFinite(factor) || factor >= 1) return natural
  return {
    width: Math.max(1, Math.round(natural.width * factor)),
    height: Math.max(1, Math.round(natural.height * factor)),
  }
}

/** Whether going from `from` to `to` is a downscale worth a re-encode. */
export function isWorthDownscaling(from: Size, to: Size): boolean {
  return to.width <= from.width * MIN_DOWNSCALE_RATIO && to.height <= from.height * MIN_DOWNSCALE_RATIO
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

/**
 * What to do to the pixels of one file.
 *
 * `source` is the rectangle of the file to keep, in its own pixels and
 * fractional where the frame is — the whole file when nothing is cropped away.
 * `target` is the size to draw it at, never larger than `source`. When neither
 * `crop` nor `downscale` is set the two describe the file as it is, and the
 * only thing left to gain is a smaller container for the same pixels.
 */
export interface RasterPlan {
  source: Rect
  target: Size
  crop: boolean
  downscale: boolean
}

/** The whole file, at its own size: the plan that changes no pixel. */
export function identityPlan(natural: Size): RasterPlan {
  return {
    source: { x: 0, y: 0, width: natural.width, height: natural.height },
    target: natural,
    crop: false,
    downscale: false,
  }
}

/**
 * The plan for a file shown wherever `occurrences` says, cropped to none of
 * them: downscaled to its largest use when that is worth doing, else as it is.
 */
export function planShared(natural: Size, occurrences: readonly AssetOccurrence[]): RasterPlan {
  const target = requiredSize(natural, occurrences)
  if (!isWorthDownscaling(natural, target)) return identityPlan(natural)
  return { ...identityPlan(natural), target, downscale: true }
}

/**
 * The plan for a file shown in exactly one frame: cropped to what that frame
 * shows, and downscaled to what it needs.
 *
 * The visible rectangle is `visibleSourceRect`, so the pixels kept are
 * precisely the ones `object-fit: cover` is putting on screen. The target
 * keeps the frame's own proportions — the height is derived from the width
 * through the frame rather than rounded separately — so that once the file
 * *is* the frame's shape, `cover` has nothing left to hide and the picture
 * lands where it was to within a fraction of a pixel. A crop under
 * `MIN_CROP_SHARE` is not a crop, and the file is planned as shared instead.
 */
export function planForPanel(natural: Size, occurrence: PanelOccurrence): RasterPlan {
  const visible = visibleSourceRect(occurrence.frame, occurrence.focus, natural)
  if (!visible) return identityPlan(natural)
  const hidden = 1 - (visible.width * visible.height) / (natural.width * natural.height)
  if (hidden < MIN_CROP_SHARE) return planShared(natural, [occurrence])

  const { frame } = occurrence
  // What the frame can use of the crop, at the density every picture is kept
  // at — a smaller size than the crop holds, or the crop as it is.
  const needed = scaledDown(
    { width: visible.width, height: visible.height },
    (frame.width * OPTIMIZATION_PIXEL_DENSITY) / visible.width,
  )
  const downscale = isWorthDownscaling(visible, needed)
  const width = Math.max(1, downscale ? needed.width : Math.round(visible.width))
  return {
    source: visible,
    // The height follows from the width through the frame's own proportions,
    // so the file's shape is the frame's to the nearest pixel on one axis only.
    target: { width, height: Math.max(1, Math.round((width * frame.height) / frame.width)) },
    crop: true,
    downscale,
  }
}

/** Which files an optimisation is about. */
export type OptimizationScope =
  /** Every file in the presentation. */
  | { kind: 'all' }
  /** One file, everywhere it is shown. */
  | { kind: 'asset'; assetId: string }
  /** The file behind one picture panel, for that panel. */
  | { kind: 'panel'; slideId: string; nodeId: string }

/**
 * Everything the optimiser decides about one file before touching its bytes.
 *
 *  - `shared` — the result replaces the file everywhere it is shown. The plan
 *    is sized by the largest use and never crops.
 *  - `fork` — the result is a new file for the one panel named by `only`; every
 *    other use keeps the original. This is what a crop of a shared file is,
 *    because the pixels hidden in this frame may be shown in another.
 *
 * `raster` is `null` for a vector file: an SVG is kept as SVG, exactly as it is.
 * Whether a raster file is animated — and so must not be redrawn frame by
 * frame — is a fact about its bytes, which `imageMetadata.ts` reads; this plan
 * has not seen them.
 */
export interface AssetPlan {
  ref: AssetRef
  occurrences: AssetOccurrence[]
  mode: 'shared' | 'fork'
  only: { slideId: string; nodeId: string } | null
  raster: RasterPlan | null
}

/**
 * The plans an optimisation of `scope` consists of. Nothing here reads or
 * writes a file: this is the document's account of what each file would need.
 *
 * A file shown nowhere is left out: there is nothing to size it by, and the
 * thing to do with it is delete it, which is another command's job.
 */
export function planOptimization(presentation: Presentation, scope: OptimizationScope): AssetPlan[] {
  const occurrences = assetOccurrences(presentation)
  const refs = new Map(presentation.assets.map((asset) => [asset.id, asset]))

  if (scope.kind === 'panel') {
    const slide = findContentSlide(presentation, scope.slideId)
    const content = slide ? (findLeaf(slide.root, scope.nodeId)?.content ?? null) : null
    const assetId = content ? imagePanelOf(content)?.assetId : null
    const ref = assetId ? refs.get(assetId) : undefined
    const list = assetId ? (occurrences.get(assetId) ?? []) : []
    const own = list.find(
      (occurrence): occurrence is PanelOccurrence =>
        occurrence.kind === 'panel' &&
        occurrence.slideId === scope.slideId &&
        occurrence.nodeId === scope.nodeId,
    )
    return ref && own ? [planPanelAsset(ref, list, own)] : []
  }

  const plans: AssetPlan[] = []
  for (const ref of presentation.assets) {
    if (scope.kind === 'asset' && ref.id !== scope.assetId) continue
    const list = occurrences.get(ref.id) ?? []
    if (list.length === 0) continue
    const single = list.length === 1 && list[0].kind === 'panel' ? list[0] : null
    plans.push(single ? planPanelAsset(ref, list, single) : sharedPlan(ref, list))
  }
  return plans
}

function sharedPlan(ref: AssetRef, occurrences: AssetOccurrence[]): AssetPlan {
  return {
    ref,
    occurrences,
    mode: 'shared',
    only: null,
    raster: ref.isVector ? null : planShared(ref, occurrences),
  }
}

/**
 * A file behind one panel: cropped to that panel when it is the only use, and
 * forked for it when the file is shown elsewhere too — unless the panel hides
 * nothing, in which case there is nothing that would set it apart from the
 * other uses and the file is planned as shared.
 */
function planPanelAsset(
  ref: AssetRef,
  occurrences: AssetOccurrence[],
  panel: PanelOccurrence,
): AssetPlan {
  if (ref.isVector) return sharedPlan(ref, occurrences)
  const own = planForPanel(ref, panel)
  if (occurrences.length === 1) {
    return { ref, occurrences, mode: 'shared', only: null, raster: own }
  }
  if (!own.crop) return sharedPlan(ref, occurrences)
  return {
    ref,
    occurrences,
    mode: 'fork',
    only: { slideId: panel.slideId, nodeId: panel.nodeId },
    raster: own,
  }
}

/* ------------------------------------------------------------------ *
 * What the pixels say
 * ------------------------------------------------------------------ */

/**
 * A sample of the decoded picture, reduced to the two numbers the format
 * decision turns on. Read by the pipeline off the pixels it is about to encode;
 * judged here, so the thresholds are one set of numbers with one owner.
 */
export interface PixelSample {
  /** Share of sampled pixels identical to the pixel beside them. */
  flatFraction: number
  /** Distinct colours in the sample, as a share of the sample size. */
  distinctFraction: number
}

export function isPhotographic(sample: PixelSample): boolean {
  return (
    sample.flatFraction < PHOTO_MAX_FLAT_FRACTION &&
    sample.distinctFraction > PHOTO_MIN_DISTINCT_FRACTION
  )
}

/** One way to write the pixels out. */
export interface EncodingChoice {
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png'
  /** `undefined` means lossless. */
  quality?: number
}

/**
 * What the picture is, as far as the container decision is concerned.
 *
 * `lossySource` is whether the file arrived through a lossy codec: a JPEG, a
 * lossy WebP, an AVIF. Its artefacts are already in the pixels, so storing
 * them losslessly buys nothing, and a lossy container is the honest one.
 * `photographic` is `isPhotographic` of the decoded pixels.
 */
export interface PictureTraits {
  hasAlpha: boolean
  photographic: boolean
  lossySource: boolean
}

/**
 * The containers worth trying, in no particular order; the smallest valid
 * result wins. Several rather than one because the encoders disagree from
 * picture to picture about which lossless container is tighter, and trying both
 * is cheaper than being wrong.
 *
 *  - Transparency is kept, always: a picture with a transparent pixel never
 *    goes into a container without an alpha channel.
 *  - A lossy container only for a photograph, or for pixels that already came
 *    through one. Text, screenshots and diagrams stay lossless whatever they
 *    were stored as, because lossy compression draws rings around every edge.
 *  - WebP only where the browser can write it. Where it cannot, JPEG carries
 *    the photographs and PNG everything else — both were already formats every
 *    part of Slaids reads, stores, shares and renders.
 */
export function encodingChoices(traits: PictureTraits, webpAvailable: boolean): EncodingChoice[] {
  const lossy = traits.lossySource || traits.photographic
  if (lossy) {
    if (webpAvailable) return [{ mimeType: 'image/webp', quality: WEBP_QUALITY }]
    // JPEG has no alpha channel, so a see-through photograph stays lossless.
    return traits.hasAlpha ? [{ mimeType: 'image/png' }] : [{ mimeType: 'image/jpeg', quality: JPEG_QUALITY }]
  }
  return webpAvailable
    ? [{ mimeType: 'image/png' }, { mimeType: 'image/webp' }]
    : [{ mimeType: 'image/png' }]
}

/* ------------------------------------------------------------------ *
 * Is the result worth keeping?
 * ------------------------------------------------------------------ */

/**
 * Whether a result replaces the file it was made from.
 *
 * A result that changed pixels — cropped, downscaled — is kept when it is
 * smaller at all: the pixels are what the user asked to be rid of. A result
 * that only re-encoded the same pixels has to save `MIN_RECODE_SAVING_RATIO`
 * of the bytes; anything less is a rewrite for its own sake. A result that is
 * not smaller is never kept, whatever it did.
 */
export function isWorthKeeping(
  originalBytes: number,
  resultBytes: number,
  pixelsChanged: boolean,
): boolean {
  if (resultBytes >= originalBytes) return false
  if (pixelsChanged) return true
  return resultBytes <= originalBytes * (1 - MIN_RECODE_SAVING_RATIO)
}

/**
 * A file name that says what the file now is.
 *
 * The name is the author's and is kept; only an extension that has become a
 * lie — `.jpg` on a file that is now WebP — is replaced. A name with no
 * extension gets none.
 */
export function renameForMimeType(name: string, mimeType: string): string {
  const extensions = EXTENSIONS[mimeType]
  if (!extensions) return name
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name)
  if (!match) return name
  if (extensions.includes(match[1].toLowerCase())) return name
  return `${name.slice(0, match.index)}.${extensions[0]}`
}

/** The extensions each container is written with; the first is the one given. */
const EXTENSIONS: Record<string, readonly string[]> = {
  'image/webp': ['webp'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
}
