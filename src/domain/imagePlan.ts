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
 * The two texts are not two views of the same thing, and the difference is
 * which errand they are for:
 *
 *  - `composeImageBrief` is **the deliverable**: the deck's whole series as one
 *    order, for one conversation whose only job from that point is making N
 *    pictures. It counts the files in its first line, numbers them section by
 *    section, and asks for them as separate files in its last. That is the
 *    distinction the whole flow turns on — one image task producing N files,
 *    never N tasks with other work between them.
 *  - `composeImageGenerationPrompt` is **the repair**: one picture ordered
 *    again on its own, when picture 5 came back wrong or never came back. It
 *    can see one entry, so it carries no count, no numbering, no file name and
 *    no other motif — a text that can be pasted into an empty conversation and
 *    produce exactly that picture.
 *
 * Three things make the brief worth generating rather than writing:
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
 *    here and another way in an order.
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
 * be one more thing to keep in step. The number the brief and the deposit use
 * is deck order, derived in one pass — see `resolveImagePlan`.
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
 * The file a planned picture comes back as
 * ------------------------------------------------------------------ */

/**
 * The name one planned picture's file may carry, without its extension.
 *
 * The entry's own number, and nothing else. It is an *offer* rather than a
 * requirement: a person who names the files `1`‥`N` has said the order in the
 * one place that survives being carried between two programs, and the deposit
 * reads it. Files that come back called something else are placed by the order
 * the person puts them in instead — see `domain/imageDeposit.ts`.
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
 *
 * Refused is not rejected. A name this does not recognise is an ordinary file
 * name, and the deposit simply asks the person for the order instead of reading
 * it — the one thing it must never do is *guess* that `1-final.png` meant one.
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
  /** A text describes its picture by its place among the others. */
  | 'CROSS_IMAGE_REFERENCE'

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

/**
 * Phrases that place a picture among others.
 *
 * The plan's texts are copied verbatim into the prompt for one picture — that
 * is what makes the prompt the entry's own order rather than a paraphrase of it
 * — and it is also the one way the set can still reach a generator after
 * everything else about the flow was made one picture at a time. «Samme utsnitt
 * som forrige bilde», «alle bildene skal ha samme stil», «bilde 2 av 8»: each
 * of those is a complete instruction to compose a set, and no rule about what
 * an agent may *write in the conversation* touches them, because they travel
 * inside the order itself.
 *
 * So they are refused rather than warned about. Every pattern names a
 * *reference*: a number out of a total, another picture, the series, the set.
 * What is deliberately not here is the bare plural — «ingen tekst i bildene» is
 * how a person writes a style note, it names no other picture, and flagging it
 * would make the check something authors route around instead of read.
 *
 * Norwegian and English both, because a motif gets written in either.
 */
const CROSS_IMAGE_REFERENCES: readonly RegExp[] = [
  /\bbilde(?:t|ne|r)?\s*(?:nr\.?\s*)?\d+\s*(?:av|of)\s*\d+\b/gi,
  /\b(?:alle|begge|andre|øvrige|resten\s+av)\s+(?:de\s+)?(?:bilder|bildene|bilda)\b/gi,
  /\bde\s+(?:andre|øvrige)\s+(?:bilder|bildene|bilda)\b/gi,
  /\b(?:forrige|neste|første|siste|øvrige)\s+bilde(?:t|ne)?\b/gi,
  /\bsom\s+(?:i\s+)?bilde\s*\d+\b/gi,
  /\b(?:denne|samme)\s+(?:bilde)?serien\b/gi,
  /\bbildeserien?\b/gi,
  /\bbildesettet\b/gi,
  /\b(?:i|til)\s+dette\s+settet\b/gi,
  /\bimage\s*\d+\s*of\s*\d+\b/gi,
  /\ball\s+(?:the\s+)?images\b/gi,
  /\b(?:other|previous|next|remaining)\s+images?\b/gi,
  /\bthis\s+series\b/gi,
]

/**
 * Every phrase in a text that refers to another picture, once each.
 *
 * Exported because two layers ask it of two different things and must not
 * disagree: `checkImagePlan` asks it of the fields an author wrote, so the
 * finding names what to rewrite, and the generation flow asks it of the
 * *composed prompt*, so a leak cannot be handed to a generator even if it
 * arrived some way the field check did not see. One list of patterns, two
 * questions.
 */
export function crossImageReferences(text: string): string[] {
  const found = new Set<string>()
  for (const pattern of CROSS_IMAGE_REFERENCES) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) found.add(normalize(match[0]))
  }
  return [...found]
}

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
    issues.push(...crossReferenceIssues(image))
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
    const referenced = crossImageReferences(context)
    if (referenced.length > 0 && resolved.length > 0) {
      issues.push({
        code: 'CROSS_IMAGE_REFERENCE',
        message: `Den felles bildekonteksten viser til de andre bildene: ${quoted(
          referenced,
        )}. Konteksten går ordrett inn i prompten for hvert enkelt bilde, så en slik formulering forteller bildegeneratoren at oppgaven er flere bilder – og da lager den ett sammenslått bilde. Skriv den som ren stil: hvordan bildet skal se ut, uten å nevne antall, serie eller de andre bildene.`,
      })
    }
  }
  return issues
}

/**
 * One picture's own texts, read for references to the others.
 *
 * Reported per entry rather than per field so a rewrite is one edit: the author
 * gets the phrases, and the fields they sit in are the four the entry has.
 */
function crossReferenceIssues(image: ResolvedPlannedImage): ImagePlanIssue[] {
  const referenced = crossImageReferences(
    PLANNED_IMAGE_FIELDS.map((field) => image.plan[field]).join('\n'),
  )
  if (referenced.length === 0) return []
  return [
    {
      code: 'CROSS_IMAGE_REFERENCE',
      message: `Bilde ${image.number} beskriver seg selv i forhold til de andre bildene: ${quoted(
        referenced,
      )}. Feltene går ordrett inn i prompten for dette ene bildet, som ikke skal vite at det finnes andre – en slik formulering er nettopp det som gjør at bildegeneratoren lager collage eller kontaktark. Skriv motivet, komposisjonen og kravene slik at de står alene.`,
      number: image.number,
      slideId: image.plan.slideId,
      nodeId: image.plan.nodeId,
    },
  ]
}

function quoted(phrases: readonly string[]): string {
  return phrases.map((phrase) => `«${phrase}»`).join(', ')
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
 * Everything one picture is ordered from, and nothing else.
 *
 * The brief is the deck's whole series and the normal way pictures get made.
 * This is the repair: one picture, ordered again on its own, when picture 5
 * came back wrong or was never made at all. It is what the editor's per-picture
 * «Kopier prompt» puts on the clipboard, and it is composed here rather than by
 * whoever copies it so the two texts cannot describe the same picture
 * differently.
 *
 * What comes out is a complete, self-contained image order: the deck's shared
 * visual context as plain style instruction, this entry's own four fields, and
 * the format measured off this entry's own zone. What is deliberately absent is
 * everything that would let a reader infer a second picture — no count, no
 * numbering, no file name, no slide, no deck, no other motif. A single order
 * pasted into an empty conversation is one picture, and a reader shown nine
 * numbered motifs has been handed a set to compose.
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
 * The deck's pictures as one message, and the raster flow's actual deliverable.
 *
 * This is where the picture work ends on Slaids' side: the deck is finished,
 * the plan is complete, and what a person is handed is *one* text they paste
 * into one conversation whose whole job from that point is making pictures.
 * The conversation that made the deck does not make the pictures, and it does
 * not go back and forth between the two — that was tried, at some length, and a
 * host client's image tool turned out not to survive the alternation.
 *
 * So the distinction the whole text is built around is not «one picture at a
 * time» but **one task, N files**:
 *
 *  - one image-generation task, producing N separate image files — wanted;
 *  - N image-generation tasks with other work in between — not wanted.
 *
 * Which makes the opening line the load-bearing one: «lag nøyaktig N separate
 * bilder» states the count, the numbering repeats it per section, and the
 * closing line asks for it again as files. The rules under it answer the
 * ordinary behaviour of an image generator handed a numbered list — one wide
 * picture with every motif in it — and they are repeated per picture as «bilde
 * 1 viser bare motiv 1».
 *
 * Everything in here is derived: the count is the length of the list, the
 * numbering is the list's own order, and each aspect ratio is measured off the
 * zone the picture will fill. Nothing in here is Slaids' own bookkeeping.
 * **A plan id, a zone address, a file name, a slide title or an instruction to
 * come back to Slaids between the pictures says nothing about what to draw**,
 * and every one of them tells the reader the task is administration rather than
 * N pictures. The deposit asks the person for the order when it needs it; it
 * never needs the brief to have asked for it.
 *
 * `null` when the deck plans no pictures. A brief for nothing is a message with
 * «lag nøyaktig 0 bilder» at the top of it.
 */
export function composeImageBrief(presentation: Presentation): string | null {
  const images = resolveImagePlan(presentation)
  if (images.length === 0) return null
  const count = images.length
  const context = (presentation.imageContext ?? '').trim() || MISSING_CONTEXT_TEXT
  const single = count === 1

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
      `Aspect ratio: ${image.aspectRatio} (${image.orientation})`,
      ...PLANNED_IMAGE_FIELDS.flatMap((field) =>
        section(PLANNED_IMAGE_SECTION_HEADINGS[field], image.plan[field]),
      ),
    ].join('\n'),
  )

  return [
    single
      ? 'Lag nøyaktig 1 bilde til én presentasjon.'
      : `Lag nøyaktig ${count} separate bilder til én presentasjon.`,
    '',
    'VIKTIGE REGLER FOR LEVERANSEN',
    'Hvert nummer nedenfor er én selvstendig bildefil.',
    single
      ? 'Oppgaven er ett bilde, og leveransen er én bildefil.'
      : `${count} bilder betyr ${count} separate bildefiler.`,
    ...(single
      ? []
      : [
          'Ikke kombiner flere nummer i samme bilde.',
          'Ikke lag collage, kontaktark, storyboard, diptyk, split-screen,',
          'før/etter-paneler eller ett bredt bilde som viser flere av motivene samtidig,',
          'med mindre dette uttrykkelig står i beskrivelsen av akkurat det bildet.',
          'Bilde 1 skal bare vise motivet til bilde 1, bilde 2 bare motivet til bilde 2 osv.',
        ]),
    '',
    'Aspect ratio for hvert bilde er spesifisert eksplisitt.',
    'Følg dette forholdet så nøyaktig som bildegeneratoren tillater.',
    'Ikke gjør et stående eller nær-kvadratisk bilde liggende bare fordi motivet',
    'også kunne vært fremstilt i landskapsformat.',
    '',
    'Ingen tekst, etiketter, rammer eller infografikkelementer i bildene',
    'med mindre dette eksplisitt er bedt om for det aktuelle bildet.',
    '',
    'FELLES BILDEKONTEKST',
    context,
    '',
    sections.join('\n\n'),
    '',
    'FØR GENERERING',
    single
      ? 'Kontroller at oppgaven er ett entydig motiv med ett eksplisitt aspect ratio.'
      : [
          `Kontroller at det er nøyaktig ${count} separate bilder i listen,`,
          'at hvert bilde har ett eksplisitt aspect ratio,',
          'at hvert nummer beskriver ett entydig motiv,',
          'og at motivene ikke utilsiktet er slått sammen eller gjort til varianter',
          'av det samme bildet.',
        ].join('\n'),
    '',
    single
      ? 'Generer deretter bildet som én separat bildefil.'
      : `Generer deretter alle ${count} bildene i denne ene oppgaven, som ${count} separate bildefiler – én fil per nummer, aldri ett bilde som inneholder flere av motivene.`,
  ].join('\n')
}

function section(heading: string, value: string): string[] {
  const text = value.trim()
  return text === '' ? [] : ['', `${heading}:`, text]
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
