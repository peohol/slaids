/**
 * The deck's picture plan, and the two texts that are generated from it.
 *
 * Slaids never makes a picture. What it can do is make the *order* for one
 * unambiguous, and that is what this module is: the structured half of the
 * workflow lives in the document — one entry per reserved picture zone — and
 * the texts an image generator or an author is handed are composed from it
 * here, once, so there is no second description of the same picture to fall out
 * of step with the first.
 *
 * The two texts are not two views of the same thing, and the difference is the
 * point:
 *
 *  - `composeImageGenerationPrompt` is what a generation call carries. It can
 *    see **one** entry, so a picture is ordered as a complete, self-contained
 *    task with no count, no numbering and no other motif in it.
 *  - `composeImageBrief` is the whole plan as one message for a person — the
 *    editor's brief dialog, documentation, debugging. It is internal to that,
 *    never a prompt and never a step in the normal generation flow, because a
 *    reader shown nine numbered motifs has been handed a set to compose.
 *
 * Three things make the generated brief worth generating rather than writing:
 *
 *  - **The number of pictures is counted, never stated.** A brief that says
 *    «lag 7 bilder» and then lists six is a brief that produces six, or eight.
 *    Here the count, the numbering and the list are the same array.
 *  - **Every aspect ratio is measured off the slide.** The rectangle a picture
 *    will fill is a fact about the zone tree — `computeSlideGeometry` knows it
 *    — so it is read from there rather than from an agent's prose about what
 *    shape the picture should be. That is the failure this replaces: wide
 *    prompts written for near-square zones.
 *  - **The checks are asked of the same data the brief is built from.** See
 *    `checkImagePlan`: a mismatch between plan and deck is a question about
 *    two things this module already holds, so it cannot be answered one way
 *    here and another way in a prompt.
 *
 * Nothing in here is drawn on a slide and nothing in here is published: the
 * plan lives beside the slides, exactly as the sandbox and the ideas list do.
 */

import {
  MAX_PLANNED_IMAGES,
  MAX_PLANNED_IMAGE_FIELD_CHARS,
  PLANNED_IMAGE_FIELDS,
  PLANNED_IMAGE_FIELD_LABELS,
  REQUIRED_PLANNED_IMAGE_FIELDS,
  plannedImageFieldIsBlank,
  type PlannedImageField,
} from './constants'
import { stableDigest } from './digest'
import { IMAGE_PLAN_ITEM_ID_PREFIX } from './imageBinding'
import { computeSlideGeometry } from './geometry'
import { IMAGE_FILE_EXTENSION_LIST } from './imageBytes'
import { panelFrame } from './imageOptimization'
import { collectLeaves } from './layout'
import { geometryForTheme, themeMetrics } from './metrics'
import { docToPlainText } from './richdoc'
import { imagePanelOf } from './content'
import type { Presentation, Size, ZoneContent } from './types'

/**
 * One picture somebody is going to make, and the zone it is being made for.
 *
 * Stored addressed by slide and zone, and by nothing else: the zone *is* what
 * decides the shape, what carries the placeholder the author reads, and what
 * the finished file eventually lands in, so a second *stored* name for it would
 * be one more thing to keep in step. The entry's public identity —
 * `imagePlanItemId`, the name a generated file is bound to — is therefore
 * derived from the entry rather than stored beside it. See `imagePlanItemId`.
 *
 * The four text fields are the four sections of a picture's entry in the brief.
 * They are separate rather than one blob because each one is checked, shown and
 * reasoned about separately: the motif is what must differ between pictures,
 * the framing is what must match the zone's shape, and what to avoid is the
 * part that has to stay local to one picture rather than leak into the deck's
 * shared context.
 */
export interface PlannedImage {
  slideId: string
  nodeId: string
  /** What the picture shows. Required: the one field that must differ between pictures. */
  subject: string
  /** Framing, crop, camera angle, necessary negative space. Required. */
  composition: string
  /** What has to be depicted correctly for the picture to be usable. */
  requirements: string
  /** What must not appear in *this* picture. Never the deck's shared context. */
  avoid: string
}

/* ------------------------------------------------------------------ *
 * The stable identity of one plan entry
 * ------------------------------------------------------------------ */

/** The prefix every plan-entry id carries, so an id is recognisable on sight. */
/* The prefix and the predicate are the shared module's: the document schema
   checks them too, and it sits below this file in the import graph. Re-exported
   because this is where a reader looks for everything about a plan entry's
   identity. */
export { IMAGE_PLAN_ITEM_ID_PREFIX, isImagePlanItemId } from './imageBinding'

/**
 * The whole order for one picture: what it identifies, and what it was made from.
 *
 * Written out as a type rather than as positional arguments because the list
 * *is* the contract — and because the list grew once already. It first held five
 * facts (deck, zone, number, motif) and that was not enough: `composition`,
 * `requirements`, `avoid`, the deck's shared context and the measured format are
 * all part of what a generator is actually told, so any of them could be
 * rewritten while a picture generated from the old wording still passed.
 *
 * What is deliberately *not* in it is everything a generator is never told: the
 * deck's title, the slide's title, the other slides, the theme. An edit to those
 * must not invalidate finished pictures.
 */
export interface ImagePlanItemOrder {
  presentationId: string
  slideId: string
  nodeId: string
  /** 1‥N in deck order — the number the placeholder, the brief and the file say. */
  number: number
  /** The four text fields, exactly as the brief prints them. */
  fields: Record<PlannedImageField, string>
  /** The deck's shared visual context: part of every picture's order, not one's. */
  imageContext: string
  /** The format the brief states, measured off the zone. */
  aspectRatio: string
  /** The word the brief puts beside the ratio. */
  orientation: ImageOrientation
}

/**
 * The stable identity of one planned picture: `imgplan_<digest>`.
 *
 * This exists because of a specific failure, and the failure was not a bug in
 * any one line of code: Slaids planned nine pictures in slide order, the image
 * generator produced them in the order 1, 3, 9, 6, 5, 8, 2, 4, 7, and the files
 * were then named `1`‥`9` **by the order they came back in**. Most pictures
 * landed on the wrong slide, and every single step of the flow looked like it
 * had succeeded — because generation order had been allowed to stand in for
 * identity, and nothing downstream held anything better to compare it against.
 *
 * So the entry gets a name of its own, and it is *derived* rather than minted:
 *
 *  - **Derived, so it needs no storage and cannot drift.** A stored random id
 *    would have to be migrated into every existing document, kept in step by
 *    every command that rewrites a plan, and could still end up naming an entry
 *    that has since been rewritten. A digest over the facts that make the entry
 *    what it is answers «is this still the same planned picture?» by
 *    construction.
 *  - **Over the whole order, not part of it.** The id is the one thing that
 *    travels out to a generator and back, so it has to cover everything the
 *    generator was told — see `ImagePlanItemOrder`. Change any of it and the id
 *    changes, which is precisely the event a deposit has to refuse rather than
 *    absorb. Leaving `composition` or the shared context out would have let a
 *    rewritten brief keep vouching for pictures made from the old one.
 *
 * Every text is normalised the way this module normalises motifs everywhere
 * else, so fixing a capital letter or a double space is not a new picture.
 *
 * What it does **not** say anything about is whether the file somebody hands
 * back actually shows that motif. That is a different question, asked with the
 * file's own bytes; see `imageGeneration.ts`.
 */
export function imagePlanItemId(order: ImagePlanItemOrder): string {
  return (
    IMAGE_PLAN_ITEM_ID_PREFIX +
    stableDigest([
      order.presentationId,
      order.slideId,
      order.nodeId,
      order.number,
      /* Derived from `PLANNED_IMAGE_FIELDS` rather than listed: a field added to
         a plan entry is part of the order the moment it exists, and a list here
         would be one more place to forget it. */
      ...PLANNED_IMAGE_FIELDS.map((field) => normalize(order.fields[field])),
      normalize(order.imageContext),
      order.aspectRatio,
      order.orientation,
    ])
  )
}

/**
 * The file name one planned picture's file must carry, without its extension.
 *
 * The number, and nothing else — but read off the plan entry rather than
 * counted out while files are being saved. That is the whole distinction the
 * observed failure turned on: `${planItem.number}` and `${index + 1}` produce
 * the same string for a generator that answers in order, and a different one
 * for every generator that does not.
 */
export function imageFileNameStem(number: number): string {
  return String(number)
}

/**
 * The number a finished file claims, read back out of its name, or `null`.
 *
 * The other direction of `imageFileNameStem`, and here beside it so the pair
 * cannot come apart: one rule writes the name, one rule reads it, and they are
 * the same rule.
 *
 * Strict on purpose. A leading zero is refused rather than trimmed, because
 * `01.png` and `1.png` in the same folder are two files for one picture, and a
 * rule that accepted both would have to guess which. Anything before or after
 * the digits is refused for the same reason: `bilde1.png` looks like a match
 * and is a file named after something else.
 */
export function imageFileNumber(fileName: string): number | null {
  // Some browsers hand over a path when a folder is dropped. The name is the
  // last segment of it, and the segments before it say nothing about the order.
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const match = /^([1-9][0-9]*)\.([A-Za-z0-9]+)$/.exec(base)
  if (!match) return null
  if (!IMAGE_FILE_EXTENSION_LIST.includes(match[2].toLowerCase())) return null
  return Number(match[1])
}

/* ------------------------------------------------------------------ *
 * Aspect ratios
 * ------------------------------------------------------------------ */

/**
 * How far from 1∶1 a rectangle may be and still be called near-square.
 *
 * The number exists because the failure it names is specific: a prompt written
 * as a wide landscape for a zone that is almost a square comes back cropped or
 * recomposed. «Near-square» has to be one definition, used both to describe a
 * zone and to judge a prompt that claims a shape, or the description and the
 * check disagree.
 */
export const SQUARE_ASPECT_TOLERANCE = 1.1

export type ImageOrientation = 'stående' | 'nær kvadratisk' | 'liggende'

export function orientationOf(aspect: number): ImageOrientation {
  if (aspect >= SQUARE_ASPECT_TOLERANCE) return 'liggende'
  if (aspect <= 1 / SQUARE_ASPECT_TOLERANCE) return 'stående'
  return 'nær kvadratisk'
}

/** The largest denominator a printed ratio may use. Past this it stops reading as a ratio. */
const MAX_RATIO_TERM = 24

/**
 * A rectangle as the smallest whole ratio that still describes it.
 *
 * Continued fractions rather than a lookup table of the ratios one generator
 * happens to accept: a zone tree produces whatever shape the weights produce,
 * and snapping that to the nearest «supported» ratio would be Slaids lying
 * about its own geometry. The bound on the terms is what keeps `1600×901`
 * from printing as `1600:901`.
 */
export function aspectRatioLabel(size: Size): string {
  const aspect = size.width / size.height
  if (!Number.isFinite(aspect) || aspect <= 0) return '1:1'
  const [numerator, denominator] = approximateRatio(aspect)
  return `${numerator}:${denominator}`
}

function approximateRatio(value: number): [number, number] {
  let bestNumerator = 1
  let bestDenominator = 1
  let bestError = Number.POSITIVE_INFINITY
  for (let denominator = 1; denominator <= MAX_RATIO_TERM; denominator += 1) {
    const numerator = Math.round(value * denominator)
    if (numerator < 1 || numerator > MAX_RATIO_TERM) continue
    const error = Math.abs(value - numerator / denominator)
    if (error < bestError - 1e-9) {
      bestError = error
      bestNumerator = numerator
      bestDenominator = denominator
    }
  }
  return [bestNumerator, bestDenominator]
}

/* ------------------------------------------------------------------ *
 * Reading the plan back against the deck
 * ------------------------------------------------------------------ */

/** The placeholder caption a reserved picture zone carries until its file arrives. */
export function placeholderCaption(number: number): string {
  return `Sett inn bilde ${number} her`
}

/** Whether a caption is one Slaids wrote, and may therefore take back. */
export function isPlaceholderCaption(text: string): boolean {
  return /^sett inn bilde \d+ her$/i.test(text.trim())
}

export interface ResolvedPlannedImage {
  /**
   * The entry's stable identity: what a generated file is bound to, all the way
   * from the brief to the deposit. Derived — see `imagePlanItemId`.
   */
  id: string
  /** 1‥N in deck order. The number the placeholder caption says. */
  number: number
  /** What the finished file is called, without its extension. The number. */
  fileNameStem: string
  plan: PlannedImage
  /** What the slide is called, so the author can find the zone again. */
  slideLabel: string
  /** The rectangle the picture itself fills — a titled card's header removed. */
  frame: Size
  aspect: number
  aspectRatio: string
  orientation: ImageOrientation
  /** Whether the file has arrived. A filled zone keeps its number. */
  filled: boolean
  /** What the zone's caption says today, as plain text. `null` when it has none. */
  caption: string | null
}

/**
 * Every planned picture, in deck order, with its zone resolved.
 *
 * Deck order rather than the order the entries were written in, because the
 * numbering is what ties the brief to the placeholders the author reads on the
 * slides: «bilde 3» has to be the third one you meet going through the deck, or
 * the mapping is something only the plan knows.
 *
 * Entries whose zone has gone — a deleted slide, a re-split tree — are left out
 * rather than numbered, and `checkImagePlan` is what says so. A brief with a
 * gap in its numbering is worse than a brief that is one picture short.
 */
export function resolveImagePlan(presentation: Presentation): ResolvedPlannedImage[] {
  const plan = presentation.imagePlan ?? []
  if (plan.length === 0) return []
  const byZone = new Map(plan.map((entry) => [imageZoneKey(entry.slideId, entry.nodeId), entry]))
  const tokens = themeMetrics(presentation.theme)
  const options = geometryForTheme(presentation.theme)
  const resolved: ResolvedPlannedImage[] = []

  presentation.slides.forEach((slide, index) => {
    if (slide.kind !== 'content') return
    const geometry = computeSlideGeometry(slide, options)
    for (const leaf of collectLeaves(slide.root)) {
      const entry = byZone.get(imageZoneKey(slide.id, leaf.id))
      if (!entry || !leaf.content) continue
      // A zone that has stopped being a picture zone is not a picture with a
      // problem — it is a plan entry with nothing to number. `checkImagePlan`
      // reports it; leaving it in would put a text card in the brief.
      const panel = imagePanelOf(leaf.content)
      if (!panel) continue
      const rect = geometry.rects.get(leaf.id)
      if (!rect) continue
      const frame = panelFrame(leaf.content, rect, tokens.cardHeaderHeight)
      const aspect = frame.height > 0 ? frame.width / frame.height : 1
      const number = resolved.length + 1
      const aspectRatio = aspectRatioLabel(frame)
      const orientation = orientationOf(aspect)
      resolved.push({
        /* The id is derived from the same values this entry reports, in the same
           pass, so the brief an agent reads and the id it carries back cannot
           describe two different orders. */
        id: imagePlanItemId({
          presentationId: presentation.id,
          slideId: slide.id,
          nodeId: leaf.id,
          number,
          fields: entry,
          imageContext: presentation.imageContext ?? '',
          aspectRatio,
          orientation,
        }),
        number,
        fileNameStem: imageFileNameStem(number),
        plan: entry,
        slideLabel: slideLabel(slide.title, index),
        frame,
        aspect,
        aspectRatio,
        orientation,
        filled: Boolean(panel.assetId),
        caption: panel.caption ? docToPlainText(panel.caption.doc) : null,
      })
    }
  })
  return resolved
}

/** One zone's address as a map key. Exported so no caller invents a second one. */
export function imageZoneKey(slideId: string, nodeId: string): string {
  return `${slideId}::${nodeId}`
}

function slideLabel(title: Parameters<typeof docToPlainText>[0], index: number): string {
  const text = docToPlainText(title).trim()
  return text === '' ? `Slide ${index + 1}` : text
}

/** Picture zones that are waiting for a file: the placeholders a plan must cover. */
export function reservedImageZones(
  presentation: Presentation,
): { slideId: string; nodeId: string; content: ZoneContent }[] {
  const zones: { slideId: string; nodeId: string; content: ZoneContent }[] = []
  for (const slide of presentation.slides) {
    if (slide.kind !== 'content') continue
    for (const leaf of collectLeaves(slide.root)) {
      const panel = leaf.content ? imagePanelOf(leaf.content) : null
      if (panel && !panel.assetId && leaf.content) {
        zones.push({ slideId: slide.id, nodeId: leaf.id, content: leaf.content })
      }
    }
  }
  return zones
}

/* ------------------------------------------------------------------ *
 * The checks that have to pass before a brief is worth sending
 * ------------------------------------------------------------------ */

export type ImagePlanIssueCode =
  /** A plan entry points at a zone that no longer exists or is no longer a picture. */
  | 'ZONE_GONE'
  /** A picture zone is waiting for a file and nothing in the plan describes it. */
  | 'ZONE_NOT_PLANNED'
  /** The prompt claims a shape the zone does not have. */
  | 'ASPECT_MISMATCH'
  /** The number on the slide and the number in the brief have come apart. */
  | 'PLACEHOLDER_STALE'
  /** Two entries describe what amounts to the same picture. */
  | 'NEAR_DUPLICATE'
  /** Pictures are planned and the deck has no shared visual context. */
  | 'MISSING_CONTEXT'
  /** The shared context reaches into what a single picture shows. */
  | 'CONTEXT_OVERREACH'

export interface ImagePlanIssue {
  code: ImagePlanIssueCode
  message: string
  /** Which planned picture it is about, when it is about one. */
  number?: number
  slideId?: string
  nodeId?: string
}

/**
 * Expressions that claim a *format* rather than describe a motif.
 *
 * Deliberately narrow, and narrower than it first was. «landskap» is a subject
 * and says nothing about the rectangle; «landskapsformat» is a claim about it.
 *
 * The first version matched the bare adjectives too — `stående`, `liggende`,
 * `kvadratisk` — and in Norwegian those describe the *subject* at least as
 * often as the frame: «stående helfigur av Homo erectus», «liggende skjelett»,
 * «kvadratisk steinplate». A wide zone would then have flagged the standing
 * figure as a format error and told the agent to rewrite the motif or re-plan
 * the zones — exactly backwards, and precisely the kind of false positive that
 * teaches an agent to write vaguer prompts.
 *
 * So an adjective only counts when it is attached to a word that means the
 * picture's own shape: format, bildeformat, utsnitt, orientering, sideforhold.
 * The compounds (`portrettformat`, `høyformat`, `landskapsformat`,
 * `bredformat`, `kvadratformat`, `widescreen`) are unambiguous on their own.
 *
 * `panorama` stays bare, and the difference is not a judgement call: it is not
 * a property a subject can have. A figure can stand and a skeleton can lie, but
 * nothing *is* a panorama — the word names the shape of the field of view
 * itself.
 */
const FORMAT_NOUNS = '(?:bilde)?format|utsnitt|orientering|sideforhold'

const ORIENTATION_TERMS: readonly { pattern: RegExp; orientation: ImageOrientation }[] = [
  { pattern: /\bpanorama\w*/i, orientation: 'liggende' },
  { pattern: new RegExp(`\\bliggende\\s+(?:${FORMAT_NOUNS})\\b`, 'i'), orientation: 'liggende' },
  { pattern: /\blandskapsformat\b/i, orientation: 'liggende' },
  { pattern: /\bbredformat\b/i, orientation: 'liggende' },
  { pattern: /\bwidescreen\b/i, orientation: 'liggende' },
  { pattern: new RegExp(`\\bstående\\s+(?:${FORMAT_NOUNS})\\b`, 'i'), orientation: 'stående' },
  { pattern: /\bportrettformat\b/i, orientation: 'stående' },
  { pattern: /\bhøyformat\b/i, orientation: 'stående' },
  {
    pattern: new RegExp(`\\bkvadratisk\\w*\\s+(?:${FORMAT_NOUNS})\\b`, 'i'),
    orientation: 'nær kvadratisk',
  },
  { pattern: /\bkvadratformat\b/i, orientation: 'nær kvadratisk' },
]

const WRITTEN_RATIO = /\b(\d{1,2})\s*[:∶]\s*(\d{1,2})\b/g

/** How far a ratio written into a prompt may sit from the zone's own before it is wrong. */
const RATIO_TOLERANCE = 0.08

/** Above this share of shared words, two motifs are the same motif. */
const DUPLICATE_SIMILARITY = 0.8

/**
 * Everything wrong with the deck's picture plan, as a list the agent can work.
 *
 * Editorial rather than structural: a plan entry that names a zone the deck
 * does not have is refused by the command that writes it, so what is left here
 * is the set of questions that only have answers once plan, zones and geometry
 * are read together — and those are exactly the ones an agent cannot check by
 * re-reading its own prompt.
 */
export function checkImagePlan(presentation: Presentation): ImagePlanIssue[] {
  const resolved = resolveImagePlan(presentation)
  const issues: ImagePlanIssue[] = []
  const planned = presentation.imagePlan ?? []

  for (const entry of planned) {
    const found = resolved.some(
      (image) => image.plan.slideId === entry.slideId && image.plan.nodeId === entry.nodeId,
    )
    if (found) continue
    issues.push({
      code: 'ZONE_GONE',
      message:
        'Bildeplanen peker på en sone som ikke finnes lenger, eller som ikke er en bildesone. Fjern oppføringen eller lag sonen på nytt.',
      slideId: entry.slideId,
      nodeId: entry.nodeId,
    })
  }

  const plannedKeys = new Set(planned.map((entry) => imageZoneKey(entry.slideId, entry.nodeId)))
  for (const zone of reservedImageZones(presentation)) {
    if (plannedKeys.has(imageZoneKey(zone.slideId, zone.nodeId))) continue
    issues.push({
      code: 'ZONE_NOT_PLANNED',
      message:
        'Sonen venter på et bilde, men ingen bildeoppføring beskriver det. Legg den inn i bildeplanen, eller gi sonen et annet innhold.',
      slideId: zone.slideId,
      nodeId: zone.nodeId,
    })
  }

  for (const image of resolved) {
    issues.push(...aspectIssues(image))
    const stale = placeholderIssue(image)
    if (stale) issues.push(stale)
  }
  issues.push(...duplicateIssues(resolved))

  const context = (presentation.imageContext ?? '').trim()
  if (resolved.length > 0 && context === '') {
    issues.push({
      code: 'MISSING_CONTEXT',
      message:
        'Dekket planlegger bilder, men har ingen felles bildekontekst. Uten den blir bildene ikke et sett.',
    })
  } else if (context !== '') {
    issues.push(...contextOverreachIssues(context, resolved))
  }
  return issues
}

/**
 * The number on the slide against the number in the brief.
 *
 * Stamping happens when the plan is written; the numbering is deck order, and
 * the deck keeps moving afterwards — a slide dragged in the filmstrip, a zone
 * split, a planned zone cleared. Every one of those renumbers the brief and
 * leaves the captions saying what they said before, and an author reading
 * «Sett inn bilde 2 her» while the brief calls that picture 1 puts the file in
 * the wrong zone.
 *
 * Asked here, once, rather than re-stamped inside each structural command:
 * there are a dozen ways a deck can move under a plan and only one place that
 * can see the result. It also catches the ones no command could — a caption
 * deleted by hand, a document imported from elsewhere. `syncImagePlaceholders`
 * is the repair, and it is one call.
 *
 * A caption the author wrote is not stale: it was never Slaids' to number.
 */
function placeholderIssue(image: ResolvedPlannedImage): ImagePlanIssue | null {
  if (image.filled) return null
  const wanted = placeholderCaption(image.number)
  const current = image.caption?.trim() ?? ''
  if (current === wanted) return null
  if (current !== '' && !isPlaceholderCaption(current)) return null
  return {
    code: 'PLACEHOLDER_STALE',
    message: `Sonen til bilde ${image.number} sier ${
      current === '' ? 'ingenting' : `«${current}»`
    }, mens briefen kaller bildet ${image.number}. Skriv bildeplanen på nytt, så settes plassholderteksten riktig.`,
    number: image.number,
    slideId: image.plan.slideId,
    nodeId: image.plan.nodeId,
  }
}

function aspectIssues(image: ResolvedPlannedImage): ImagePlanIssue[] {
  const text = `${image.plan.subject} ${image.plan.composition}`
  const issues: ImagePlanIssue[] = []

  for (const term of ORIENTATION_TERMS) {
    if (!term.pattern.test(text) || term.orientation === image.orientation) continue
    issues.push({
      code: 'ASPECT_MISMATCH',
      message: `Bilde ${image.number} er beskrevet som ${term.orientation}, men sonen er ${image.orientation} (${image.aspectRatio}). Skriv om motivet, eller planlegg sonene på nytt.`,
      number: image.number,
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
    })
    break
  }

  WRITTEN_RATIO.lastIndex = 0
  for (const match of text.matchAll(WRITTEN_RATIO)) {
    const written = Number(match[1]) / Number(match[2])
    if (!Number.isFinite(written) || written <= 0) continue
    if (Math.abs(written - image.aspect) / image.aspect <= RATIO_TOLERANCE) continue
    issues.push({
      code: 'ASPECT_MISMATCH',
      message: `Bilde ${image.number} nevner forholdet ${match[1]}:${match[2]}, men sonen er ${image.aspectRatio}. Bildebriefen oppgir sonens eget format, så de to sier nå forskjellige ting.`,
      number: image.number,
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
    })
    break
  }
  return issues
}

function duplicateIssues(resolved: readonly ResolvedPlannedImage[]): ImagePlanIssue[] {
  const issues: ImagePlanIssue[] = []
  const words = resolved.map((image) => significantWords(image.plan.subject))
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      if (jaccard(words[i], words[j]) < DUPLICATE_SIMILARITY) continue
      issues.push({
        code: 'NEAR_DUPLICATE',
        message: `Bilde ${resolved[i].number} og bilde ${resolved[j].number} beskriver nesten det samme motivet. To bilder som skal vise forskjellige ting må beskrives forskjellig.`,
        number: resolved[j].number,
        slideId: resolved[j].plan.slideId,
        nodeId: resolved[j].plan.nodeId,
      })
    }
  }
  return issues
}

/**
 * The shared context reaching into one picture's motif.
 *
 * The context is what every picture has in common — light, palette, period,
 * how people are drawn. When it starts naming a subject that only one entry
 * shows, it stops being shared and starts overriding that entry, which is the
 * failure the template's own «FELLES BILDEKONTEKST» section warns about. The
 * test is deliberately blunt: a whole motif sentence repeated verbatim in the
 * context is the case worth catching, and anything subtler is a judgement an
 * agent has to make.
 */
function contextOverreachIssues(
  context: string,
  resolved: readonly ResolvedPlannedImage[],
): ImagePlanIssue[] {
  const haystack = normalize(context)
  const issues: ImagePlanIssue[] = []
  for (const image of resolved) {
    const subject = normalize(image.plan.subject)
    if (subject.length < 20 || !haystack.includes(subject)) continue
    issues.push({
      code: 'CONTEXT_OVERREACH',
      message: `Den felles bildekonteksten gjentar motivet til bilde ${image.number}. Konteksten skal si hvordan bildene ser ut, ikke hva ett av dem viser.`,
      number: image.number,
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
    })
  }
  return issues
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Words long enough to carry a motif. Short words are grammar, not subject. */
function significantWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / (a.size + b.size - shared)
}

/* ------------------------------------------------------------------ *
 * The prompt one picture is made from, and the brief kept behind it
 * ------------------------------------------------------------------ */

/**
 * The heading each field gets in the brief, and the order they are printed in.
 *
 * A `Record` over `PLANNED_IMAGE_FIELDS` rather than four lines in the template,
 * so the brief prints exactly the fields a plan entry has: a field added to the
 * entry is a type error here until it has a heading, and cannot be silently
 * left out of the message an author pastes.
 */
export const PLANNED_IMAGE_SECTION_HEADINGS: Record<PlannedImageField, string> = {
  subject: 'Motiv',
  composition: 'Komposisjon og utsnitt',
  requirements: 'Faglige krav',
  avoid: 'Unngå i akkurat dette bildet',
}

/**
 * The heading each field gets in the prompt for one picture.
 *
 * Derived from the brief's headings rather than written out again, with the one
 * difference stated where it is made: the brief calls the last section «Unngå i
 * akkurat dette bildet» because it stands beside the other pictures' sections,
 * and in a prompt that is the only picture in the world «akkurat dette» says
 * there are others. Everything a single prompt must not reveal is a difference
 * of exactly that kind, so it is spelled out here instead of being avoided by
 * hand at every call site.
 */
export const IMAGE_PROMPT_SECTION_HEADINGS: Record<PlannedImageField, string> = {
  ...PLANNED_IMAGE_SECTION_HEADINGS,
  avoid: 'Unngå',
}

/**
 * Everything one picture is generated from, and nothing else.
 *
 * This is the text a generation call carries, and the reason it is composed
 * here rather than assembled by whoever makes the call is the failure it
 * answers. The order for a picture was reachable only as part of a *plan*: the
 * shared brief listed every motif under «BILDE 3 AV 9», the structured list
 * held the other entries beside this one, and a host client that passed any of
 * that along was handing an image generator a multi-picture task. The ordinary
 * answer to a multi-picture task is one picture — a collage, a contact sheet, a
 * storyboard, a whole slide — and every individual rule against that had
 * already been written.
 *
 * So the isolation is structural. What comes out of here is a complete,
 * self-contained image order: the deck's shared visual context as plain style
 * instruction, this entry's own four fields, and the format measured off this
 * entry's own zone. What is deliberately absent is everything that would let a
 * reader infer a second picture — no count, no numbering, no plan-entry id, no
 * file name, no slide, no deck, no other motif. The bookkeeping those names
 * carry is real, but it belongs beside the prompt, not inside it: the agent
 * binds the returned file to `imagePlanItemId` itself.
 *
 * Every section is omitted when it says nothing, exactly as in the brief: a
 * heading over silence is an instruction to render nothing in particular.
 */
export function composeImageGenerationPrompt(
  image: ResolvedPlannedImage,
  imageContext: string,
): string {
  return [
    'Lag ett bilde.',
    ...section('Stil og kvalitet', imageContext),
    ...PLANNED_IMAGE_FIELDS.flatMap((field) =>
      section(IMAGE_PROMPT_SECTION_HEADINGS[field], image.plan[field]),
    ),
    ...section(
      'Format',
      `Aspect ratio ${image.aspectRatio} (${image.orientation}). Følg dette forholdet så nøyaktig som bildegeneratoren tillater, og gjør ikke et stående eller nær kvadratisk bilde liggende fordi motivet også kunne vært fremstilt i landskapsformat.`,
    ),
    ...section(
      'Krav til bildefilen',
      'Ett motiv i ett bilde: ikke del flaten i paneler, ikke sett varianter av motivet ved siden av hverandre, og ikke legg ramme rundt bildet. Ingen tekst, etiketter eller infografikkelementer i bildet med mindre det er bedt om over.',
    ),
  ].join('\n')
}

/** What the brief says where the author has written nothing. */
const MISSING_CONTEXT_TEXT =
  '(Ingen felles bildekontekst er skrevet for dette dekket ennå.)'

/**
 * The deck's pictures as one message a *person* can read, and nothing an agent
 * is asked to produce in a conversation.
 *
 * Internal by design, and that is the change this carries. The brief was once
 * the normal first step of generation — printed in the chat, then executed —
 * and printing it is precisely what made the task a multi-picture task: a
 * reader that has seen «lag nøyaktig 9 separate bilder» and nine numbered
 * motifs has been handed a set to compose, and composing a set is how a collage
 * gets made. One picture is now generated from
 * `composeImageGenerationPrompt`, which can see one entry.
 *
 * What is left for this is the work a single prompt cannot do: the editor's own
 * brief dialog, where an author copies the whole order out by hand, and
 * documentation and debugging, where the question is what Slaids ordered rather
 * than what one generator was told. See `ImageGenerationContract.briefRole` —
 * it is never a generation prompt, and never a step in the normal flow.
 *
 * This template is the canonical one — the documentation shows it, it is not a
 * second copy of it — and every number in it is derived: the count is the
 * length of the list, the numbering is the list's own order, and each aspect
 * ratio is measured off the zone the picture will fill. The rules at the top
 * are there because the failure they answer is the ordinary behaviour of an
 * image generator handed a numbered list: one wide image containing all the
 * motifs side by side.
 *
 * `null` when the deck plans no pictures. A brief for nothing is a message with
 * «lag nøyaktig 0 bilder» at the top of it.
 */
export function composeImageBrief(presentation: Presentation): string | null {
  const images = resolveImagePlan(presentation)
  if (images.length === 0) return null
  const count = images.length
  const context = (presentation.imageContext ?? '').trim() || MISSING_CONTEXT_TEXT

  /*
   * Only the sections that say something.
   *
   * A heading over «(ikke beskrevet)» is worse than no heading: it is an
   * instruction to an image generator to render nothing in particular, and it
   * reads to the author as a defect in the brief rather than as a gap in the
   * plan. Nothing required can be absent: `REQUIRED_PLANNED_IMAGE_FIELDS` is
   * refused blank by the command that writes a plan and by the schema that
   * stores one, so what this can omit is only ever a field that was optional.
   */
  const sections = images.map((image) =>
    [
      `BILDE ${image.number} AV ${count}`,
      /* The id and the file name are printed per picture, not only handed over
         in the structured half, because the brief is what an agent and a person
         actually read while the pictures are being made — and «which entry is
         this file for?» is the question the whole flow turns on. */
      `Bildeplan-ID: ${image.id}`,
      `Filnavn: ${image.fileNameStem}.<filendelse>`,
      `Skal brukes på slide: ${image.slideLabel}`,
      `Aspect ratio: ${image.aspectRatio} (${image.orientation})`,
      ...PLANNED_IMAGE_FIELDS.flatMap((field) =>
        section(PLANNED_IMAGE_SECTION_HEADINGS[field], image.plan[field]),
      ),
    ].join('\n'),
  )

  return [
    `Lag nøyaktig ${count} separate bilder til én presentasjon.`,
    '',
    'VIKTIGE REGLER FOR LEVERANSEN',
    'Hvert nummer nedenfor er én selvstendig bildefil.',
    'Ikke kombiner flere nummer i samme bilde.',
    'Ikke lag collage, kontaktark, storyboard, diptyk, split-screen,',
    'før/etter-paneler eller ett bredt bilde som viser flere av motivene samtidig,',
    'med mindre dette uttrykkelig står i beskrivelsen av akkurat det bildet.',
    `Bilde 1 skal bare vise motivet til bilde 1, bilde 2 bare motivet til bilde 2 osv.`,
    '',
    'Aspect ratio for hvert bilde er spesifisert eksplisitt.',
    'Følg dette forholdet så nøyaktig som bildegeneratoren tillater.',
    'Ikke gjør et stående eller nær-kvadratisk bilde liggende bare fordi motivet',
    'også kunne vært fremstilt i landskapsformat.',
    '',
    'Ingen tekst, etiketter, rammer eller infografikkelementer i bildene',
    'med mindre dette eksplisitt er bedt om for det aktuelle bildet.',
    '',
    'ETT BILDE OM GANGEN, OG REKKEFØLGEN ER IKKE IDENTITET',
    'Generer bildene enkeltvis, ett kall per nummer nedenfor.',
    'Rekkefølgen bildene blir ferdige i, og rekkefølgen de vises i,',
    'sier ingenting om hvilket nummer de hører til.',
    'Bruk aldri «det første bildet som kom tilbake» som bilde 1.',
    'Hvert bilde hører til den oppføringen det ble generert fra – identifisert',
    'av «Bildeplan-ID» – og filen skal ha filnavnet den oppføringen oppgir,',
    'uansett når i samtalen bildet ble laget.',
    '',
    'FELLES BILDEKONTEKST',
    context,
    '',
    sections.join('\n\n'),
    '',
    'FØR GENERERING',
    `Kontroller at det er nøyaktig ${count} separate bilder i listen,`,
    'at hvert bilde har ett eksplisitt aspect ratio,',
    'at hvert nummer beskriver ett entydig motiv,',
    'og at motivene ikke utilsiktet er slått sammen eller gjort til varianter',
    'av det samme bildet.',
    '',
    `Generer deretter alle ${count} bildene enkeltvis, ett kall per oppføring.`,
    '',
    'ETTER GENERERING',
    'Kontroller for hver ferdige fil at den hører til den oppføringen den ble',
    'generert fra: samme Bildeplan-ID, samme nummer og filnavnet oppføringen',
    'oppgir. Stemmer ikke koblingen, skal bildene ikke leveres videre.',
    'Kan du lese bytene til de ferdige filene, regn ut SHA-256 av hver fil',
    'i det den kommer tilbake, og lever avtrykkene sammen med bildene: et',
    'filnavn overlever at innholdet byttes om, et avtrykk gjør det ikke.',
    'Et avtrykk sier hvilken fil som hører til hvilken bildeplass, ikke hva',
    'bildet viser – se gjennom bildene selv i tillegg.',
  ].join('\n')
}

function section(heading: string, value: string): string[] {
  const text = value.trim()
  return text === '' ? [] : ['', `${heading}:`, text]
}

/* ------------------------------------------------------------------ *
 * The same plan, stated as work rather than as a message
 * ------------------------------------------------------------------ */

/**
 * What a generator has to deliver, counted rather than described.
 *
 * The brief is one message for a person to read, paste and keep. This is the
 * same plan stated as work: how one picture is ordered, how many files make a
 * delivery, what they are called, and what has to be true before they are
 * handed back. Both are derived from the same resolved plan in the same module,
 * so they cannot disagree about the count — which is the entire reason this is
 * generated here instead of being counted again by whoever executes the plan.
 *
 * It exists because a numbered list inside one long message has an ordinary
 * failure mode, and it was observed: an agent handed the whole brief to an
 * image generator as a single prompt and got one storyboard back — eight
 * motifs, one file, none of them placeable, and nothing in the flow that could
 * tell that apart from success.
 *
 * The count alone did not close that. A host client can satisfy «eight files»
 * and still have shown the generator a plan of eight — by printing the brief,
 * by summarising the list, by saying «now I will make the nine pictures» — and
 * a generator that has been told the task is a set is a generator with a set to
 * compose. So the count stays what a *finished* delivery is checked against,
 * while `perImageInstruction`, `perImageSteps` and `isolation` say what a
 * single call may contain and what the conversation around it may not.
 *
 * Nothing here repeats the plan: the entries, their numbers, their prompts and
 * their aspect ratios are the resolved plan itself, and a caller executing this
 * contract reads them from there. What this adds is only what the entries
 * cannot say on their own — how one of them is carried out, and how many of
 * them make a finished delivery.
 */
export interface ImageGenerationContract {
  /**
   * How many separate image files the plan requires. Always one per entry.
   *
   * The number to check a finished set of files against, and the same number
   * `ImageDeposit.expectedCount` is opened with. A completion check, never
   * something to state in the conversation: see `isolation`.
   */
  expectedFileCount: number
  /** What one entry is, and what a call may carry. */
  rule: string
  /** Where the instruction for one file comes from, and where it does not. */
  perImageInstruction: string
  /**
   * The loop, one numbered step at a time.
   *
   * Stated as steps rather than as a paragraph because the failure it answers
   * is a *sequencing* failure: an agent that holds the whole plan, fires every
   * generation call, and then names the returned files in the order they
   * arrived has done every individual step correctly and still put most
   * pictures on the wrong slide. A numbered loop is the one form that makes
   * «bind the file before generating the next one» something an agent can be
   * seen to have skipped.
   */
  perImageSteps: readonly string[]
  /**
   * What must not reach the conversation around a generation call.
   *
   * The half of the fix that is not about the call itself. Every rule against
   * merged pictures was already written and had already been followed; what had
   * not been said is that an agent narrating its own plan — a printed brief, a
   * bullet list of motifs, «nå genererer jeg de ti bildene», «neste bilde» —
   * has told the generator the task is a set, whatever the individual prompts
   * then say. Stated as its own field because it governs what an agent *writes*
   * rather than what it sends.
   */
  isolation: string
  /** Why generation order can never stand in for a picture's identity. */
  orderIsNotIdentity: string
  /** What a finished file is called, so its number survives the trip back. */
  fileNamePattern: string
  /** The extensions a deposited file may carry. The deposit's own list, not a copy. */
  fileExtensions: readonly string[]
  /** What has to hold before the files are deposited. Each line is checkable. */
  beforeDeposit: readonly string[]
  /** That the composed brief is internal: never a prompt, never a step. */
  briefRole: string
}

/**
 * The deck's plan as a delivery contract, or `null` when it plans no pictures.
 *
 * `null` for the same reason `composeImageBrief` is: a contract for nothing is
 * a count of zero with five rules about it.
 */
export function composeImageGenerationContract(
  presentation: Presentation,
): ImageGenerationContract | null {
  const count = resolveImagePlan(presentation).length
  if (count === 0) return null
  return {
    expectedFileCount: count,
    rule: 'Hver oppføring i `images` er én selvstendig bildegenereringsoppgave: ett kall til bildegeneratoren, ett motiv, én aspect ratio, én bildefil. Kallet skal inneholde bare den ene oppføringens ferdige `prompt` – aldri to oppføringer i samme kall, aldri hele planen, og aldri `brief`. `expectedFileCount` er tallet den ferdige leveransen kontrolleres mot, ikke noe som skal sies i samtalen.',
    perImageInstruction: `Instruksen for ett bilde er oppføringens egen \`prompt\`. Slaids har alt satt den sammen av dekkets felles bildekontekst og bare denne oppføringens egne felter – ${PLANNED_IMAGE_FIELDS.map(
      (field) => IMAGE_PROMPT_SECTION_HEADINGS[field].toLowerCase(),
    ).join(
      ', ',
    )} – og oppføringens eget aspect ratio, målt fra den sonen bildet skal ligge i. Send den som den er. Ingen annen oppføring, ingen del av resten av planen, ingen slidetekst, ingen id, ingen opptelling og ingen innledning skal inn i kallet. \`imagePlanItemId\` og filnavnet er din egen bokføring ved siden av kallet, ikke noe bildegeneratoren skal se.`,
    perImageSteps: PER_IMAGE_STEPS,
    isolation: SINGLE_TASK_ISOLATION,
    orderIsNotIdentity: ORDER_IS_NOT_IDENTITY,
    fileNamePattern: '<nummer>.<filendelse>',
    fileExtensions: IMAGE_FILE_EXTENSION_LIST,
    beforeDeposit: deliveryChecks(count),
    briefRole:
      'Intern. `brief` er hele planen skrevet ut som én menneskelesbar tekst, og den finnes for Slaids sin egen bildebrief-dialog, for dokumentasjon, for feilsøking og for manuell kopiering når brukeren uttrykkelig ber om den. Den er ikke et steg i normalflyten, ikke en bildegenereringsprompt, og skal ikke skrives ut i samtalen: den viser alle bildene samtidig, og det er nettopp det én bildegenerering ikke skal se. Bruk `prompt` på den ene oppføringen i stedet.',
  }
}

/**
 * Why a single generation must not be narrated.
 *
 * The rules this sits beside all govern what a call *contains*, and they were
 * all being followed when the merged pictures came back: the prompts were
 * separate, the count was right, and the conversation around them had already
 * said «nå lager jeg de ni bildene» and printed the brief. A generator reading
 * that conversation has been handed a set no matter how the next prompt is
 * worded — so the discipline has to cover what the agent writes, not only what
 * it sends.
 *
 * Deliberately not another warning about collages. "Ikke lag kontaktark" is a
 * rule aimed at a reader who has already been told there are nine pictures;
 * this removes the telling.
 */
const SINGLE_TASK_ISOLATION =
  'Hver bildegenerering skal se ut som en fullstendig selvstendig oppgave – i kallet og i samtalen rundt det. Ikke skriv en innledning om hva som skal lages, en oppsummering av bildeplanen, en punktliste over bildene, en opptelling, «nå går jeg videre til neste bilde» eller noe annet som viser at det finnes mer enn denne ene bildeoppgaven. Ikke skriv ut `brief`. Trengs en kort statusmelding, skal den være nøytral og ikke røpe at flere bilder er planlagt. Dette er hovedgrepet mot sammenslåtte bilder: en generator som aldri får se at oppgaven er et sett, har ikke noe sett å slå sammen.'

/**
 * Why a picture's place in the queue says nothing about which picture it is.
 *
 * The sentence exists because the opposite assumption is the cheapest one
 * available, it is almost always right, and when it is wrong it is wrong
 * silently: a generator handed nine motifs answered in the order 1, 3, 9, 6, 5,
 * 8, 2, 4, 7, the files were named by arrival, and seven of nine pictures
 * landed on a slide they were never made for.
 */
const ORDER_IS_NOT_IDENTITY =
  'Rekkefølgen bildegeneratoren produserer, returnerer eller viser bildene i er ikke en identitetskilde. Et bilde er identifisert av `imagePlanItemId` til oppføringen det ble generert fra, aldri av hvilken plass det fikk i køen, i svaret eller i grensesnittet. «Det første bildet som kom tilbake» er derfor aldri bilde 1, og et bilde skal aldri nummereres etter når det ble ferdig.'

/**
 * The loop, one step at a time.
 *
 * Every step is an action with an observable result, and they are ordered so
 * that the binding is written down *before* the next generation call exists to
 * confuse it with. That ordering is the whole mechanism: an agent that only
 * collects files and names them afterwards has no record left of which prompt
 * produced which file, and no amount of care at the end can recover one.
 *
 * The steps also say what the call may carry, and that half is newer: the
 * instruction is the entry's own composed `prompt`, so there is nothing for the
 * executing agent to assemble and therefore nothing for it to assemble *from*
 * the rest of the plan. None of these lines counts pictures or refers to
 * another one — an entry is worked as the only entry there is.
 */
const PER_IMAGE_STEPS: readonly string[] = [
  'Velg oppføringen i `images` som ennå ikke har sin egen kontrollerte fil, i stigende `number`.',
  'Bruk oppføringens ferdige `prompt` som hele instruksen. Den inneholder alt bildet trenger: stil og kvalitet fra dekkets felles bildekontekst, motiv, komposisjon, krav, hva som skal unngås, og aspect ratio.',
  'Kall bildegeneratoren nøyaktig én gang, med bare denne teksten. Ikke legg ved id, nummer, filnavn, slide, andre oppføringer eller en innledning om oppgaven.',
  'Knytt filen som kommer tilbake til oppføringens `imagePlanItemId` med en gang, før noe annet gjøres.',
  'Regn ut SHA-256 av bytene som kom tilbake, nå og ikke senere: et avtrykk beregnet i ettertid fra en mappe med ferdige filer fester bare en forveksling som allerede har skjedd.',
  'Gi filen navnet oppføringen oppgir – `<number>.<filendelse>` – der `number` er oppføringens eget nummer, ikke et løpenummer for genereringen.',
  'Kontroller at koblingen er bevart: `imagePlanItemId`, `number`, `slideId`, `nodeId`, filnavn og avtrykk hører til samme oppføring.',
  'Gjenta det samme for den oppføringen som da står uten sin egen kontrollerte fil, til ingen står igjen – uten å kommentere i samtalen at du gjør det.',
]

/**
 * What separates a finished delivery from a plausible-looking one.
 *
 * Every line is a question about the files themselves rather than about the
 * prompt that produced them, because that is the only side a caller can
 * actually check: a generator that merged eight motifs into one picture has
 * still answered, and the answer still looks like a success.
 */
function deliveryChecks(count: number): readonly string[] {
  return [
    `Det finnes nøyaktig ${count} separate bildefiler – én per planlagt bilde.`,
    `Numrene 1‥${count} forekommer én gang hver: ingen hull, ingen duplikater.`,
    'Hver `imagePlanItemId` i planen er brukt nøyaktig én gang, og ingen fil bærer en id som ikke finnes i planen.',
    'Hver fil er knyttet til den oppføringen den ble generert fra: samme `imagePlanItemId`, og den oppføringens `number`, `slideId` og `nodeId`.',
    'Hver fil bærer avtrykket (SHA-256) av bytene bildegenereringen returnerte for sin egen oppføring. Mangler avtrykket, er koblingen uverifisert og må kontrolleres manuelt – den er ikke kontrollert.',
    'Et avtrykk som stemmer sier hvilken fil som hører til hvilken bildeplass, ikke hva bildet viser. Se gjennom bildene i tillegg.',
    'Filnavnet er oppføringens eget nummer, ikke bildets plass i genereringsrekkefølgen.',
    'Hver fil viser motivet til sitt eget nummer, og har det aspect ratio oppføringen oppgir.',
    'Ett collage-, storyboard-, kontaktark-, split-screen- eller infografikkbilde teller aldri som flere bilder, uansett hvor mange motiver det inneholder.',
    'Stemmer ikke antallet, er bildegenereringen ikke ferdig: generer de manglende bildene enkeltvis før deponering, i stedet for å gå videre.',
  ]
}

/* ------------------------------------------------------------------ *
 * Validation of the entries themselves
 * ------------------------------------------------------------------ */

/**
 * What is wrong with a proposed plan on its own terms, before the deck is
 * consulted: too many pictures, a field longer than the document may carry, or
 * two entries claiming the same zone.
 *
 * Separate from `checkImagePlan` because these are argument errors — the
 * command refuses them and nothing is written — while the checks are things an
 * agent reads back and fixes. `null` when the entries are acceptable.
 */
export function plannedImagesRefusal(entries: readonly PlannedImage[]): string | null {
  if (entries.length > MAX_PLANNED_IMAGES) {
    return `En presentasjon kan ikke planlegge flere enn ${MAX_PLANNED_IMAGES} bilder.`
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = imageZoneKey(entry.slideId, entry.nodeId)
    if (seen.has(key)) return 'To bildeoppføringer peker på den samme sonen.'
    seen.add(key)
    /* Derived, not restated: which fields are required is
       `REQUIRED_PLANNED_IMAGE_FIELDS`, and the same list is what the agent's
       input schema and the persisted document's schema ask. A field added to
       or removed from it changes all three at once. */
    for (const field of REQUIRED_PLANNED_IMAGE_FIELDS) {
      if (!plannedImageFieldIsBlank(entry[field])) continue
      return `En bildeoppføring må ha ${PLANNED_IMAGE_FIELD_LABELS[field]}. Feltet «${field}» er tomt.`
    }
    for (const name of PLANNED_IMAGE_FIELDS) {
      if (entry[name].length > MAX_PLANNED_IMAGE_FIELD_CHARS) {
        return `Hvert felt i en bildeoppføring kan være inntil ${MAX_PLANNED_IMAGE_FIELD_CHARS} tegn.`
      }
    }
  }
  return null
}
