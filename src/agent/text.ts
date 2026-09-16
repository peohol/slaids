/**
 * The agent's text format.
 *
 * Slaids stores rich text as ProseMirror/Tiptap JSON. That is an editor's
 * internal representation, and `IMPLEMENTATION_PLAN.md` §44 is explicit that an
 * agent must never have to construct it: swapping the rich-text editor later
 * should not be a breaking change in the agent contract.
 *
 * So this module is the seam. It defines a small block format an agent writes —
 * paragraphs, one accent level, bullet and numbered lists, quotes, bold and
 * italic, and citations that carry reference ids rather than numbers — and it
 * translates in both directions: into `RichDoc` on the way in, and back out in
 * `inspect_slide`, so an agent can read what it wrote.
 *
 * The block an agent calls `accent` is stored as a ProseMirror heading, and the
 * two names are deliberately different. Inside a zone the block is a
 * subheading, a highlighted point, an internal division — never the heading of
 * the thing it sits in, which is the card's own title. An agent offered a
 * «heading» inside a text field uses it as one, and then the card it is in
 * needs no title and the deck loses its framing; see `ACCENT_RULE`. Renaming
 * the stored node would be a migration that changes nothing anybody reads, so
 * the rename is exactly where the misunderstanding was: in the contract.
 *
 * Deliberately **not** Markdown. A Markdown parser is a second, informal
 * grammar with its own edge cases (what is `*` here? is this a list?), and its
 * failures are silent — the wrong structure, not an error. Every block here is
 * named, every field is Zod-validated, and anything that does not match is a
 * typed rejection before a single command runs.
 *
 * A picture standing in the text is a block like the others: an `image` block
 * naming a file that is already in the presentation. Never bytes — the file
 * comes in through `upload_asset` or `create_svg_asset` and is referred to by
 * its `assetId` afterwards, which is the same thing the editor stores and the
 * same reference `delete_asset` counts as use. The proportions are not part of
 * the contract: they are read off the stored file, because a ratio a caller
 * states is a claim and the bitstream is a measurement.
 *
 * Two things the format cannot express, and how each is handled rather than
 * hidden:
 *
 *  - **Structure the editor can produce and this format cannot** — a table, a
 *    code block, a nested list. Reading returns an `unsupported` block that
 *    names the node and carries its plain text, so an agent can see that
 *    something is there and that rewriting the zone would replace it. It is not
 *    part of what an agent may *send*: inventing a write path for a shape the
 *    format does not model is how silent corruption starts.
 *  - **A citation's number.** A citation stores reference ids; the number comes
 *    from first-occurrence order across the whole deck and is derived at render
 *    time. An agent writes ids, and reads ids back.
 */

import { z } from 'zod'
import { normalizeHex } from '../domain/color'
import {
  INLINE_IMAGE_DEFAULT_WIDTH_PERCENT,
  INLINE_IMAGE_MAX_WIDTH_PERCENT,
  INLINE_IMAGE_MIN_WIDTH_PERCENT,
} from '../domain/constants'
import {
  CITATION_NODE,
  IMAGE_NODE,
  citationIdsOf,
  docToPlainText,
  emptyDoc,
  imageNode,
  inlineImageOf,
  mergeAdjacentCitations,
} from '../domain/richdoc'
import type { AssetRef, RichDoc, RichMark, RichNode, TitleDoc } from '../domain/types'

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

export const alignSchema = z
  .enum(['left', 'center', 'right'])
  .describe('Justering av blokken. Utelatt betyr venstrejustert, som er standard.')

export type TextAlign = z.output<typeof alignSchema>

/**
 * The emphasis a Slaids document can store, and nothing else.
 *
 * Styling is never stored — a heading is a heading, not a font size — so there
 * is no colour, size or font here. `href` is protocol-restricted in the schema
 * itself: a document written through this path can never carry a `javascript:`
 * link, because such a link is not a value the schema accepts.
 */
const textSpanSchema = z.strictObject({
  text: z.string().min(1).describe('Selve teksten. Bruk spans: [] for et tomt avsnitt.'),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
  code: z.boolean().optional(),
  href: z
    .string()
    .regex(/^(https?:\/\/|mailto:)/i, 'Bare http, https og mailto er tillatt.')
    .optional()
    .describe('Gjør teksten til en lenke.'),
})

const citationSpanSchema = z.strictObject({
  citation: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Reference-ID-er fra add_reference. Nummeret vises ikke her: det utledes av rekkefølgen citationene står i gjennom hele presentasjonen.',
    ),
})

const breakSpanSchema = z.strictObject({
  lineBreak: z.literal(true).describe('Et linjeskift inne i samme avsnitt.'),
})

const spanSchema = z.union([textSpanSchema, citationSpanSchema, breakSpanSchema])

const spansSchema = z.array(spanSchema).default([])

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * A picture standing between the paragraphs of a field.
 *
 * It names a file the presentation already holds — `upload_asset` and
 * `create_svg_asset` are the two doors a file comes in through, and both answer
 * with the `assetId` that goes here. Bytes never appear in the text format, and
 * there is no second way to refer to a file: this is the very same reference
 * the editor writes, so `delete_asset` counts it as use, a duplication remaps
 * it onto the copy's own file, and `validate_presentation` sees it.
 *
 * Only the two decisions that are actually the caller's are here. How wide the
 * picture is drawn is one of them, as a share of the column it sits in, so a
 * picture can never be wider than the field around it. Where it sits in that
 * column is the other, and it is `align` for the same reason a paragraph's is:
 * it belongs to the line, not to the file.
 *
 * The proportions are deliberately *not* here. They come from the stored file,
 * which was measured from the bitstream when it was saved — a ratio a caller
 * states is a claim, and a claimed ratio is what would make the fit measurement
 * and the drawn slide disagree.
 */
const imageBlockSchema = z.strictObject({
  type: z.literal('image'),
  assetId: z
    .string()
    .min(1)
    .describe('Id-en til en fil som allerede ligger i presentasjonen, fra upload_asset eller create_svg_asset.'),
  alt: z
    .string()
    .max(500)
    .optional()
    .describe('Alternativ tekst. Beskriver bildet, og vises ikke på sliden.'),
  widthPercent: z
    .number()
    .int()
    .min(INLINE_IMAGE_MIN_WIDTH_PERCENT)
    .max(INLINE_IMAGE_MAX_WIDTH_PERCENT)
    .default(INLINE_IMAGE_DEFAULT_WIDTH_PERCENT)
    .describe(
      `Bredden som andel av kolonnen bildet står i. ${INLINE_IMAGE_MAX_WIDTH_PERCENT} er hele feltet; standarden er ${INLINE_IMAGE_DEFAULT_WIDTH_PERCENT}, som lar det stå tekst ved siden av. Høyden følger av bildets egne proporsjoner, men bildet tegnes aldri høyere enn feltet: en høy fil fyller feltet i stedet for å flyte over.`,
    ),
  align: alignSchema.optional(),
})

const textBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paragraph'), spans: spansSchema, align: alignSchema.optional() }),
  z.strictObject({
    type: z
      .literal('accent')
      .describe(
        'En aksent: underoverskrift, fremhevet poeng eller intern oppdeling i sonen. Ikke kortets hovedoverskrift – den er korttittelen på et `titled-card`.',
      ),
    spans: spansSchema,
    align: alignSchema.optional(),
    color: z
      .string()
      .regex(HEX_COLOR)
      .optional()
      .describe('Fargen på aksentpillen, som #rrggbb. Utelatt gir standardfargen.'),
  }),
  z.strictObject({ type: z.literal('quote'), spans: spansSchema }),
  z.strictObject({
    type: z.literal('bullets'),
    items: z.array(z.array(spanSchema)).min(1).describe('Ett punkt per element.'),
  }),
  z.strictObject({
    type: z.literal('numbered'),
    items: z.array(z.array(spanSchema)).min(1).describe('Ett punkt per element.'),
  }),
  imageBlockSchema,
])

export const textBlocksSchema = z
  .array(textBlockSchema)
  .describe(
    'Teksten som blokker. En tom liste tømmer feltet. Slaids’ interne rich text-format er ikke en del av kontrakten.',
  )

/**
 * A slide title is one line: text and citations, no emphasis, no breaks, no
 * blocks. That restriction is what makes the title zone geometrically
 * deterministic, so it is part of the contract rather than something the
 * conversion quietly drops.
 */
const titleSpanSchema = z.union([
  z.strictObject({ text: z.string().min(1) }),
  citationSpanSchema,
])

export const titleSpansSchema = z
  .array(titleSpanSchema)
  .describe('Overskriften som tekst og citations. En tom liste tømmer overskriften.')

export type TextSpan = z.output<typeof spanSchema>
export type TitleSpan = z.output<typeof titleSpanSchema>
export type TextBlock = z.output<typeof textBlockSchema>

/** What reading returns for a node this format does not model. */
export interface UnsupportedBlock {
  type: 'unsupported'
  /** The stored node type, e.g. `table` or `codeBlock`. */
  node: string
  /** Its text, so nothing an agent can act on is invisible. */
  text: string
}

/** What `inspect_slide` reports: everything an agent may write, plus the rest. */
export type InspectedBlock = TextBlock | UnsupportedBlock

/* ------------------------------------------------------------------ *
 * In: agent blocks → RichDoc
 * ------------------------------------------------------------------ */

const MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const

function spanToNode(span: TextSpan): RichNode {
  if ('citation' in span) {
    return { type: CITATION_NODE, attrs: { referenceIds: [...span.citation] } }
  }
  if ('lineBreak' in span) return { type: 'hardBreak' }

  const marks: RichMark[] = MARKS.filter((mark) => span[mark]).map((mark) => ({ type: mark }))
  if (span.href) marks.push({ type: 'link', attrs: { href: span.href } })
  return { type: 'text', text: span.text, ...(marks.length > 0 ? { marks } : {}) }
}

function paragraph(spans: readonly TextSpan[], align?: TextAlign): RichNode {
  const content = spans.map(spanToNode)
  return {
    type: 'paragraph',
    ...(align ? { attrs: { textAlign: align } } : {}),
    ...(content.length > 0 ? { content } : {}),
  }
}

function listItem(spans: readonly TextSpan[]): RichNode {
  return { type: 'listItem', content: [paragraph(spans)] }
}

function blockToNode(block: TextBlock, assets: AssetLookup): RichNode {
  switch (block.type) {
    case 'paragraph':
      return paragraph(block.spans, block.align)
    case 'accent': {
      const color = block.color ? normalizeHex(block.color) : null
      return {
        type: 'heading',
        attrs: {
          level: 1,
          ...(block.align ? { textAlign: block.align } : {}),
          ...(color ? { color } : {}),
        },
        ...(block.spans.length > 0 ? { content: block.spans.map(spanToNode) } : {}),
      }
    }
    case 'quote':
      return { type: 'blockquote', content: [paragraph(block.spans)] }
    case 'bullets':
      return { type: 'bulletList', content: block.items.map(listItem) }
    case 'numbered':
      return { type: 'orderedList', content: block.items.map(listItem) }
    case 'image':
      // An empty `alt` and no `alt` are the same picture — `<img alt="">` is
      // what both draw — so they build the same node and read back the same
      // way, rather than one of them surviving a round trip and the other not.
      return imageNode(block.assetId, {
        ...(block.alt ? { alt: block.alt } : {}),
        widthPercent: block.widthPercent,
        aspect: assets.get(block.assetId) ?? null,
        ...(block.align ? { align: block.align } : {}),
      })
  }
}

/**
 * The proportions of each file the caller may point at.
 *
 * A picture is drawn `width / aspect` tall, so the ratio decides how much room
 * it takes — which makes it part of what the fit gate measures, not decoration.
 * It is derived from the presentation's own `AssetRef`, whose width and height
 * were read out of the bitstream when the file was stored, so the caller cannot
 * state proportions the file does not have.
 *
 * A file with no usable size (an SVG that declared none) simply has no entry,
 * and the picture falls back to the ratio the stylesheet draws for one.
 */
type AssetLookup = ReadonlyMap<string, number>

function assetAspects(assets: readonly AssetRef[]): AssetLookup {
  const ratios = new Map<string, number>()
  for (const asset of assets) {
    if (asset.width > 0 && asset.height > 0) ratios.set(asset.id, asset.width / asset.height)
  }
  return ratios
}

/**
 * The document these blocks describe.
 *
 * Adjacent citations are merged exactly as the editor merges them, so `[1][2]`
 * written by an agent renders as the single `1, 2` a person would have got by
 * inserting them one after the other — and so the fit measured before the write
 * is the fit of what will actually be drawn.
 */
export function blocksToDoc(
  blocks: readonly TextBlock[],
  assets: readonly AssetRef[] = [],
): RichDoc {
  if (blocks.length === 0) return emptyDoc()
  const ratios = assetAspects(assets)
  return mergeAdjacentCitations({
    type: 'doc',
    content: blocks.map((block) => blockToNode(block, ratios)),
  })
}

/**
 * A title as the one paragraph it is.
 *
 * `align` is separate from the spans for the same reason it is on a paragraph
 * block rather than on a span: it belongs to the line, not to a run of text.
 * A caller that leaves it out gets no alignment attribute, so the callers that
 * only mean to change the *text* pass the alignment the title already had —
 * otherwise rewriting a centered title would quietly left-align it.
 */
export function titleSpansToDoc(spans: readonly TitleSpan[], align?: TextAlign): TitleDoc {
  if (spans.length === 0 && !align) return emptyDoc()
  return mergeAdjacentCitations({ type: 'doc', content: [paragraph(spans, align)] })
}

/** Every reference id these blocks cite, so a caller can check them first. */
export function citedIdsInSpans(spans: readonly (TextSpan | TitleSpan)[]): string[] {
  return spans.flatMap((span) => ('citation' in span ? span.citation : []))
}

export function citedIdsInBlocks(blocks: readonly TextBlock[]): string[] {
  return blocks.flatMap((block) => {
    if (block.type === 'image') return []
    return 'items' in block ? block.items.flatMap(citedIdsInSpans) : citedIdsInSpans(block.spans)
  })
}

/**
 * Every file these blocks show, so a caller can check them first.
 *
 * The mirror of `citedIdsInBlocks`, and used the same way: a picture pointing
 * at a file the presentation does not hold is refused before anything is
 * written, rather than stored as a zone that renders a hole.
 */
export function imageAssetIdsInBlocks(blocks: readonly TextBlock[]): string[] {
  return blocks.flatMap((block) => (block.type === 'image' ? [block.assetId] : []))
}

/* ------------------------------------------------------------------ *
 * Out: RichDoc → agent blocks
 * ------------------------------------------------------------------ */

function alignOf(node: RichNode): TextAlign | undefined {
  const value = node.attrs?.textAlign
  return value === 'left' || value === 'center' || value === 'right' ? value : undefined
}

function nodeToSpan(node: RichNode): TextSpan | null {
  if (node.type === CITATION_NODE) {
    const ids = citationIdsOf(node)
    return ids.length > 0 ? { citation: ids } : null
  }
  if (node.type === 'hardBreak') return { lineBreak: true }
  if (node.type !== 'text' || !node.text) return null

  const span: TextSpan = { text: node.text }
  for (const mark of node.marks ?? []) {
    if ((MARKS as readonly string[]).includes(mark.type)) {
      ;(span as Record<string, unknown>)[mark.type] = true
    } else if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
      // Only a link this format could also have written. An href with any other
      // protocol is dropped rather than handed back as something an agent could
      // send again — the schema would refuse it anyway.
      if (/^(https?:\/\/|mailto:)/i.test(mark.attrs.href)) span.href = mark.attrs.href
    }
  }
  return span
}

function spansOf(node: RichNode): TextSpan[] {
  const spans: TextSpan[] = []
  for (const child of node.content ?? []) {
    const span = nodeToSpan(child)
    if (span) spans.push(span)
  }
  return spans
}

/** Whether every inline child is something this format can express. */
function isPlainInline(node: RichNode): boolean {
  return (node.content ?? []).every(
    (child) =>
      child.type === 'text' || child.type === CITATION_NODE || child.type === 'hardBreak',
  )
}

function unsupported(node: RichNode): UnsupportedBlock {
  return {
    type: 'unsupported',
    node: node.type,
    text: docToPlainText({ type: 'doc', content: [node] }),
  }
}

/** A list item is expressible when it holds exactly one plain paragraph. */
function listItemSpans(item: RichNode): TextSpan[] | null {
  if (item.type !== 'listItem') return null
  const children = item.content ?? []
  if (children.length !== 1) return null
  const [only] = children
  if (only.type !== 'paragraph' || !isPlainInline(only)) return null
  return spansOf(only)
}

function listBlock(node: RichNode, type: 'bullets' | 'numbered'): InspectedBlock {
  const items: TextSpan[][] = []
  for (const item of node.content ?? []) {
    const spans = listItemSpans(item)
    // A nested list, or an item with several paragraphs: reporting the first
    // paragraph and dropping the rest would be a quieter lie than saying the
    // format cannot describe this one.
    if (!spans) return unsupported(node)
    items.push(spans)
  }
  return items.length > 0 ? { type, items } : unsupported(node)
}

function blockOf(node: RichNode): InspectedBlock[] {
  switch (node.type) {
    case 'paragraph': {
      if (!isPlainInline(node)) return [unsupported(node)]
      const align = alignOf(node)
      return [{ type: 'paragraph', spans: spansOf(node), ...(align ? { align } : {}) }]
    }
    case 'heading': {
      if (!isPlainInline(node)) return [unsupported(node)]
      const align = alignOf(node)
      const color = typeof node.attrs?.color === 'string' ? normalizeHex(node.attrs.color) : null
      return [
        {
          type: 'accent',
          spans: spansOf(node),
          ...(align ? { align } : {}),
          ...(color ? { color } : {}),
        },
      ]
    }
    case 'blockquote': {
      const children = node.content ?? []
      // A quote holding several paragraphs comes back as several quote blocks:
      // the text survives, and writing them back gives the same reading.
      if (children.length === 0 || !children.every((child) => child.type === 'paragraph' && isPlainInline(child))) {
        return [unsupported(node)]
      }
      return children.map((child) => ({ type: 'quote' as const, spans: spansOf(child) }))
    }
    case 'bulletList':
      return [listBlock(node, 'bullets')]
    case 'orderedList':
      return [listBlock(node, 'numbered')]
    case IMAGE_NODE: {
      // Read through the domain's own reading of the node, so what comes back
      // is the picture the renderer will draw. A node with no file behind it
      // cannot be drawn and cannot be written back either, so it stays
      // `unsupported`: the honest answer is "something is there that you cannot
      // send again", not an `assetId` that is not one.
      const image = inlineImageOf(node)
      if (!image) return [unsupported(node)]
      return [
        {
          type: 'image',
          assetId: image.assetId,
          ...(image.alt ? { alt: image.alt } : {}),
          widthPercent: image.widthPercent,
          ...(image.align ? { align: image.align } : {}),
        },
      ]
    }
    default:
      return [unsupported(node)]
  }
}

/** The blocks a document is made of, as an agent would have written them. */
export function docToBlocks(doc: RichDoc | null | undefined): InspectedBlock[] {
  return (doc?.content ?? []).flatMap(blockOf)
}

/**
 * A title as the one line it is, with the same span vocabulary.
 *
 * Both places Slaids stores a title — a slide's own and a card's — are edited
 * with the restricted schema (text and citations, no emphasis, no breaks), so
 * what comes back here is exactly what `titleSpansSchema` accepts. The return
 * type is the wider span union anyway: a title that arrived through a `.slaids`
 * import could carry a mark, and showing it is better than hiding it — the
 * schema then refuses to write it back, which is the honest answer.
 */
export function docToTitleSpans(doc: TitleDoc | null | undefined): TextSpan[] {
  return (doc?.content ?? []).flatMap((node) =>
    node.type === 'paragraph' ? spansOf(node) : [],
  )
}

/**
 * The alignment a stored title carries, if any.
 *
 * Reported by `inspect_slide` and reused by the operations that only rewrite
 * the text, so an alignment a person chose in the editor survives an agent
 * touching the words.
 */
export function docToTitleAlign(doc: TitleDoc | null | undefined): TextAlign | undefined {
  const paragraphNode = (doc?.content ?? []).find((node) => node.type === 'paragraph')
  return paragraphNode ? alignOf(paragraphNode) : undefined
}
