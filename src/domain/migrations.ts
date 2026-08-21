/**
 * Schema migrations.
 *
 * Every persisted presentation carries a `schemaVersion`. Loading runs the
 * chain of migrations from the stored version up to `CURRENT_SCHEMA_VERSION`
 * before validation, so early test presentations never become unreadable.
 */

import { DEFAULT_BACKGROUND_COLOR } from './constants'
import { WHITE, normalizeHex } from './color'
import { err, ok, type Result } from './result'
import { CURRENT_SCHEMA_VERSION, validatePresentation } from './schema'
import { emptyDoc, mergeAdjacentCitations } from './richdoc'
import { newSubfieldId } from './ids'
import type { Presentation, RichDoc } from './types'
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts'
import {
  DEFAULT_FONT_SCALE,
  DEFAULT_SPACING,
  FONT_SCALE_RANGE,
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
 * Luft and skriftstørrelse are multipliers, so `1` is exactly what every
 * existing presentation already looks like.
 */
const migrate4to5: MigrationFn = (data) => {
  const theme = (data.theme ?? {}) as Raw
  return {
    ...data,
    schemaVersion: 5,
    theme: {
      ...theme,
      spacing: asNumber(theme.spacing, DEFAULT_SPACING),
      fontScale: asNumber(theme.fontScale, DEFAULT_FONT_SCALE),
    },
  }
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Keyed by the version the migration upgrades *from*. */
export const MIGRATIONS: Record<number, MigrationFn> = {
  0: migrate0to1,
  1: migrate1to2,
  2: migrate2to3,
  3: migrate3to4,
  4: migrate4to5,
}

/**
 * Repair the small set of defects that would otherwise make a whole
 * presentation unopenable.
 *
 * Deliberately narrow: only colour and font fields are coerced, because those
 * are single values that the schema rejects outright while the rest of the
 * document is perfectly readable. Structural corruption is *not* repaired — it
 * should surface as a validation error rather than be silently rewritten.
 */
export function repairPresentation(data: Raw): Raw {
  const theme = (data.theme ?? {}) as Raw
  const repairedTheme = {
    ...theme,
    backgroundColor:
      normalizeHex(asString(theme.backgroundColor, '')) ?? DEFAULT_BACKGROUND_COLOR,
    headingFontFamily: asString(theme.headingFontFamily, '').trim() || DEFAULT_HEADING_FONT,
    bodyFontFamily: asString(theme.bodyFontFamily, '').trim() || DEFAULT_BODY_FONT,
    spacing: clampScale(theme.spacing, SPACING_RANGE, DEFAULT_SPACING),
    fontScale: clampScale(theme.fontScale, FONT_SCALE_RANGE, DEFAULT_FONT_SCALE),
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

  return {
    ...(repairColors(data) as Raw),
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
