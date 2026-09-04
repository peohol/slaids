/**
 * What is inside a zone: text, the kind of card that holds it, and how it sits.
 *
 * `set_zone_text` is the operation the whole text format exists for. An agent
 * sends blocks (see `../text.ts`); Agent Core turns them into Slaids' stored
 * rich text and hands them to the same command the editor uses, so the same fit
 * gate applies — text that would be pushed out of sight is refused, and nothing
 * is written. The failure says which slide, which zone, how much did not fit and
 * how big the zone is, which is what makes the loop in §44 possible:
 *
 *     set_zone_text → CONTENT_DOES_NOT_FIT → shorter text → set_zone_text
 *
 * Writing into an empty zone creates the simplest thing that can hold text — a
 * transparent container with one field — so the common case is one call. An
 * agent that wants a card asks for one with `set_zone_card` first; the text
 * survives the conversion either way.
 *
 * `adjust_subfields` is the other half of that: `set_zone_card` decides what
 * kind of thing holds the text, and `adjust_subfields` decides how the fields
 * inside it divide the room — the same pair as `split_zone` and `adjust_split`
 * one level up.
 */

import { z } from 'zod'
import {
  setBodyLayout,
  setCardColor,
  setCardTitle,
  setContentKind,
  setImageCaption,
  setImageFocus,
  setSubfieldCount,
  setSubfieldDoc,
  setVerticalAlign,
  setZoneContent,
  unknownAssetIds,
} from '../../domain/commands'
import {
  bodyOf,
  captionPositionsFor,
  containerWithDoc,
  createContentOfKind,
  imagePanelOf,
} from '../../domain/content'
import { findLeaf, findNode } from '../../domain/layout'
import { emptyDoc, isDocEmpty } from '../../domain/richdoc'
import { findSlide } from '../../domain/presentation'
import { err, ok, type Result } from '../../domain/result'
import type { Axis, CardBody, LeafNode, Presentation, ZoneContent } from '../../domain/types'
import {
  defineOperation,
  expectedRevisionSchema,
  nodeIdSchema,
  presentationIdSchema,
  slideIdSchema,
  subfieldIdSchema,
} from '../operation'
import { applySteps, mutatePresentation, structuralOptions } from '../presentation'
import {
  alignSchema,
  blocksToDoc,
  citedIdsInBlocks,
  citedIdsInSpans,
  docToTitleAlign,
  imageAssetIdsInBlocks,
  textBlocksSchema,
  titleSpansSchema,
  titleSpansToDoc,
} from '../text'
import type { AgentResult } from '../types'
import { unknownReferenceIds } from './references'

/** The leaf an operation addresses, told apart from the ways it can be missing. */
function findZone(
  presentation: Presentation,
  slideId: string,
  nodeId: string,
): Result<LeafNode> {
  const slide = findSlide(presentation, slideId)
  if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
  const leaf = findLeaf(slide.root, nodeId)
  if (leaf) return ok(leaf)
  return findNode(slide.root, nodeId)
    ? err('NODE_NOT_LEAF', 'Sonen er delt opp og har ikke innhold direkte.')
    : err('NODE_NOT_FOUND', 'Fant ikke sonen.')
}

/**
 * Which text field a call means.
 *
 * A zone usually has exactly one, so leaving it out is the ordinary case; an
 * explicit id has to exist, because silently writing into the first field when
 * the caller named a different one is how text ends up in the wrong column.
 */
function resolveSubfield(body: CardBody, subfieldId: string | undefined): Result<string> {
  if (subfieldId === undefined) return ok(body.subfields[0].id)
  return body.subfields.some((field) => field.id === subfieldId)
    ? ok(subfieldId)
    : err('SUBFIELD_NOT_FOUND', 'Fant ikke tekstfeltet i denne sonen.', { subfieldId })
}

/** Text goes in fields. A zone showing a file has none. */
function textBodyOf(content: ZoneContent): Result<CardBody> {
  const body = bodyOf(content)
  if (body) return ok(body)
  return err('INVALID_CONTENT', 'Sonen viser en fil og har ingen tekstfelt. Bruk clear_zone først.')
}

/* ------------------------------------------------------------------ *
 * set_zone_text
 * ------------------------------------------------------------------ */

export const setZoneText = defineOperation({
  name: 'set_zone_text',
  summary:
    'Sett teksten i en sone. Er sonen tom, opprettes en beholder med teksten. Avvises hvis teksten ikke får plass.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    subfieldId: subfieldIdSchema
      .optional()
      .describe('Hvilket tekstfelt i sonen. Utelatt betyr det første, som er det vanlige.'),
    blocks: textBlocksSchema,
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; slideId: string; nodeId: string; subfieldId: string | null }>> {
    return mutatePresentation(context, input, (presentation) => {
      const unknown = unknownReferenceIds(presentation, citedIdsInBlocks(input.blocks))
      if (unknown.length > 0) {
        return err('REFERENCE_NOT_FOUND', 'Teksten siterer referanser som ikke finnes.', {
          referenceIds: unknown,
        })
      }

      /*
       * A picture in the text names a file, and it has to be a file *this*
       * presentation holds. Assets belong to one presentation, so the same
       * check is what refuses an id borrowed from another deck — there is no
       * separate rule for it, and there is no way for an agent to point at a
       * file it could not otherwise read.
       *
       * Checked here, before any command runs, for the same reason a citation
       * is: `mutatePresentation` saves nothing when this returns an error, so a
       * rejected call leaves the deck exactly as it was rather than storing a
       * zone that renders a hole. No `assets:write` is involved — nothing is
       * stored, removed or read from the file store; this is a document that
       * refers to a file, which is an ordinary edit.
       */
      const missingAssets = unknownAssetIds(presentation, imageAssetIdsInBlocks(input.blocks))
      if (missingAssets.length > 0) {
        return err('ASSET_NOT_FOUND', 'Teksten viser filer som ikke finnes i presentasjonen.', {
          assetIds: missingAssets,
        })
      }

      const zone = findZone(presentation, input.slideId, input.nodeId)
      if (!zone.ok) return zone
      // The proportions come from the stored files, so the picture is measured
      // and drawn at the shape the bitstream said it had.
      const doc = blocksToDoc(input.blocks, presentation.assets)

      if (!zone.value.content) {
        if (input.subfieldId !== undefined) {
          return err('SUBFIELD_NOT_FOUND', 'Sonen er tom og har ingen tekstfelt ennå.', {
            subfieldId: input.subfieldId,
          })
        }
        // The lightest thing that can hold text: a transparent container with
        // one field. Anything more opinionated is `set_zone_card`'s job.
        const placed = setZoneContent(presentation, {
          slideId: input.slideId,
          nodeId: input.nodeId,
          content: containerWithDoc(doc),
          ...structuralOptions(context),
        })
        if (!placed.ok) return placed
        return ok({
          presentation: placed.value.presentation,
          value: {
            presentationId: presentation.id,
            slideId: input.slideId,
            nodeId: input.nodeId,
            subfieldId: null,
          },
        })
      }

      const body = textBodyOf(zone.value.content)
      if (!body.ok) return body
      const subfieldId = resolveSubfield(body.value, input.subfieldId)
      if (!subfieldId.ok) return subfieldId

      const written = setSubfieldDoc(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        subfieldId: subfieldId.value,
        doc,
        ...structuralOptions(context),
      })
      if (!written.ok) return written
      return ok({
        presentation: written.value,
        value: {
          presentationId: presentation.id,
          slideId: input.slideId,
          nodeId: input.nodeId,
          subfieldId: subfieldId.value,
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_zone_card
 * ------------------------------------------------------------------ */

export const setZoneCard = defineOperation({
  name: 'set_zone_card',
  summary:
    'Velg hva slags innhold en sone har: gjennomsiktig beholder, kort uten tittel eller kort med tittel. Tekst som ligger der beholdes.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    kind: z
      .enum(['container', 'untitled-card', 'titled-card'])
      .describe('`container` er et gjennomsiktig kort; de to andre har bakgrunn.'),
    title: titleSpansSchema
      .optional()
      .describe('Korttittelen. Bare for titled-card.'),
    titleAlign: alignSchema
      .optional()
      .describe('Justering av korttittelen. Utelatt beholder den kortet allerede har.'),
    color: z
      .string()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      .nullable()
      .optional()
      .describe(
        'Bakgrunnsfarge på kortet, eller fargen på tittellinjen. Ikke for beholdere. ' +
          '`null` nullstiller et kort med tittel til forsidens pillefarge; et kort uten ' +
          'tittel har ingen arvet farge å nullstille til.',
      ),
    subfieldCount: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe('Hvor mange tekstfelt innholdet deles i. Felt som fjernes må være tomme.'),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; slideId: string; nodeId: string; kind: string; subfieldIds: string[] }>> {
    return mutatePresentation(context, input, (presentation) => {
      if ((input.title || input.titleAlign) && input.kind !== 'titled-card') {
        return err('INVALID_ARGUMENT', 'Bare et kort med tittel kan ha en korttittel.')
      }
      const unknown = input.title
        ? unknownReferenceIds(presentation, citedIdsInSpans(input.title))
        : []
      if (unknown.length > 0) {
        return err('REFERENCE_NOT_FOUND', 'Korttittelen siterer referanser som ikke finnes.', {
          referenceIds: unknown,
        })
      }

      const zone = findZone(presentation, input.slideId, input.nodeId)
      if (!zone.ok) return zone
      const target = { slideId: input.slideId, nodeId: input.nodeId, ...structuralOptions(context) }

      // A card that is already titled keeps its title's alignment when only the
      // words change; a card that is being created has none to keep.
      const existing = zone.value.content
      const align =
        input.titleAlign ??
        (existing?.kind === 'titled-card' ? docToTitleAlign(existing.title) : undefined)

      // Several domain commands, one save: the intermediate documents never
      // leave this function, so a failure in the last step leaves nothing behind
      // from the first.
      const applied = applySteps(presentation, [
        (current) =>
          existing
            ? setContentKind(current, { ...target, kind: input.kind })
            : mapOutcome(
                setZoneContent(current, { ...target, content: createContentOfKind(input.kind) }),
              ),
        (current) =>
          input.subfieldCount === undefined
            ? ok(current)
            : setSubfieldCount(current, { ...target, count: input.subfieldCount }),
        (current) =>
          input.title === undefined
            ? ok(current)
            : setCardTitle(current, { ...target, doc: titleSpansToDoc(input.title, align) }),
        (current) =>
          input.color === undefined
            ? ok(current)
            : setCardColor(current, { ...target, color: input.color }),
      ])
      if (!applied.ok) return applied

      const written = findZone(applied.value, input.slideId, input.nodeId)
      const body = written.ok && written.value.content ? bodyOf(written.value.content) : null
      return ok({
        presentation: applied.value,
        value: {
          presentationId: presentation.id,
          slideId: input.slideId,
          nodeId: input.nodeId,
          kind: input.kind,
          subfieldIds: body?.subfields.map((field) => field.id) ?? [],
        },
      })
    })
  },
})

/** A structural outcome as a plain presentation, for chaining. */
function mapOutcome(
  result: Result<{ presentation: Presentation }>,
): Result<Presentation> {
  return result.ok ? ok(result.value.presentation) : result
}

/* ------------------------------------------------------------------ *
 * adjust_subfields
 * ------------------------------------------------------------------ */

/** The subfield layout a call ended with, read back off the stored document. */
export interface SubfieldLayout {
  presentationId: string
  slideId: string
  nodeId: string
  axis: Axis
  weights: number[]
  /** In layout order, so the next `set_zone_text` knows which field is which. */
  subfieldIds: string[]
}

const subfieldAxisSchema = z
  .enum(['x', 'y'])
  .describe('`x` legger subfeltene side om side som kolonner, `y` over hverandre som rader.')

const subfieldWeightsSchema = z
  .array(z.number().positive().finite())
  .min(1)
  .max(6)
  .describe(
    'Ett forholdstall per subfelt, i rekkefølge. [1, 1] gir like store felt, [2, 1] gir det første dobbelt så mye plass som det andre. Antallet må matche antall subfelt kallet ender med.',
  )

export const adjustSubfields = defineOperation({
  name: 'adjust_subfields',
  summary:
    'Sett retning, forholdstall og antall subfelt inne i ett kort eller én beholder – to tekstkolonner i samme kort, eller en figur som får 2/3 og forklaringen 1/3. Alt måles samlet.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    axis: subfieldAxisSchema.optional().describe('Utelatt beholder retningen kortet har.'),
    weights: subfieldWeightsSchema
      .optional()
      .describe('Utelatt beholder forholdstallene kortet har.'),
    subfieldCount: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe('Nytt antall subfelt. Felt som forsvinner må være tomme.'),
  }),
  run(context, input): Promise<AgentResult<SubfieldLayout>> {
    return mutatePresentation(context, input, (presentation) => {
      // The three are optional so a call can change one of them, but a call that
      // changes none of them is a mistake, not a no-op worth storing.
      if (
        input.axis === undefined &&
        input.weights === undefined &&
        input.subfieldCount === undefined
      ) {
        return err('INVALID_ARGUMENT', 'Oppgi minst én av axis, weights og subfieldCount.')
      }

      // One domain command, one fit measurement, against the layout that was
      // asked for. Splitting this into "set the count", "set the axis", "set the
      // weights" would gate each half-finished layout on its own, and a card
      // whose two columns fit could be unreachable because its two rows do not.
      const updated = setBodyLayout(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        ...(input.axis === undefined ? {} : { axis: input.axis }),
        ...(input.weights === undefined ? {} : { weights: input.weights }),
        ...(input.subfieldCount === undefined ? {} : { subfieldCount: input.subfieldCount }),
        ...structuralOptions(context),
      })
      if (!updated.ok) return updated

      const written = findZone(updated.value, input.slideId, input.nodeId)
      const body = written.ok && written.value.content ? bodyOf(written.value.content) : null
      if (!body) return err('INVALID_CONTENT', 'Sonen har ingen subfelt.')
      return ok({
        presentation: updated.value,
        value: {
          presentationId: presentation.id,
          slideId: input.slideId,
          nodeId: input.nodeId,
          axis: body.axis,
          weights: [...body.weights],
          subfieldIds: body.subfields.map((field) => field.id),
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_vertical_alignment
 * ------------------------------------------------------------------ */

export const setVerticalAlignment = defineOperation({
  name: 'set_vertical_alignment',
  summary: 'Sett hvor innholdet ligger i høyden det har fått: øverst, midtstilt eller nederst.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    subfieldId: subfieldIdSchema
      .optional()
      .describe('Tekstfeltet som justeres. Utelatt betyr det første, eller filen hvis sonen viser en.'),
    align: z.enum(['top', 'middle', 'bottom']),
  }),
  run(context, input): Promise<AgentResult<{ presentationId: string; slideId: string; nodeId: string; subfieldId: string | null }>> {
    return mutatePresentation(context, input, (presentation) => {
      const zone = findZone(presentation, input.slideId, input.nodeId)
      if (!zone.ok) return zone
      if (!zone.value.content) return err('TARGET_EMPTY', 'Sonen har ikke innhold.')

      // `null` is the container's own alignment, which is what a zone showing a
      // file has instead of fields.
      const body = bodyOf(zone.value.content)
      // Every alignment names a field: a picture has no flow to align, and a
      // caption is centred by construction.
      if (!body) {
        return err('SUBFIELD_NOT_FOUND', 'Sonen viser et bilde og har ingen tekstfelt.', {
          subfieldId: input.subfieldId ?? null,
        })
      }
      const resolved = resolveSubfield(body, input.subfieldId)
      if (!resolved.ok) return resolved
      const subfieldId = resolved.value

      const aligned = setVerticalAlign(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        subfieldId,
        align: input.align,
        ...structuralOptions(context),
      })
      if (!aligned.ok) return aligned
      return ok({
        presentation: aligned.value,
        value: {
          presentationId: presentation.id,
          slideId: input.slideId,
          nodeId: input.nodeId,
          subfieldId,
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_image_focus
 * ------------------------------------------------------------------ */

/**
 * A picture in a zone always fills it and is cropped, so which part of the file
 * is on screen is a real editorial decision — and the only one an agent cannot
 * make by choosing a different file. Both coordinates run from 0 (the top or
 * left edge of the file) through 0.5 (centred, the default) to 1.
 */
const focusCoordinate = z.number().min(0).max(1)

export const setImageFocusOperation = defineOperation({
  name: 'set_image_focus',
  summary: 'Velg hvilken del av bildet som vises når det beskjæres av sonen.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    x: focusCoordinate.describe('0 = venstre kant av filen, 0.5 = midtstilt, 1 = høyre kant.'),
    y: focusCoordinate.describe('0 = toppen av filen, 0.5 = midtstilt, 1 = bunnen.'),
  }),
  run(context, input): Promise<AgentResult<ZoneImageResult>> {
    return mutatePresentation(context, input, (presentation) => {
      const moved = setImageFocus(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        focus: { x: input.x, y: input.y },
        ...structuralOptions(context),
      })
      if (!moved.ok) return moved
      return ok({ presentation: moved.value, value: zoneImageResult(presentation.id, input) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_image_caption
 * ------------------------------------------------------------------ */

export const setImageCaptionOperation = defineOperation({
  name: 'set_image_caption',
  summary:
    'Legg til, flytt, farg eller fjern bildeteksten over et bilde. Avvises hvis teksten ikke får plass.',
  mutates: true,
  scopes: ['presentations:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    slideId: slideIdSchema,
    nodeId: nodeIdSchema,
    position: z
      .enum(['top', 'middle', 'bottom'])
      .optional()
      .describe(
        'Hvor teksten henger i bildet. Et kort med tittel og bilde har allerede et panel øverst og tar bare `middle` og `bottom`.',
      ),
    spans: titleSpansSchema
      .optional()
      .describe('Selve teksten, som én linje som brytes. Utelatt beholder teksten som står der.'),
    color: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Bakgrunnsfargen som hex. `null` betyr dekkets standardfarge fra forsiden, som er utgangspunktet.',
      ),
    remove: z.boolean().optional().describe('Sett til true for å fjerne bildeteksten.'),
  }),
  run(context, input): Promise<AgentResult<ZoneImageResult>> {
    return mutatePresentation(context, input, (presentation) => {
      const zone = findZone(presentation, input.slideId, input.nodeId)
      if (!zone.ok) return zone
      const content = zone.value.content
      const panel = content ? imagePanelOf(content) : null
      if (!content || !panel) {
        return err('INVALID_CONTENT', 'Sonen viser ikke et bilde.')
      }
      if (!input.remove) {
        /*
         * A caption with nothing in it does not exist — see `ImageCaption`. The
         * editor may hold one for a moment, because the caret goes straight into
         * it and leaving it empty removes it again; an agent has no such moment,
         * so an empty one it left behind would simply be stored, and would then
         * steal the caret from whoever opens that slide next.
         *
         * Stated as the invariant rather than as "a new one needs text": what
         * the call *ends with* is what has to have text, so clearing an existing
         * caption with `spans: []` is refused for the same reason creating an
         * empty one is. `remove` is how a caller says the caption should go, and
         * empty text is not a second, quieter spelling of it.
         */
        const next = input.spans ? titleSpansToDoc(input.spans) : (panel.caption?.doc ?? emptyDoc())
        if (isDocEmpty(next)) {
          return err(
            'INVALID_ARGUMENT',
            'En bildetekst kan ikke være tom. Send `spans` med tekst, eller `remove: true`.',
          )
        }

        const cited = unknownReferenceIds(presentation, citedIdsInSpans(input.spans ?? []))
        if (cited.length > 0) {
          return err('REFERENCE_NOT_FOUND', 'Bildeteksten siterer referanser som ikke finnes.', {
            referenceIds: cited,
          })
        }
        // Said here as well as in the command, so the failure names what the
        // caller may ask for instead of only what it may not.
        const allowed = captionPositionsFor(content.kind)
        if (input.position && !allowed.includes(input.position)) {
          return err('INVALID_ARGUMENT', 'Bildeteksten kan ikke stå der på denne innholdstypen.', {
            allowed: [...allowed],
          })
        }
      }

      const changed = setImageCaption(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        ...(input.position ? { position: input.position } : {}),
        ...(input.spans ? { doc: titleSpansToDoc(input.spans) } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.remove ? { remove: true } : {}),
        ...structuralOptions(context),
      })
      if (!changed.ok) return changed
      return ok({ presentation: changed.value, value: zoneImageResult(presentation.id, input) })
    })
  },
})

/** Both picture operations answer with the zone they acted on, and nothing more. */
interface ZoneImageResult {
  presentationId: string
  slideId: string
  nodeId: string
}

function zoneImageResult(
  presentationId: string,
  input: { slideId: string; nodeId: string },
): ZoneImageResult {
  return { presentationId, slideId: input.slideId, nodeId: input.nodeId }
}

export const contentOperations = [
  setZoneText,
  setZoneCard,
  adjustSubfields,
  setVerticalAlignment,
  setImageFocusOperation,
  setImageCaptionOperation,
]
