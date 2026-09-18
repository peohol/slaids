/**
 * Commands that edit the content inside a leaf zone.
 *
 * React components never reach into these objects directly; they call these
 * functions, which validate and return a fresh presentation.
 */

import {
  bodyOf,
  CENTRED_FOCUS,
  captionPositionsFor,
  contentDocs,
  createCaption,
  createCardBody,
  createContainer,
  createImage,
  createTitledCard,
  createNegativeSpace,
  createTitledImageCard,
  createUntitledCard,
  hasCardTitle,
  hasImagePanel,
  imagePanelOf,
  withBody,
  withBodyAxis,
  withImagePanel,
  withSubfieldCount,
  withSubfieldDoc,
} from '../content'
import { areWeightsValid, resolveOptions } from '../geometry'
import { zoneKindRefusal } from '../contentSize'
import { findLeaf, findNode, replaceNode } from '../layout'
import { isPlaceholderCaption } from '../imagePlan'
import {
  CITATION_NODE,
  collectDocAssetIds,
  docToPlainText,
  emptyDoc,
  imageNode,
  isDocEmpty,
  trimTrailingBlankLines,
} from '../richdoc'
import { contentSlide, geometryFor, rectForNode } from './internal'
import { touch, withSlide } from '../presentation'
import { err, ok, type Refusal, type Result } from '../result'
import { normalizeHex } from '../color'
import { hasAsset } from './assets'
import { guardFit } from './fitGuard'
import type { StructuralOptions } from './types'
import type {
  Axis,
  CaptionPosition,
  CardBody,
  ImageCaption,
  ImagePanel,
  Presentation,
  RichDoc,
  RichNode,
  VerticalAlign,
  ZoneContent,
  ZoneContentKind,
} from '../types'

type ContentUpdater = (content: ZoneContent) => Result<ZoneContent>

/** Everything a content command needs to address one zone. */
export interface ZoneContentTarget extends StructuralOptions {
  slideId: string
  nodeId: string
}

/**
 * Shared plumbing: find the leaf, run the updater, write the result back — and
 * refuse to commit a result that hides content the zone was showing.
 *
 * The fit gate lives here rather than in each command so that no content
 * command can be added later that quietly skips it. Whether it runs at all is
 * still the caller's choice (see `StructuralOptions`): the editor deliberately
 * omits the checkers while typing, because rolling a keystroke back has to
 * happen against the live DOM and must never interrupt an IME composition —
 * `RichTextEditor` owns that. Every non-typing caller, and any headless caller,
 * passes the checkers and gets validated here.
 */
export function updateZoneContent(
  presentation: Presentation,
  target: ZoneContentTarget,
  updater: ContentUpdater,
  fitMessage = 'Innholdet får ikke plass i sonen etter endringen.',
): Result<Presentation> {
  const found = contentSlide(presentation, target.slideId)
  if (!found.ok) return found
  const slide = found.value
  const leaf = findLeaf(slide.root, target.nodeId)
  if (!leaf) {
    return findNode(slide.root, target.nodeId)
      ? err('NODE_NOT_LEAF', 'Delte soner har ikke innhold direkte.')
      : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
  }
  if (!leaf.content) return err('TARGET_EMPTY', 'Sonen har ikke innhold.')

  const updated = updater(leaf.content)
  if (!updated.ok) return updated
  if (updated.value === leaf.content) return ok(presentation)

  const root = replaceNode(slide.root, leaf.id, { ...leaf, content: updated.value })
  const next = touch(withSlide(presentation, { ...slide, root }))
  return guardFit(presentation, next, target, fitMessage)
}

export function setSubfieldDoc(
  presentation: Presentation,
  input: { subfieldId: string; doc: RichDoc } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(presentation, input, (content) => {
    const body = bodyOf(content)
    if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen tekstfelt.')
    if (!body.subfields.some((field) => field.id === input.subfieldId)) {
      return err('SUBFIELD_NOT_FOUND', 'Fant ikke subfeltet.')
    }
    // The blank line a document ends with is never content — see
    // `trimTrailingBlankLines`. Trimmed here rather than in the editor so
    // every door into a field (typing, paste, an agent) leaves the same
    // document behind, and so the fit guard measures what will be drawn.
    const doc = trimTrailingBlankLines(input.doc)
    return ok(withBody(content, withSubfieldDoc(body, input.subfieldId, doc)))
  })
}

export function setCardTitle(
  presentation: Presentation,
  input: { doc: RichDoc } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      if (!hasCardTitle(content)) {
        return err('INVALID_CONTENT', 'Innholdet har ingen tittel.')
      }
      return ok({ ...content, title: input.doc })
    },
    'Korttittelen får ikke plass i kortet.',
  )
}

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

/** Everything a picture command needs, whichever kind holds the panel. */
function updateImagePanel(
  presentation: Presentation,
  target: ZoneContentTarget,
  updater: (panel: ImagePanel) => Result<ImagePanel>,
  fitMessage?: string,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    target,
    (content) => {
      const panel = imagePanelOf(content)
      if (!panel) return err('INVALID_CONTENT', 'Sonen viser ikke et bilde.')
      const next = updater(panel)
      if (!next.ok) return next
      return ok(next.value === panel ? content : withImagePanel(content, next.value))
    },
    fitMessage ?? 'Innholdet får ikke plass i sonen etter endringen.',
  )
}

/**
 * Point a picture panel at a file, or clear it. Never changes the crop.
 *
 * The one thing it does besides that is take back a placeholder caption. A zone
 * planned for a picture carries «Sett inn bilde 3 her» until the picture
 * arrives; the instruction has been carried out the moment it does, and leaving
 * it there would print it over the finished deck. A caption the author wrote is
 * left alone — see `isPlaceholderCaption`, which is the same test the plan
 * writes placeholders by, so nothing else can be mistaken for one.
 */
export function setImageAsset(
  presentation: Presentation,
  input: { assetId: string | null } & ZoneContentTarget,
): Result<Presentation> {
  if (input.assetId !== null && !hasAsset(presentation, input.assetId)) {
    return err('ASSET_NOT_FOUND', 'Presentasjonen har ingen fil med den id-en.')
  }
  const written = updateImagePanel(presentation, input, (panel) => {
    if (panel.assetId === input.assetId) return ok(panel)
    const placeholderGone =
      input.assetId !== null &&
      panel.caption !== null &&
      isPlaceholderCaption(docToPlainText(panel.caption.doc))
    return ok({
      ...panel,
      assetId: input.assetId,
      ...(placeholderGone ? { caption: null } : {}),
    })
  })
  return written
}

/**
 * Move the crop.
 *
 * The frame is fixed and the picture slides behind it, so nothing here can make
 * content overflow — but it goes through a command like everything else, so a
 * headless caller has the same vocabulary the drag handle does. Both
 * coordinates are clamped rather than refused: a drag that runs past the edge
 * of the picture means «all the way», not «invalid».
 */
export function setImageFocus(
  presentation: Presentation,
  input: { focus: { x: number; y: number } } & ZoneContentTarget,
): Result<Presentation> {
  const x = clampFocus(input.focus.x)
  const y = clampFocus(input.focus.y)
  if (x === null || y === null) return err('INVALID_ARGUMENT', 'Utsnittet må være tall.')
  return updateImagePanel(presentation, input, (panel) =>
    ok(panel.focus.x === x && panel.focus.y === y ? panel : { ...panel, focus: { x, y } }),
  )
}

function clampFocus(value: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

/**
 * Add, move, recolour or remove the caption over a picture.
 *
 * `caption: null` removes it, which is also what an empty caption becomes:
 * there is no such thing as an empty caption, only a box drawn over a
 * photograph for no reason.
 */
export function setImageCaption(
  presentation: Presentation,
  input: {
    position?: CaptionPosition
    doc?: RichDoc
    color?: string | null
    remove?: boolean
  } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      if (!hasImagePanel(content)) return err('INVALID_CONTENT', 'Sonen viser ikke et bilde.')
      const panel = content.image
      if (input.remove) {
        return ok(panel.caption ? withImagePanel(content, { ...panel, caption: null }) : content)
      }

      const allowed = captionPositionsFor(content.kind)
      const position = input.position ?? panel.caption?.position ?? allowed[allowed.length - 1]
      if (!allowed.includes(position)) {
        return err('INVALID_ARGUMENT', 'Bildeteksten kan ikke stå der på denne innholdstypen.', {
          allowed: [...allowed],
        })
      }

      let color = panel.caption?.color ?? null
      if (input.color !== undefined) {
        color = input.color === null ? null : normalizeHex(input.color)
        if (input.color !== null && color === null) {
          return err('INVALID_ARGUMENT', 'Ugyldig fargeverdi.')
        }
      }

      const caption = {
        ...(panel.caption ?? createCaption(position)),
        ...(input.doc ? { doc: input.doc } : {}),
        position,
        color,
      }
      return ok(withImagePanel(content, { ...panel, caption }))
    },
    'Bildeteksten får ikke plass i bildet.',
  )
}

/* ------------------------------------------------------------------ *
 * The subfield layout: how many, which way, in what proportions
 * ------------------------------------------------------------------ */

/** Everything about how a body divides the space it was given. */
export interface BodyLayoutInput extends ZoneContentTarget {
  /** `x` lays the subfields out as columns, `y` as rows. */
  axis?: Axis
  /** One per subfield the change ends with, all finite and greater than zero. */
  weights?: number[]
  /** 1–6. Subfields that disappear must be empty. */
  subfieldCount?: number
}

/**
 * Set how a card's subfields divide the space they share — count, direction and
 * proportions — in one gated step.
 *
 * One command rather than three, for the same reason `updateSplit` is one
 * command for a split's axis, weights and child count: all three are answered
 * against the same rectangle, and asking them one at a time gates each
 * intermediate state on its own. Two stacked rows can be too short for text
 * that two columns hold comfortably, so a caller that can only say "two
 * subfields" and *then* "side by side" never reaches the second state — the
 * first is refused on the way there. Here the fit gate runs once, against the
 * layout that was actually asked for.
 *
 * `setSubfieldCount`, `setBodyAxis` and `setBodyWeights` are this command with
 * one of the three filled in. The editor changes one thing at a time and keeps
 * calling them; a headless caller that knows the whole layout it wants says so
 * in one call.
 */
export function setBodyLayout(
  presentation: Presentation,
  input: BodyLayoutInput,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')

      const count = input.subfieldCount ?? body.subfields.length
      if (input.subfieldCount !== undefined && (!Number.isInteger(count) || count < 1 || count > 6)) {
        return err('INVALID_ARGUMENT', 'Antall subfelt må være mellom 1 og 6.')
      }
      // Against the count the call *ends* with, not the one it started with: a
      // call that both adds a subfield and re-proportions the body describes the
      // result, and matching against the old count would refuse exactly that.
      if (input.weights && input.weights.length !== count) {
        return err('INVALID_WEIGHTS', 'Antall forholdstall må matche antall subfelt.', {
          expected: count,
          received: input.weights.length,
        })
      }
      if (input.weights && !areWeightsValid(input.weights)) {
        return err('INVALID_WEIGHTS', 'Alle forholdstall må være tall større enn 0.')
      }
      const removed = body.subfields.slice(count)
      if (removed.some((field) => !isDocEmpty(field.doc))) {
        return err('INVALID_ARGUMENT', 'Subfeltene som fjernes har innhold. Tøm dem først.')
      }

      const resized = withSubfieldCount(body, count)
      const oriented = input.axis === undefined ? resized : withBodyAxis(resized, input.axis)
      const next =
        input.weights && !sameWeights(oriented.weights, input.weights)
          ? { ...oriented, weights: [...input.weights] }
          : oriented
      // Unchanged is answered with the very same object, so `updateZoneContent`
      // can tell a no-op apart from a change and leave `updatedAt` alone.
      return ok(next === body ? content : withBody(content, next))
    },
    bodyLayoutMessage(input),
  )
}

/** Which of the three was asked for, so a refusal says what was refused. */
function bodyLayoutMessage(input: BodyLayoutInput): string {
  const asked = [input.subfieldCount, input.axis, input.weights].filter(
    (value) => value !== undefined,
  ).length
  if (asked > 1) return 'Innholdet får ikke plass med denne subfeltinndelingen.'
  if (input.subfieldCount !== undefined) {
    return 'Innholdet får ikke plass når subfeltene deler sonen på nytt.'
  }
  if (input.weights !== undefined) return 'Innholdet får ikke plass med disse forholdstallene.'
  return 'Innholdet får ikke plass med denne orienteringen.'
}

function sameWeights(current: readonly number[], next: readonly number[]): boolean {
  return current.length === next.length && current.every((weight, i) => weight === next[i])
}

export function setSubfieldCount(
  presentation: Presentation,
  input: { count: number } & ZoneContentTarget,
): Result<Presentation> {
  const { count, ...target } = input
  return setBodyLayout(presentation, { ...target, subfieldCount: count })
}

/**
 * Where content sits inside the height it is given.
 *
 * Purely presentational — moving text within a box it already fits in cannot
 * make it stop fitting — but it goes through a command like everything else so
 * a headless caller has the same vocabulary as the toolbar.
 *
 * Always a subfield: a picture has no flow to align, it fills the frame it was
 * given, and where it sits inside itself is the crop's business.
 */
export function setVerticalAlign(
  presentation: Presentation,
  input: { subfieldId: string; align: VerticalAlign } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const body = bodyOf(content)
      if (!body) return err('INVALID_CONTENT', 'Innholdet har ingen subfelt.')
      const index = body.subfields.findIndex((field) => field.id === input.subfieldId)
      if (index < 0) return err('SUBFIELD_NOT_FOUND', 'Fant ikke subfeltet.')
      const subfields = [...body.subfields]
      subfields[index] = { ...subfields[index], verticalAlign: input.align }
      return ok(withBody(content, { ...body, subfields }))
    },
    'Justeringen får ikke plass.',
  )
}

export function setBodyAxis(
  presentation: Presentation,
  input: { axis: Axis } & ZoneContentTarget,
): Result<Presentation> {
  return setBodyLayout(presentation, input)
}

export function setBodyWeights(
  presentation: Presentation,
  input: { weights: number[] } & ZoneContentTarget,
): Result<Presentation> {
  return setBodyLayout(presentation, input)
}

/**
 * Colour is the one content property that cannot change how much space
 * content needs.
 *
 * `color: null` only makes sense for a titled card's header: it clears the
 * card's own colour and goes back to reading the deck's heading pill colour,
 * the same "standard" choice a heading's colour picker offers. A card
 * without a title has nothing to inherit from, so `null` there is refused
 * rather than silently kept.
 */
export function setCardColor(
  presentation: Presentation,
  input: { color: string | null } & ZoneContentTarget,
): Result<Presentation> {
  const color = input.color === null ? null : normalizeHex(input.color)
  if (input.color !== null && !color) return err('INVALID_ARGUMENT', 'Ugyldig fargeverdi.')
  return updateZoneContent(presentation, input, (content) => {
    if (content.kind === 'untitled-card') {
      if (color === null) return err('INVALID_CONTENT', 'Kort uten tittel har ingen arvet farge.')
      return ok({ ...content, backgroundColor: color })
    }
    // The same header a titled card has, down to the inheritance — so both
    // titled kinds answer here rather than only the one that came first.
    if (hasCardTitle(content)) return ok({ ...content, headerColor: color })
    return err('INVALID_CONTENT', 'Denne innholdstypen har ingen fargeflate.')
  })
}

/**
 * Convert content from one kind to another **without losing anything**.
 *
 * Every kind is either text in subfields or a picture with a caption, and the
 * conversion is the same story in both directions: what the source shows as
 * one thing, the target shows as the other. A card title becomes a heading
 * when the target has no title of its own; a picture becomes an inline image
 * in the body; a caption becomes a paragraph; and going the other way, the
 * first inline image in the body becomes the picture and what text there was
 * becomes the caption.
 *
 * Text that will not fit in a caption is not silently dropped here — it is
 * carried across in full, and the fit gate in `updateZoneContent` refuses the
 * conversion with a message saying so. Refusing is the honest answer: a
 * paragraph is not a caption, and a conversion that quietly ate it would be
 * the one thing this function promises never to do.
 *
 * One kind stands outside that story: air has no payload at all.
 * `setContentKind` only reaches that branch once it has established there is
 * nothing to carry — see the refusal there and `contentConversionRefusal`.
 */
export function convertContentKind(content: ZoneContent, kind: ZoneContentKind): ZoneContent {
  if (content.kind === kind) return content

  if (kind === 'negative-space') return createNegativeSpace()

  const title = hasCardTitle(content) ? content.title : null
  const headerColor = hasCardTitle(content) ? content.headerColor : null
  const targetHasTitle = kind === 'titled-card' || kind === 'titled-image-card'

  if (kind === 'image' || kind === 'titled-image-card') {
    const panel = imagePanelFrom(content, targetHasTitle ? null : title)
    if (kind === 'image') return { ...createImage(), image: panel }
    return { ...createTitledImageCard(), headerColor, title: title ?? emptyDoc(), image: panel }
  }

  const body = bodyFrom(content, targetHasTitle ? null : title)
  if (kind === 'container') return createContainer(body)
  if (kind === 'untitled-card') {
    const card = createUntitledCard(
      content.kind === 'untitled-card' ? content.backgroundColor : undefined,
    )
    return { ...card, body }
  }
  return { ...createTitledCard(), body, title: title ?? emptyDoc(), headerColor }
}

/**
 * The body a conversion into a text kind ends up with.
 *
 * `carriedTitle` is the source's card title when the target has no title panel
 * to put it in; it becomes a heading at the top of the first field, which is
 * the same thing said in the vocabulary the target has.
 */
function bodyFrom(content: ZoneContent, carriedTitle: RichDoc | null): CardBody {
  const source = bodyOf(content)
  const panel = imagePanelOf(content)

  let docs: RichDoc[]
  let axis: Axis = 'y'
  let weights: number[] | null = null

  if (source) {
    docs = source.subfields.map((field) => field.doc)
    axis = source.axis
    weights = [...source.weights]
  } else {
    // A picture: the file becomes an inline image and the caption the text
    // under it, which is what a picture looks like written out as a field.
    const blocks: RichNode[] = []
    if (panel?.assetId) blocks.push(imageNode(panel.assetId))
    if (panel?.caption && !isDocEmpty(panel.caption.doc)) {
      blocks.push(...(panel.caption.doc.content ?? []))
    }
    docs = [{ type: 'doc', content: blocks }]
  }

  if (carriedTitle) {
    const heading = titleAsHeading(carriedTitle)
    if (heading) {
      docs = [{ type: 'doc', content: [heading, ...(docs[0]?.content ?? [])] }, ...docs.slice(1)]
    }
  }

  /*
   * A source with nothing to say becomes an empty field, not a field with no
   * blocks in it.
   *
   * `{ content: [] }` is not the empty document — `emptyDoc()` is, and it holds
   * one empty paragraph, because that is what a rich-text document with a place
   * to type in looks like. The two ways to get here with nothing: negative
   * space, which has no payload at all, and a picture panel with neither a file
   * nor a caption.
   */
  docs = docs.map((doc) => ((doc.content ?? []).length > 0 ? doc : emptyDoc()))

  const base = createCardBody(Math.max(1, docs.length), axis)
  return {
    axis,
    weights: weights && weights.length === base.subfields.length ? weights : base.weights,
    subfields: base.subfields.map((field, index) => ({
      ...field,
      doc: docs[index] ?? emptyDoc(),
      ...(source?.subfields[index]?.verticalAlign
        ? { verticalAlign: source.subfields[index].verticalAlign }
        : {}),
    })),
  }
}

/**
 * The picture panel a conversion into a picture kind ends up with.
 *
 * The file is the first inline image the source shows, so a card with a figure
 * in it becomes that figure. Everything the source said in words becomes the
 * caption — the card's own title included, when the target has no title panel
 * to keep it in. A caption is one line that wraps, so a body of several
 * paragraphs arrives as one, and if it is too long for the picture the fit gate
 * says so rather than this function trimming it.
 */
function imagePanelFrom(content: ZoneContent, carriedTitle: RichDoc | null): ImagePanel {
  const existing = imagePanelOf(content)
  // `spokenDocs` deliberately leaves the card title out: it is carried
  // separately, because whether it survives as a title or folds into the
  // caption is the target's decision, not this function's.
  const caption = captionFrom([carriedTitle, ...spokenDocs(content)], existing?.caption ?? null)
  if (existing) return caption === existing.caption ? existing : { ...existing, caption }
  return { assetId: firstInlineAssetId(content), focus: { ...CENTRED_FOCUS }, caption }
}

/** Everything the content says in words, apart from its own card title. */
function spokenDocs(content: ZoneContent): RichDoc[] {
  const body = bodyOf(content)
  if (body) return body.subfields.map((field) => field.doc)
  const caption = imagePanelOf(content)?.caption
  return caption ? [caption.doc] : []
}

/**
 * One caption from everything the source said.
 *
 * Built from **inline nodes**, not from plain text. A citation is not
 * characters: flattening it away would delete a reference's first occurrence
 * and renumber every label after it, on slides nobody touched — which is the
 * one thing a conversion must never do quietly. Marks do go, because a caption
 * is plain text and its schema has no bold in it, but every glyph survives.
 *
 * Nothing to say leaves the caption exactly as it was, so a conversion between
 * two picture kinds is not a rewrite of the caption that is already there.
 */
function captionFrom(
  docs: (RichDoc | null)[],
  existing: ImageCaption | null,
): ImageCaption | null {
  const inline = joinInline(docs.map((doc) => (doc ? captionInline(doc) : [])))
  if (inline.length === 0) return existing
  const doc: RichDoc = { type: 'doc', content: [{ type: 'paragraph', content: inline }] }
  return existing ? { ...existing, doc } : createCaption('bottom', doc)
}

/** A document as a caption may hold it: one run of text and citations. */
function captionInline(doc: RichDoc): RichNode[] {
  return joinInline((doc.content ?? []).map(captionLeaves))
}

function captionLeaves(node: RichNode): RichNode[] {
  if (node.type === CITATION_NODE) return [{ ...node }]
  if (node.type === 'text') return node.text ? [{ type: 'text', text: node.text }] : []
  return (node.content ?? []).flatMap(captionLeaves)
}

/** One run, with a space wherever two blocks meet so words do not run together. */
function joinInline(runs: RichNode[][]): RichNode[] {
  const out: RichNode[] = []
  for (const run of runs) {
    if (run.length === 0) continue
    if (out.length > 0) out.push({ type: 'text', text: ' ' })
    out.push(...run)
  }
  return out
}

/** The first figure the content shows in its text, if any. */
function firstInlineAssetId(content: ZoneContent): string | null {
  for (const doc of contentDocs(content)) {
    const [first] = collectDocAssetIds(doc)
    if (first) return first
  }
  return null
}

/** A card title becomes a heading so its text survives the conversion. */
function titleAsHeading(title: RichDoc): RichNode | null {
  const inline = (title.content ?? []).flatMap((node) => node.content ?? [])
  if (inline.length === 0) return null
  return { type: 'heading', attrs: { level: 1 }, content: inline }
}

/**
 * Converting between content kinds changes the chrome around the text: a titled
 * card spends `CARD_HEADER_HEIGHT + CARD_PADDING * 2` of the zone that a
 * container gives entirely to content. The gate in `updateZoneContent` is what
 * stops a conversion from pushing text out of sight.
 *
 * Two things are asked before that, and in this order, because they call for
 * different repairs:
 *
 *  - **Can this kind exist here at all?** A zone can be too small for a titled
 *    card however short its text is — the header and the padding are drawn
 *    whatever it says. That is `ZONE_TOO_SMALL`, and the fix is a bigger zone.
 *  - **Is there anything this conversion would throw away?** Only negative
 *    space can, and it loses everything: air has no payload by definition.
 *    Rather than silently deleting the work, the command refuses and names the
 *    gesture that keeps it — «Tøm sone» parks the content in the sandbox, and
 *    the emptied zone converts freely.
 */
export function setContentKind(
  presentation: Presentation,
  input: { kind: ZoneContentKind } & ZoneContentTarget,
): Result<Presentation> {
  return updateZoneContent(
    presentation,
    input,
    (content) => {
      const refusal = zoneKindRefusalFor(presentation, input, input.kind, content)
      if (refusal) return refusal
      // Asking for the kind that is already there is asking for the document as
      // it stands: nothing to convert, and `updateZoneContent` reads the
      // unchanged object as «done».
      if (content.kind === input.kind) return ok(content)
      return ok(convertContentKind(content, input.kind))
    },
    'Innholdet får ikke plass i denne innholdstypen.',
  )
}

/**
 * «Can this zone become that kind?», as a command's refusal.
 *
 * The question itself is `zoneKindRefusal` in `domain/contentSize.ts` — the one
 * the content picker greys its buttons by and the one `inspect_slide` lists
 * the available kinds by — so the three cannot answer differently. This only
 * resolves the zone's rectangle and dresses the answer as a typed refusal, with
 * the numbers in `details` for a caller that wants to act on them.
 */
function zoneKindRefusalFor(
  presentation: Presentation,
  target: ZoneContentTarget,
  kind: ZoneContentKind,
  content: ZoneContent,
): Refusal | null {
  const found = contentSlide(presentation, target.slideId)
  if (!found.ok) return found
  const geometry = geometryFor(presentation, target.geometry)
  const rect = rectForNode(found.value, target.nodeId, geometry)
  if (!rect) return err('NODE_NOT_FOUND', 'Fant ikke sonen.')

  const refusal = zoneKindRefusal(kind, rect, content, resolveOptions(geometry).metrics)
  if (!refusal) return null
  return err(refusal.code, refusal.message, {
    slideId: target.slideId,
    nodeId: target.nodeId,
    contentKind: kind,
    ...(refusal.rect ? { rect: refusal.rect } : {}),
    ...(refusal.minimum ? { minimum: refusal.minimum } : {}),
  })
}
