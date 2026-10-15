/**
 * Interactive slides.
 *
 * An interactive slide is a slide, so it is moved, duplicated and deleted by
 * the operations that do that to any other slide, and it is listed and
 * inspected by `get_presentation` and `inspect_slide` like the rest. What is
 * here is the two things only this kind has to say: the file it is made from,
 * and the name its cover shows.
 *
 * Both are thin wrappers over the identically named domain commands, so an
 * agent's file meets exactly the rules a person's does — one `.html` name,
 * text with at least one element in it, within the per-slide limit measured
 * in bytes of UTF-8, and within the deck-wide budget — and a refusal writes
 * nothing. `expectedRevision` comes from the same `mutatePresentation` every
 * other write goes through.
 *
 * ## The file arrives one of two ways, and the difference is the transport
 *
 * `html` is the file as a JSON string: convenient, and what an MCP tool call
 * can carry. But JSON *escapes* what it carries — a quote, a backslash and a
 * newline each become two bytes, a control character six — so a file at the
 * per-slide limit can be half again as large on the wire, and the transport
 * refuses a body over its own limit before any of this code sees it. That
 * limit is the platform's as much as Slaids' (see `server/agent/config.ts`),
 * so raising it is not a way to make the promise true.
 *
 * `content` is the file as a file, through the same tagged union `upload_asset`
 * takes: base64 or text over JSON, and raw bytes over REST, where the body *is*
 * the file and the fields ride in the query string. Nothing is escaped, so a
 * file at the limit needs a body at the limit, and the limit Slaids announces
 * is one an agent can actually reach. The bytes are decoded by the same door a
 * person's upload goes through — strict UTF-8, byte order mark skipped, UTF-16
 * refused by name — so the two ways in agree about what a file *is*.
 *
 * Exactly one of the two, never both: a call that carried a file twice would
 * have said two different things about what to store, and picking one is a
 * guess.
 *
 * The source goes *in* here and never comes back out: a listing says the
 * file's name and size, and nothing else. Slaids never runs the file on an
 * agent's behalf either — `render_slide_preview` draws the cover, which is
 * what everything static draws — so an agent that stored an app has stored
 * data, exactly as a person who uploaded one has.
 */

import { z } from 'zod'
import { addInteractiveSlide, setInteractiveSlideHtml, setInteractiveSlideName } from '../../domain/commands'
import {
  CURRENT_INTERACTIVE_STYLE_CONTRACT,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_PILL_COLOR,
  INTERACTIVE_STYLE_CONTRACTS,
  MAX_INTERACTIVE_HTML_BYTES,
  MAX_INTERACTIVE_HTML_TOTAL_BYTES,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type InteractiveStyleContract,
} from '../../domain/constants'
import {
  INTERACTIVE_DOCS_PATH,
  INTERACTIVE_LAYOUT_RULES,
  INTERACTIVE_RESTRICTIONS,
  INTERACTIVE_STARTER_SKELETON,
  interactiveThemeTokens,
} from '../../domain/interactiveStyle'
import {
  INTERACTIVE_FILE_EXTENSION,
  INTERACTIVE_NAME_MAX_LENGTH,
  acceptInteractiveFile,
  utf8ByteLength,
} from '../../domain/interactive'
import { defaultTheme, findInteractiveSlide } from '../../domain/presentation'
import { err, ok, type Result } from '../../domain/result'
import {
  FILE_CONTENT_SHAPE,
  fileContentSchema,
  readFileContent,
  transportFileContentSchema,
  type AgentFileContent,
} from '../binary'
import {
  defineOperation,
  expectedRevisionSchema,
  presentationIdSchema,
  slideIdSchema,
  wholeNumberSchema,
} from '../operation'
import { applySteps, mutatePresentation } from '../presentation'
import { agentOk, type AgentResult } from '../types'
import { type InteractiveSlideSummary } from './deck'
import { addedSlideId, placement, type SlidePlacement } from './slides'

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTERACTIVE_NAME_MAX_LENGTH)
  .describe('Navnet forsiden viser.')

const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(INTERACTIVE_NAME_MAX_LENGTH)
  .describe(`Filnavnet, som må slutte på ${INTERACTIVE_FILE_EXTENSION}. Vises som tekst.`)

const FILE_DESCRIPTION =
  `Hele HTML-filen, med all CSS og JavaScript innebygget. Maks ${MAX_INTERACTIVE_HTML_BYTES} byte UTF-8. ` +
  'Eksterne skript, stilark, fonter, bilder og nettverkskall er ikke tilgjengelige for appen.'

const htmlSchema = z
  .string()
  .min(1)
  .refine((html) => utf8ByteLength(html) <= MAX_INTERACTIVE_HTML_BYTES, {
    message: `HTML-kilden er større enn grensen på ${MAX_INTERACTIVE_HTML_BYTES} byte`,
  })
  .describe(
    `${FILE_DESCRIPTION} Som JSON-streng, så innholdet escapes på veien: en fil nær grensen kan bli større enn forespørselsgrensen, og da sendes den som «content» i stedet.`,
  )

const CONTENT_DESCRIPTION =
  `${FILE_DESCRIPTION} Som fil i stedet for som JSON-streng: base64 eller tekst over JSON, ` +
  'og rå bytes over REST, der kroppen er filen og feltene ligger i query-strengen. ' +
  `Ingenting escapes, så dette er veien som faktisk bærer en fil på grensen. ${FILE_CONTENT_SHAPE}`

const contentSchema: z.ZodType<AgentFileContent> = fileContentSchema.describe(
  `${CONTENT_DESCRIPTION} In-process kan en kaller også sende bytes eller en Blob.`,
)

/**
 * The published half: what a caller on the other side of a wire can send.
 *
 * Typed as the wider union it is a subset of, so both schemas can build the
 * same input shape below and the operation still infers one input type.
 */
const transportContentSchema: z.ZodType<AgentFileContent> =
  transportFileContentSchema.describe(CONTENT_DESCRIPTION)

/** «Send filen én gang», said once for both operations. */
const ONE_SOURCE = 'Send filen enten som html eller som content, aldri som begge.'

function oneSource(input: { html?: unknown; content?: unknown }): boolean {
  return !(input.html !== undefined && input.content !== undefined)
}

/**
 * The file, whichever way it arrived.
 *
 * `html` is already text and goes to the command unchanged — it is the command
 * that decides whether it may be stored. `content` is a file, so it is decoded
 * exactly as the editor's own picker decodes one: strict UTF-8, a byte order
 * mark skipped, a UTF-16 file refused by name rather than read as nonsense.
 */
async function resolveSource(input: {
  fileName: string
  html?: string
  content?: AgentFileContent
}): Promise<Result<{ fileName: string; html: string }>> {
  if (input.html !== undefined) return ok({ fileName: input.fileName, html: input.html })
  if (!input.content) {
    return err('INVALID_ARGUMENT', 'Filen mangler: oppgi enten html eller content.')
  }
  const bytes = await readFileContent(input.content)
  if (!bytes.ok) return bytes
  const accepted = acceptInteractiveFile({ fileName: input.fileName, bytes: bytes.value })
  if (!accepted.ok) return accepted
  return ok({ fileName: accepted.value.fileName, html: accepted.value.html })
}

/** What an agent gets back after writing a slide: where it is, and what it holds. */
export interface InteractiveSlideView extends SlidePlacement, Omit<InteractiveSlideSummary, 'index'> {}

/* ------------------------------------------------------------------ *
 * add_interactive_slide
 * ------------------------------------------------------------------ */

/**
 * One shape, two content schemas.
 *
 * The published contract may only mention what a JSON caller can send; the
 * in-process function also takes bytes and a `Blob`. Everything else about the
 * two is the same by construction rather than by two lists kept in step.
 */
function addInteractiveInput(content: z.ZodType<AgentFileContent>) {
  return z
    .strictObject({
      presentationId: presentationIdSchema,
      expectedRevision: expectedRevisionSchema,
      index: wholeNumberSchema
        .refine((index) => index >= 0, { message: 'Posisjonen kan ikke være negativ.' })
        .optional()
        .describe(
          'Posisjonen den skal settes inn på. Utelatt legger den sist. Kan sendes som tall, eller som sifrene i query-strengen når filen er kroppen.',
        ),
      name: nameSchema
        .optional()
        .describe('Navnet forsiden viser. Utelatt bruker filnavnet uten filendelsen.'),
      fileName: fileNameSchema,
      html: htmlSchema.optional(),
      content: content.optional(),
    })
    .refine((input) => input.html !== undefined || input.content !== undefined, {
      message: 'Oppgi filen som html eller som content.',
    })
    .refine(oneSource, { message: ONE_SOURCE })
}

export const addInteractiveSlideOperation = defineOperation({
  name: 'add_interactive_slide',
  summary:
    'Legg til en miniapp: én selvstendig app i én HTML-fil. Publikum ser en forside med navnet og starter appen selv, isolert fra Slaids, uten nettverk. Kilden lagres som data og kjøres aldri av Slaids. Skriv filen mot miniapp-kontrakten – rot, høydekjede, én rulleflate og Slaids-variablene for avstand – som hentes som data før du skriver HTML.',
  mutates: true,
  scopes: ['presentations:write'],
  input: addInteractiveInput(contentSchema),
  transportInput: addInteractiveInput(transportContentSchema),
  async run(context, input): Promise<AgentResult<InteractiveSlideView>> {
    const source = await resolveSource(input)
    if (!source.ok) return source
    return mutatePresentation(context, input, (presentation) => {
      const added = addInteractiveSlide(presentation, {
        ...(input.index === undefined ? {} : { index: input.index }),
        ...(input.name === undefined ? {} : { name: input.name }),
        fileName: source.value.fileName,
        html: source.value.html,
      })
      if (!added.ok) return added
      const slideId = addedSlideId(presentation, added.value)
      const slide = slideId ? findInteractiveSlide(added.value, slideId) : null
      if (!slideId || !slide) {
        return err('SLIDE_NOT_FOUND', 'Den nye sliden kunne ikke identifiseres.')
      }
      return ok({ presentation: added.value, value: view(added.value, slide, slideId) })
    })
  },
})

/* ------------------------------------------------------------------ *
 * set_interactive_slide
 * ------------------------------------------------------------------ */

/** The same two-schema construction as `addInteractiveInput`, one shape. */
function setInteractiveInput(content: z.ZodType<AgentFileContent>) {
  return z
    .strictObject({
      presentationId: presentationIdSchema,
      expectedRevision: expectedRevisionSchema,
      slideId: slideIdSchema,
      name: nameSchema.optional().describe('Utelatt beholder navnet som står der.'),
      fileName: fileNameSchema
        .optional()
        .describe('Sendes sammen med html eller content når filen byttes.'),
      html: htmlSchema.optional().describe('Sendes sammen med fileName når filen byttes.'),
      content: content.optional().describe('Sendes sammen med fileName når filen byttes.'),
    })
    .refine(
      (input) =>
        (input.fileName === undefined) === (input.html === undefined && input.content === undefined),
      {
        message:
          'fileName hører sammen med filen: send begge for å bytte fil, eller ingen av dem.',
      },
    )
    .refine(oneSource, { message: ONE_SOURCE })
    .refine((input) => input.name !== undefined || input.fileName !== undefined, {
      message: 'Oppgi et nytt navn, en ny fil, eller begge.',
    })
}

export const setInteractiveSlideOperation = defineOperation({
  name: 'set_interactive_slide',
  summary:
    'Endre navnet på en miniapp og/eller bytt ut HTML-filen bak den. En fil som ikke kan brukes, avvises, og appen som ligger der beholdes uendret.',
  mutates: true,
  scopes: ['presentations:write'],
  input: setInteractiveInput(contentSchema),
  transportInput: setInteractiveInput(transportContentSchema),
  async run(context, input): Promise<AgentResult<InteractiveSlideView>> {
    // A rename alone carries no file, and then there is nothing to decode.
    const replacement =
      input.fileName === undefined
        ? null
        : await resolveSource({ ...input, fileName: input.fileName })
    if (replacement && !replacement.ok) return replacement
    const file = replacement?.ok ? replacement.value : null

    return mutatePresentation(context, input, (presentation) => {
      // Name and file in one document: a file refused after a rename had
      // been stored would be half a change.
      const applied = applySteps(presentation, [
        (current) =>
          input.name === undefined
            ? ok(current)
            : setInteractiveSlideName(current, input.slideId, input.name),
        (current) => (file ? setInteractiveSlideHtml(current, input.slideId, file) : ok(current)),
      ])
      if (!applied.ok) return applied
      const slide = findInteractiveSlide(applied.value, input.slideId)
      if (!slide) return err('SLIDE_NOT_FOUND', 'Fant ikke sliden.')
      return ok({ presentation: applied.value, value: view(applied.value, slide, input.slideId) })
    })
  },
})

function view(
  presentation: Parameters<typeof placement>[0],
  slide: NonNullable<ReturnType<typeof findInteractiveSlide>>,
  slideId: string,
): InteractiveSlideView {
  return {
    ...placement(presentation, slideId),
    kind: 'interactive',
    name: slide.name,
    fileName: slide.fileName,
    htmlByteSize: utf8ByteLength(slide.html),
    styleContract: slide.styleContract,
  }
}

/* ------------------------------------------------------------------ *
 * get_interactive_contract
 * ------------------------------------------------------------------ */

/** What an agent has to know before it writes a miniapp. */
export interface InteractiveContractView {
  /** The design contract a slide made now is written against. */
  styleContract: InteractiveStyleContract
  /** Every version this Slaids can still draw. */
  supportedStyleContracts: InteractiveStyleContract[]
  /** The frame is the slide, so the app's viewport is the design space. */
  canvas: { width: number; height: number }
  /** Bytes of UTF-8, per file and per deck. */
  limits: { htmlByteSize: number; deckHtmlByteSize: number; fileExtension: string }
  /**
   * The CSS custom properties Slaids sets on `:root` before the file is read.
   *
   * Names only. An app writes `var(--slaids-accent)`, never `#bfccd9` — that
   * is what makes it follow a recoloured section and a changed theme with
   * nothing stored rewritten.
   */
  variables: string[]
  /**
   * What the app's structure has to be, whatever it does.
   *
   * The variables above are the easy half: an app that names them is the right
   * colour immediately. The half that goes wrong is layout — an unbounded
   * height chain, several competing scroll boxes, a spacing scale invented per
   * element — and none of it shows in a first screenshot. So the rules are
   * handed over rather than left to be inferred, and an agent that never reads
   * the repository still has them.
   */
  layout: readonly string[]
  /** Those rules as the smallest file that obeys them, to start from. */
  starter: string
  /** What the sandbox refuses. Stated so an agent does not write it and wonder. */
  restrictions: readonly string[]
  /** The prose contract, for a reader rather than a parser. */
  documentation: string
}

export const getInteractiveContractOperation = defineOperation({
  name: 'get_interactive_contract',
  summary:
    'Hva en miniapp er og hvordan den skal skrives: designkontrakten Slaids injiserer, CSS-variablene appen skal bruke, de obligatoriske struktur-, rulle- og avstandsreglene, et minimalt startskall som følger dem, størrelsen appen tegnes i, grensene og hva sandkassen nekter. Hent den før du skriver HTML.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({}),
  run(_context, _input): Promise<AgentResult<InteractiveContractView>> {
    return Promise.resolve(
      agentOk({
        styleContract: CURRENT_INTERACTIVE_STYLE_CONTRACT,
        supportedStyleContracts: [...INTERACTIVE_STYLE_CONTRACTS],
        canvas: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
        limits: {
          htmlByteSize: MAX_INTERACTIVE_HTML_BYTES,
          deckHtmlByteSize: MAX_INTERACTIVE_HTML_TOTAL_BYTES,
          fileExtension: INTERACTIVE_FILE_EXTENSION,
        },
        // Read off the tokens themselves rather than listed here: a variable
        // that were listed could come to differ from the one that is set, and
        // an agent writing against a name Slaids does not set writes CSS that
        // silently does nothing.
        variables: Object.keys(
          interactiveThemeTokens({
            theme: defaultTheme(),
            colors: { accent: DEFAULT_PILL_COLOR, background: DEFAULT_BACKGROUND_COLOR },
          }),
        ),
        layout: INTERACTIVE_LAYOUT_RULES,
        starter: INTERACTIVE_STARTER_SKELETON,
        restrictions: INTERACTIVE_RESTRICTIONS,
        documentation: INTERACTIVE_DOCS_PATH,
      }),
    )
  },
})

export const interactiveOperations = [
  getInteractiveContractOperation,
  addInteractiveSlideOperation,
  setInteractiveSlideOperation,
]
