/**
 * Schema migrations.
 *
 * Every persisted presentation carries a `schemaVersion`. Loading runs the
 * chain of migrations from the stored version up to `CURRENT_SCHEMA_VERSION`
 * before validation, so early test presentations never become unreadable.
 */

import {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PILL_COLOR,
  DEFAULT_TITLED_CARD_STYLE,
  TITLED_CARD_STYLES,
  type TitledCardStyle,
} from './constants'
import { WHITE, normalizeHex } from './color'
import { err, ok, type Result } from './result'
import { CURRENT_SCHEMA_VERSION, validatePresentation } from './schema'
import { emptyDoc, mergeAdjacentCitations, titleDoc, trimTrailingBlankLines } from './richdoc'
import { newSlideId, newSubfieldId } from './ids'
import { quantizeStoredRatios } from './ratios'
import { normalizeIdeas } from './ideas'
import type { Presentation, RichDoc } from './types'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_SPACING,
  FONT_SCALE_RANGE,
  NEUTRAL_SCALE,
  SPACING_RANGE,
} from './metrics'

type Raw = Record<string, unknown>

const DEFAULT_CARD_COLOR = WHITE

export type MigrationFn = (data: Raw) => Raw

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Pre-versioned documents (anything without a numeric `schemaVersion`) are
 * treated as version 0 and normalised up to version 1 by filling in the
 * collections and theme fields that version 1 requires.
 */
const migrate0to1: MigrationFn = (data) => {
  const theme = (data.theme ?? {}) as Raw
  return {
    ...data,
    schemaVersion: 1,
    title: asString(data.title, 'Uten tittel'),
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    theme: {
      backgroundColor: asString(theme.backgroundColor, DEFAULT_BACKGROUND_COLOR),
      headingFontFamily: asString(theme.headingFontFamily, DEFAULT_HEADING_FONT),
      bodyFontFamily: asString(theme.bodyFontFamily, DEFAULT_BODY_FONT),
    },
    slides: asArray(data.slides),
    references: asArray(data.references),
    sandbox: asArray(data.sandbox),
    ideas: asArray(data.ideas),
    ideaCategories: asArray(data.ideaCategories),
    assets: asArray(data.assets),
    createdAt: asString(data.createdAt, new Date().toISOString()),
    updatedAt: asString(data.updatedAt, new Date().toISOString()),
  }
}

/**
 * Citations that sit next to each other become one citation.
 *
 * Until now each inserted reference made its own node, so a passage citing four
 * sources drew four separate pills where the format calls for one — `1–4`.
 * Merging is done to the stored document rather than at render time, so the
 * editor and the slide agree about what is there.
 */
const migrate1to2: MigrationFn = (data) => ({
  ...(mergeCitationsInRaw(data) as Raw),
  schemaVersion: 2,
})

/**
 * Apply `mergeAdjacentCitations` wherever a document lives in the raw data.
 *
 * Migrations run before validation, so the shape cannot be trusted; this walks
 * the whole tree and merges any `content` array that holds citations, which
 * covers slide titles, card titles, subfields, containers and the sandbox
 * without needing to know where any of them are.
 */
function mergeCitationsInRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mergeCitationsInRaw)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  if (record.type === 'doc' && Array.isArray(record.content)) {
    const merged = mergeAdjacentCitations(record as unknown as RichDoc)
    return { ...(merged as unknown as Raw) }
  }
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = mergeCitationsInRaw(entry)
  return out
}

/**
 * Vector figures are gone.
 *
 * The drawing primitives were never what this editor is for — a picture goes in
 * as an image — so both homes for them are removed: a container whose payload
 * was a shape becomes an empty text container, and an inline `slaidsShape` node
 * is dropped from the document it sat in. A shape carried no text, so nothing
 * the author wrote is lost.
 */
const migrate2to3: MigrationFn = (data) => ({
  ...(dropShapesInRaw(data) as Raw),
  schemaVersion: 3,
})

/** True for a container payload of the removed `shape` type. */
function isShapePayload(record: Raw): boolean {
  return record.type === 'shape' && 'shape' in record
}

function dropShapesInRaw(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !isRawNodeOfType(entry, 'slaidsShape'))
      .map(dropShapesInRaw)
  }
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  if (isShapePayload(record)) return { type: 'richdoc', doc: emptyDoc() }  // v3 shape; v4 converts it
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = dropShapesInRaw(entry)
  return out
}

function isRawNodeOfType(value: unknown, type: string): boolean {
  return Boolean(value) && typeof value === 'object' && (value as Raw).type === type
}

/**
 * A container's text becomes a one-subfield body.
 *
 * Containers can be divided into subfields like a card, so the payload that
 * used to hold a single document now holds the same `CardBody` a card does.
 * One subfield is exactly what a container was before, and the container's own
 * vertical alignment moves onto that subfield, which is where alignment lives
 * now.
 */
const migrate3to4: MigrationFn = (data) => ({
  ...(fieldsInRaw(data) as Raw),
  schemaVersion: 4,
})

function fieldsInRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fieldsInRaw)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  if (record.kind === 'container' && isRichdocPayload(record.payload)) {
    const payload = record.payload as Raw
    const { verticalAlign, ...rest } = record
    return {
      ...rest,
      payload: {
        type: 'fields',
        body: {
          axis: 'y',
          weights: [1],
          subfields: [
            {
              id: newSubfieldId(),
              doc: payload.doc,
              ...(typeof verticalAlign === 'string' ? { verticalAlign } : {}),
            },
          ],
        },
      },
    }
  }
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = fieldsInRaw(entry)
  return out
}

function isRichdocPayload(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && (value as Raw).type === 'richdoc'
}

/**
 * A theme gains its two scales.
 *
 * Luft and skriftstørrelse are multipliers, so the neutral one is exactly what
 * every existing presentation already looks like — see `NEUTRAL_SCALE`. What a
 * new deck opens in is a different question, and not this one.
 */
const migrate4to5: MigrationFn = (data) => {
  const theme = (data.theme ?? {}) as Raw
  return {
    ...data,
    schemaVersion: 5,
    theme: {
      ...theme,
      spacing: asNumber(theme.spacing, NEUTRAL_SCALE),
      fontScale: asNumber(theme.fontScale, NEUTRAL_SCALE),
    },
  }
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * An idea may be uncategorised.
 *
 * Deleting a category no longer deletes what was under it, so `categoryId` can
 * be `null`. Anything already stored keeps its category — except an idea whose
 * category is gone, which used to be unreachable and is now simply
 * uncategorised.
 */
const migrate5to6: MigrationFn = (data) => {
  const known = new Set(
    asArray(data.ideaCategories)
      .map((category) => (category as Raw)?.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  return {
    ...data,
    schemaVersion: 6,
    ideas: asArray(data.ideas).map((entry) => {
      const idea = (entry ?? {}) as Raw
      const categoryId = idea.categoryId
      return {
        ...idea,
        categoryId: typeof categoryId === 'string' && known.has(categoryId) ? categoryId : null,
      }
    }),
  }
}

/**
 * The ideas list becomes one ordered list.
 *
 * Categories used to live in a list of their own, with each idea naming the
 * category it belonged to. Now a category is a row among the ideas and holds
 * the ones filed under it, which is what lets a loose idea sit between two
 * categories instead of always above them. Reading order is preserved: the
 * uncategorised ideas came first on screen, and they still do.
 *
 * The category colour comes along — it is what tells two lists apart, and a
 * list that changed shape should still look like the one the author left.
 * `done` is the one thing that goes: an idea is a one-line note again, and a
 * note is either still there or deleted. No text is lost.
 *
 * `normalizeIdeas` has the last word, so whatever the old pair of arrays held
 * arrives as a list the schema will accept: one level deep, unique ids, a
 * colour on every category.
 */
const migrate6to7: MigrationFn = (data) => {
  const ideas = asArray(data.ideas).map((entry) => (entry ?? {}) as Raw)
  const row = (idea: Raw): Raw => ({
    id: asString(idea.id, ''),
    kind: 'idea',
    text: asString(idea.text, ''),
  })
  /* An idea naming a category that is not there is loose, not gone. The v6
     schema took any string as a `categoryId`, so an imported document can carry
     one that points nowhere; matching on "is a string" would drop it, since no
     category below collects it either. v5→v6 treated a missing category as
     uncategorised, and so does this. */
  const known = new Set(
    asArray(data.ideaCategories)
      .map((entry) => ((entry ?? {}) as Raw).id)
      .filter((id): id is string => typeof id === 'string'),
  )
  const loose = ideas
    .filter((idea) => typeof idea.categoryId !== 'string' || !known.has(idea.categoryId))
    .map(row)
  const categories = asArray(data.ideaCategories).map((entry) => {
    const category = (entry ?? {}) as Raw
    const id = asString(category.id, '')
    return {
      id,
      kind: 'category',
      text: asString(category.name, 'Kategori'),
      color: asString(category.color, ''),
      ideas: ideas.filter((idea) => idea.categoryId === id).map(row),
    }
  })

  const { ideaCategories, ...rest } = data
  void ideaCategories
  return { ...rest, schemaVersion: 7, ideas: normalizeIdeas([...loose, ...categories]) }
}

/**
 * Every deck gets a cover, and a heading pill stops storing the default colour.
 *
 * Two halves of the same change. The cover is new and mandatory, so one is
 * added to every existing presentation, titled with the name the deck already
 * has — the one line of cover text the author has demonstrably written.
 *
 * The second half is what makes the cover's colour mean something. Until now
 * every heading stored a colour, because the editor wrote the default one into
 * the document; from here a heading stores a colour only when somebody picked
 * one, and a heading with none reads the cover's. So a stored colour that is
 * exactly the old default is cleared: it was never a choice, it was the absence
 * of one, and leaving it behind would freeze those headings out of the very
 * behaviour this migration exists to give them. Any other colour is a real
 * decision and is kept untouched.
 */
const migrate7to8: MigrationFn = (data) => ({
  ...(dropDefaultHeadingColors(data) as Raw),
  schemaVersion: 8,
  cover: {
    title: (data.cover as Raw | undefined)?.title ?? titleDoc(asString(data.title, '')),
    subtitle: (data.cover as Raw | undefined)?.subtitle ?? titleDoc(''),
    pillColor: (data.cover as Raw | undefined)?.pillColor ?? DEFAULT_PILL_COLOR,
  },
})

/**
 * The pill colour the editor used to write into every heading, as a literal.
 *
 * Deliberately not `DEFAULT_PILL_COLOR`: a migration describes what documents
 * written *then* look like, and that does not change when today's default does.
 * Pointed at the constant, changing the default would silently rewrite the
 * meaning of this step for every document it has not run on yet.
 */
const LEGACY_HEADING_COLOR = '#33475b'

/**
 * The same story as `migrate7to8`, one version later and for the other panel
 * that carries a colour: a titled card's header. Until now `headerColor` was
 * mandatory, so the factory wrote the same literal into every card whether or
 * not anyone picked a colour. From here `headerColor` is `null` until somebody
 * chooses one, and a card with none reads the cover's pill colour — so a
 * stored colour that is exactly the old default is cleared, and any other
 * colour is a real decision and is kept untouched.
 */
const migrate8to9: MigrationFn = (data) => ({
  ...(dropDefaultHeaderColors(data) as Raw),
  schemaVersion: 9,
})

/**
 * A picture is a content kind of its own.
 *
 * Until now a picture filling a zone was a *container* with an `asset` payload
 * — the same object that otherwise holds text fields, wearing a different hat.
 * It made a container two things at once, and it made "how does a zone show a
 * picture" a question with an answer buried one level down. From here a
 * picture is `image`, a container is text and nothing else, and the payload
 * wrapper is gone from both.
 *
 * The crop moves with it. `fit: 'cover'` was already this: fill the zone and
 * hide what does not fit, centred. `fit: 'contain'` was the other thing — the
 * whole file, letterboxed — and it no longer exists, because a picture in a
 * zone is now always a card filled to the edges. A container's `verticalAlign`
 * went with `contain` and becomes the crop's vertical focus, which is what it
 * always meant: `top` framed the top of the file, `bottom` the bottom.
 *
 * `rounded` goes with them. It was the choice between square corners and a
 * card's, and a picture that fills its zone now always has the card's — so
 * there is no longer a choice to carry over, only a flag to drop.
 */
const migrate10to11: MigrationFn = (data) => ({
  ...(liftAssetContainers(data) as Raw),
  schemaVersion: 11,
})

/** The vertical focus a container's alignment stood for. */
const FOCUS_FOR_ALIGN: Record<string, number> = { top: 0, middle: 0.5, bottom: 1 }

function liftAssetContainers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(liftAssetContainers)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = liftAssetContainers(entry)

  if (record.kind !== 'container' || !out.payload || typeof out.payload !== 'object') return out
  const payload = out.payload as Raw

  if (payload.type === 'asset') {
    const align = typeof out.verticalAlign === 'string' ? out.verticalAlign : 'middle'
    return {
      id: out.id,
      kind: 'image',
      image: {
        assetId: typeof payload.assetId === 'string' ? payload.assetId : null,
        focus: { x: 0.5, y: FOCUS_FOR_ALIGN[align] ?? 0.5 },
        caption: null,
      },
    }
  }
  // A text container: the wrapper goes, the body stays exactly as it was. The
  // alignment goes with it — it never meant anything for text, which aligns
  // per subfield.
  return { id: out.id, kind: 'container', body: payload.body }
}

function dropDefaultHeaderColors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropDefaultHeaderColors)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = dropDefaultHeaderColors(entry)

  if (
    record.kind === 'titled-card' &&
    typeof out.headerColor === 'string' &&
    normalizeHex(out.headerColor) === LEGACY_HEADING_COLOR
  ) {
    out.headerColor = null
  }
  return out
}

function dropDefaultHeadingColors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropDefaultHeadingColors)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = dropDefaultHeadingColors(entry)

  if (record.type === 'heading' && out.attrs && typeof out.attrs === 'object') {
    const attrs = out.attrs as Raw
    if (
      typeof attrs.color === 'string' &&
      normalizeHex(attrs.color) === LEGACY_HEADING_COLOR
    ) {
      const { color, ...rest } = attrs
      void color
      out.attrs = rest
    }
  }
  return out
}

/**
 * The blank line a field ends with is not content.
 *
 * Inserting a picture into a field split the paragraph it landed in and left
 * an empty one behind it — every time, in every document written until now. It
 * drew a full line of nothing under the picture, and because a field aligns
 * its whole flow, it is also why centred content sat high with more air below
 * it than above. The line still exists while editing, as the place the caret
 * goes when somebody wants to write on; it is simply no longer part of the
 * document. See `trimTrailingBlankLines`.
 */
const migrate9to10: MigrationFn = (data) => ({
  ...(trimBlankLinesInRaw(data) as Raw),
  schemaVersion: 10,
})

/**
 * Apply `trimTrailingBlankLines` wherever a document lives in the raw data.
 *
 * The same walk `mergeCitationsInRaw` does, and for the same reason: migrations
 * run before validation, so the shape cannot be trusted, and walking every
 * `doc` covers slide titles, card titles, subfields, containers, the cover and
 * the sandbox without knowing where any of them are.
 */
function trimBlankLinesInRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimBlankLinesInRaw)
  if (!value || typeof value !== 'object') return value

  const record = value as Raw
  if (record.type === 'doc' && Array.isArray(record.content)) {
    return { ...(trimTrailingBlankLines(record as unknown as RichDoc) as unknown as Raw) }
  }
  const out: Raw = {}
  for (const [key, entry] of Object.entries(record)) out[key] = trimBlankLinesInRaw(entry)
  return out
}

/**
 * The deck's front page as a section slide, from whatever is there.
 *
 * Used both by the migration and by `repairPresentation`, because a document
 * already at the current version runs no migration at all — and a presentation
 * whose first slide is not a section is one the schema refuses and the editor
 * therefore cannot open. A missing front page is not corruption worth failing
 * over: it is a page that can be rebuilt from the deck's own name without
 * guessing.
 *
 * The two colours are read from wherever they were written down before: the
 * cover's `pillColor` became the accent, and the theme's `backgroundColor`
 * became the page colour of the first section — which is exactly what it meant
 * while there was only one of them.
 */
function frontSectionFrom(data: Raw): Raw {
  const raw = (data.cover ?? {}) as Raw
  const theme = (data.theme ?? {}) as Raw
  const doc = (candidate: unknown, fallback: string): RichDoc => {
    const record = (candidate ?? {}) as Raw
    return record.type === 'doc' ? (record as unknown as RichDoc) : titleDoc(fallback)
  }
  return {
    id: newSlideId(),
    kind: 'section',
    title: doc(raw.title, asString(data.title, '')),
    subtitle: doc(raw.subtitle, ''),
    accentColor: normalizeHex(asString(raw.pillColor, '')) ?? DEFAULT_PILL_COLOR,
    backgroundColor:
      normalizeHex(asString(theme.backgroundColor, '')) ?? DEFAULT_BACKGROUND_COLOR,
  }
}

/**
 * A zone ratio is a whole number from now on.
 *
 * Until now a split stored whatever positive numbers it was given — the ratio
 * dialog accepted decimals and a released drag handle wrote down wherever the
 * pointer happened to stop, so decks are full of ratios like
 * `0.3125 : 0.625 : 0.3125` that no author ever typed and none of them can read
 * back. The layout those describe is kept: each split is replaced by the
 * closest ratio the new ladder can express, which for the overwhelming majority
 * of decks is the same geometry to within a rounding error and for the rest is
 * the nearest thing to it.
 *
 * `quantizeStoredRatios` is the repair, shared with the template validator and
 * built on the very function the commands use, so "what a stored deck holds"
 * and "what an edit produces" cannot drift apart.
 */
const migrate11to12: MigrationFn = (data) => ({
  ...(quantizeStoredRatios(data) as Raw),
  schemaVersion: 12,
})

/**
 * The cover becomes the deck's first section slide.
 *
 * Sections are a slide kind now, and the front page is simply the first of
 * them — so the one page that used to live beside `slides` moves into it, and
 * "every deck has a front page" stops being a field and becomes the promise
 * `DeckSlides` makes. Existing slides gain `kind: 'content'`, which is what
 * they always were.
 *
 * The page colour moves the same way. It was one value in the theme for the
 * whole deck; it is a section's now, so it is written into the section this
 * migration creates and every slide after it inherits exactly the colour it
 * was drawn in before. Nothing about a migrated deck looks different — which
 * is the point: what changed is where the colour can be changed from.
 */
const migrate12to13: MigrationFn = (data) => {
  const { cover, ...rest } = data
  void cover
  const theme = { ...((data.theme ?? {}) as Raw) }
  delete theme.backgroundColor
  const slides = asArray(data.slides).map((entry) => ({
    ...((entry ?? {}) as Raw),
    kind: 'content',
  }))
  return {
    ...rest,
    schemaVersion: 13,
    theme,
    slides: [frontSectionFrom(data), ...slides],
  }
}

/**
 * Interactive slides become a slide kind.
 *
 * Nothing in a stored deck changes shape: a v13 document holds sections and
 * content slides, and both are exactly what they were. What the version
 * carries is the *vocabulary* — from here a deck may contain
 * `kind: 'interactive'`, and a Slaids that only knows v13 refuses such a
 * document by version, with the message that says so, rather than by tripping
 * over a slide kind it has never heard of halfway through validation.
 */
const migrate13to14: MigrationFn = (data) => ({ ...data, schemaVersion: 14 })

/**
 * v14 → v15: an interactive slide says which design contract it was written
 * against.
 *
 * Every slide that exists was written against the first one, so that is what
 * they get. The field exists so the *next* change to what an unstyled miniapp
 * looks like can leave these alone: a slide keeps the contract it names, and
 * nothing about the stored file changes. See `INTERACTIVE_STYLE_CONTRACTS`.
 */
const migrate14to15: MigrationFn = (data) => ({
  ...data,
  slides: asArray(data.slides).map((slide) => {
    const row = (slide ?? {}) as Raw
    if (row.kind !== 'interactive') return slide
    return { ...row, styleContract: row.styleContract ?? 1 }
  }),
  schemaVersion: 15,
})

/**
 * v15 → v16: a zone no longer holds editorial text of its own.
 *
 * Notes are gone as a content kind. What a note *was* — a rectangle reserved
 * for a picture that would be made somewhere else, with the prompt parked in it
 * — is now a real picture zone waiting for its file, plus an entry in the
 * deck's image plan. So there is nothing for a stored note to become that would
 * be equivalent to what it was.
 *
 * It becomes deliberate air, and that is the conservative answer rather than a
 * convenient one. The two alternatives are both worse:
 *
 *  - **Turning it into a card with the text in it** would take working material
 *    that was never shown to anybody — a prompt, a reminder, a question to
 *    oneself — and put it on a slide an audience reads. Editorial text becoming
 *    audience text without the author doing anything is the one outcome a
 *    migration must not produce.
 *  - **Removing the zone** would reflow every sibling around it, so an old deck
 *    would open as a composition its author never laid out.
 *
 * Air keeps the rectangle and its place in the tree, draws nothing, and has no
 * minimum size — exactly what a note did on every surface but the editor's own
 * affordance. The text itself is dropped, because the only place left that
 * could hold it is a slide.
 *
 * The same version renames `imageBrief` to `imageContext`. «Brief» now means
 * the one generated, copy-paste message an author hands an image generator
 * (`domain/imagePlan.ts`), and the stored field is the shared visual context
 * that heads it — one word, one meaning, and the rename is what keeps a deck
 * written before the distinction existed from carrying the older one.
 */
const migrate15to16: MigrationFn = (data) => ({
  ...renameImageBrief(data),
  slides: asArray(data.slides).map((slide) => {
    const row = (slide ?? {}) as Raw
    if (row.kind !== 'content') return slide
    return { ...row, root: retireNotes(row.root) }
  }),
  sandbox: asArray(data.sandbox).filter((item) => {
    /* A parked note is the one case where dropping the item entirely is right:
       the sandbox holds content waiting to go back into a zone, and there is no
       zone left that takes a note. */
    const content = ((item ?? {}) as Raw).content as Raw | undefined
    return content?.kind !== 'note'
  }),
  schemaVersion: 16,
})

function renameImageBrief(data: Raw): Raw {
  if (!('imageBrief' in data)) return data
  const { imageBrief, ...rest } = data
  return typeof imageBrief === 'string' && imageBrief !== ''
    ? { ...rest, imageContext: imageBrief }
    : rest
}

function retireNotes(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node
  const row = node as Raw
  if (row.kind === 'split') {
    return { ...row, children: asArray(row.children).map(retireNotes) }
  }
  const content = row.content as Raw | null | undefined
  if (!content || content.kind !== 'note') return row
  return { ...row, content: { id: asString(content.id, 'c_note'), kind: 'negative-space' } }
}

/**
 * v16 → v17: the deck stops remembering what an agent said it had generated.
 *
 * `generatedImages` was a record, written by the agent, of which file it had
 * made for which planned picture — the bookkeeping of a flow that generated the
 * pictures one at a time and reported each one back between the calls. That
 * flow is gone: the deck is finished first, the whole series is ordered from one
 * brief in one conversation somewhere else, and the files arrive together
 * through the user's deposit.
 *
 * So the field is dropped rather than migrated, and there is nothing to migrate
 * it *to*. Every fact in a record was already in the plan before any picture
 * existed, which is precisely why it could not answer the question it was
 * stored for: a complete set of bindings was exactly as cheap to produce by
 * copying the plan as by making the pictures. What a deck can actually observe
 * is a file in a picture zone, and that lives on the zone.
 *
 * Nothing on a slide changes, and no picture already deposited is touched.
 */
const migrate16to17: MigrationFn = (data) => {
  const { generatedImages: _dropped, ...rest } = data
  return { ...rest, schemaVersion: 17 }
}

/**
 * Et tema får to utseendevalg: om bokser kaster skygge, og hvordan et kort med
 * tittel tegner den. Alle dekk lagret før valgene fantes, hadde skygger og en
 * header i ett med innholdet, så det er det som fylles inn.
 */
const migrate17to18: MigrationFn = (data) => {
  const theme = (data.theme ?? {}) as Raw
  return { ...data, schemaVersion: 18, theme: { ...theme, ...cardLookOf(theme) } }
}

/**
 * De to utseendevalgene et tema lagrer, slik et lagret tema har dem – eller
 * slik alle dekk før dem så ut, der en verdi mangler eller er ukjent for
 * temaet. Delt av migreringen som innførte dem og av `repairPresentation`, så
 * de to ikke kan være uenige om hvordan et dekk uten dem ser ut.
 */
function cardLookOf(theme: Raw): { boxShadows: boolean; titledCardStyle: TitledCardStyle } {
  const style = TITLED_CARD_STYLES.find((known) => known === theme.titledCardStyle)
  return {
    boxShadows: typeof theme.boxShadows === 'boolean' ? theme.boxShadows : true,
    titledCardStyle: style ?? DEFAULT_TITLED_CARD_STYLE,
  }
}

/** Keyed by the version the migration upgrades *from*. */
export const MIGRATIONS: Record<number, MigrationFn> = {
  0: migrate0to1,
  1: migrate1to2,
  2: migrate2to3,
  3: migrate3to4,
  4: migrate4to5,
  5: migrate5to6,
  6: migrate6to7,
  7: migrate7to8,
  8: migrate8to9,
  9: migrate9to10,
  10: migrate10to11,
  11: migrate11to12,
  12: migrate12to13,
  13: migrate13to14,
  14: migrate14to15,
  15: migrate15to16,
  16: migrate16to17,
  17: migrate17to18,
}

/**
 * Repair the small set of defects that would otherwise make a whole
 * presentation unopenable.
 *
 * Deliberately narrow: colour and font fields are coerced, because those are
 * single values that the schema rejects outright while the rest of the document
 * is perfectly readable. Structural corruption in the *layout tree* is not
 * repaired — it should surface as a validation error rather than be silently
 * rewritten, because a slide quietly rebuilt is a slide the author no longer
 * recognises.
 *
 * The ideas list is the one exception, and deliberately so: it is a side list
 * of one-line notes, not the document, and the rule it is held to — one level
 * of categories — is one every reader can restore without guessing. Letting a
 * malformed note list make a presentation unopenable would trade something
 * worth keeping for something that is not.
 */
export function repairPresentation(data: Raw): Raw {
  const theme = (data.theme ?? {}) as Raw
  const repairedTheme = {
    ...theme,
    headingFontFamily: asString(theme.headingFontFamily, '').trim() || DEFAULT_HEADING_FONT,
    bodyFontFamily: asString(theme.bodyFontFamily, '').trim() || DEFAULT_BODY_FONT,
    spacing: clampScale(theme.spacing, SPACING_RANGE, DEFAULT_SPACING),
    fontScale: clampScale(theme.fontScale, FONT_SCALE_RANGE, DEFAULT_FONT_SCALE),
    ...cardLookOf(theme),
  }

  const repairColors = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(repairColors)
    if (!value || typeof value !== 'object') return value
    const entries = Object.entries(value as Raw).map(([key, entry]) => {
      if ((key === 'backgroundColor' || key === 'headerColor') && typeof entry === 'string') {
        return [key, normalizeHex(entry) ?? DEFAULT_CARD_COLOR]
      }
      return [key, repairColors(entry)]
    })
    return Object.fromEntries(entries)
  }

  const repaired = repairColors(data) as Raw
  const slides = asArray(repaired.slides)
  const front = (slides[0] ?? {}) as Raw
  return {
    ...repaired,
    /* The front page is rebuilt rather than refused, for the same reason the
       theme's colours are coerced: a deck whose first slide is not a section is
       one the schema refuses, and an otherwise perfectly readable document
       would be unopenable over a page that can be rebuilt from its own name. */
    slides: front.kind === 'section' ? slides : [frontSectionFrom(data), ...slides],
    /* The ideas list repairs rather than refuses — that is the contract
       `src/domain/ideas.ts` states, and this is the only place it can be kept.
       A document already at the current version runs no migration, so without
       this a category nested in a category would fail validation and take the
       whole presentation with it, and duplicate ids, multi-line text and a list
       past `MAX_IDEAS` would pass straight through. `normalizeIdeas` keeps every
       id it can, so nothing that was readable moves. */
    ideas: normalizeIdeas(data.ideas),
    theme: repairedTheme,
  }
}

function clampScale(
  value: unknown,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

export function detectSchemaVersion(input: unknown): number {
  if (!input || typeof input !== 'object') return -1
  const version = (input as Raw).schemaVersion
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 ? version : 0
}

/** Run migrations then validate. Returns a typed error rather than throwing. */
export function migratePresentation(input: unknown): Result<Presentation> {
  if (!input || typeof input !== 'object') {
    return err('INVALID_CONTENT', 'Presentasjonsdataene er ikke et objekt.')
  }
  let version = detectSchemaVersion(input)
  if (version < 0) {
    return err('INVALID_CONTENT', 'Ukjent dataformat.')
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return err(
      'INVALID_CONTENT',
      `Presentasjonen er lagret med et nyere format (v${version}) enn denne versjonen av Slaids støtter (v${CURRENT_SCHEMA_VERSION}).`,
    )
  }

  let data = { ...(input as Raw) }
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[version]
    if (!migration) {
      return err('INVALID_CONTENT', `Mangler migrasjon fra schemaVersion ${version}.`)
    }
    data = migration(data)
    const next = detectSchemaVersion(data)
    if (next <= version) {
      return err('INVALID_CONTENT', `Migrasjonen fra v${version} økte ikke schemaVersion.`)
    }
    version = next
  }

  const validation = validatePresentation(repairPresentation(data))
  if (!validation.ok || !validation.value) {
    const detail = validation.issues
      .slice(0, 5)
      .map((issue) => `${issue.path || 'root'}: ${issue.message}`)
      .join('; ')
    return err('INVALID_CONTENT', `Presentasjonen er ugyldig. ${detail}`, {
      issues: validation.issues,
    })
  }
  return ok(validation.value)
}
