/**
 * Asset operations.
 *
 * The image policy in one place (see `IMPLEMENTATION_PLAN.md` §44): Slaids does
 * not generate pictures and does not call any image provider. An agent that
 * wants a raster picture in a deck brings one it already has — `upload_asset` —
 * and an agent that wants a drawing writes the vector markup for it —
 * `create_svg_asset`. Both end in the same place: a stored file with an
 * `assetId`, which `set_zone_asset` then puts in a zone.
 *
 * There is deliberately no `generate_image_asset`.
 *
 * `delete_asset` is the way back out, and it is the operation with the sharpest
 * rule on it: a file may only leave once the deck shows it nowhere, so cleaning
 * up can never be what breaks a slide.
 */

import { z } from 'zod'
import { removeAsset, setZoneContent, usedAssetIds } from '../../domain/commands'
import { createContainer } from '../../domain/content'
import { err, ok } from '../../domain/result'
import type { AssetRef } from '../../domain/types'
import { fileContentSchema, readFileContent, transportFileContentSchema } from '../binary'
import { deleteAssetFile, storeAsset, type StoredAssetResult } from '../assetStore'
import {
  assetIdSchema,
  assetNameSchema,
  defineOperation,
  dispositionSchema,
  expectedRevisionSchema,
  nodeIdSchema,
  presentationIdSchema,
  slideIdSchema,
} from '../operation'
import { loadPresentation, mutatePresentation, sandboxIdsAdded, structuralOptions } from '../presentation'
import { agentOk, fromDomainError, type AgentResult } from '../types'

/* ------------------------------------------------------------------ *
 * upload_asset
 * ------------------------------------------------------------------ */

const CONTENT_DESCRIPTION =
  'Selve filen. Base64 (eller en data-URL) for et JSON-transport; ren tekst for SVG.'

const uploadAssetInput = z.strictObject({
  presentationId: presentationIdSchema,
  expectedRevision: expectedRevisionSchema,
  name: assetNameSchema,
  content: fileContentSchema.describe(
    `${CONTENT_DESCRIPTION} In-process kan en kaller også sende bytes eller en Blob.`,
  ),
})

/**
 * The published contract: only the forms a request can actually contain.
 *
 * A REST layer converts its multipart body to bytes and an MCP adapter decodes
 * base64 before calling in; neither of them can put a `Blob` in a JSON payload,
 * so neither of them is told it may.
 */
const uploadAssetTransportInput = z.strictObject({
  presentationId: presentationIdSchema,
  expectedRevision: expectedRevisionSchema,
  name: assetNameSchema,
  content: transportFileContentSchema.describe(CONTENT_DESCRIPTION),
})

export const uploadAsset = defineOperation({
  name: 'upload_asset',
  summary:
    'Lagre en ferdig bildefil i en presentasjon og få tilbake en assetId. Slaids genererer ikke bilder selv.',
  mutates: true,
  scopes: ['assets:write'],
  input: uploadAssetInput,
  transportInput: uploadAssetTransportInput,
  async run(context, input): Promise<AgentResult<StoredAssetResult>> {
    const bytes = await readFileContent(input.content)
    if (!bytes.ok) return fromDomainError(bytes.error)

    // No width/height from the caller: the size comes out of the bitstream, or
    // the file is not stored. A parameter would be a claim, not a measurement.
    return storeAsset(context, {
      presentationId: input.presentationId,
      expectedRevision: input.expectedRevision,
      name: input.name,
      bytes: bytes.value,
    })
  },
})

/* ------------------------------------------------------------------ *
 * create_svg_asset
 * ------------------------------------------------------------------ */

const createSvgAssetInput = z.strictObject({
  presentationId: presentationIdSchema,
  expectedRevision: expectedRevisionSchema,
  name: assetNameSchema,
  svgMarkup: z
    .string()
    .min(1)
    .describe(
      'Selve SVG-markupen. Må ha <svg> som rotelement og en viewBox eller width/height. Skript, hendelsesattributter og eksterne referanser avvises; ukjente elementer og attributter fjernes.',
    ),
})

export const createSvgAsset = defineOperation({
  name: 'create_svg_asset',
  summary: 'Lag en vektorfil direkte fra SVG-markup og få tilbake en assetId.',
  mutates: true,
  scopes: ['assets:write'],
  input: createSvgAssetInput,
  run(context, input): Promise<AgentResult<StoredAssetResult>> {
    // Sanitising, sizing and storing is `storeAsset`'s job; this operation only
    // exists because "here is markup" is a different thing to say than "here is
    // a file", and an agent should not have to encode text as a file to say it.
    return storeAsset(context, {
      presentationId: input.presentationId,
      expectedRevision: input.expectedRevision,
      name: ensureSvgName(input.name),
      bytes: new TextEncoder().encode(input.svgMarkup),
      declaredKind: 'svg',
    })
  },
})

/** A vector file is easier to recognise later if its name says so. */
function ensureSvgName(name: string): string {
  return /\.svg$/i.test(name) ? name : `${name}.svg`
}

/* ------------------------------------------------------------------ *
 * set_zone_asset
 * ------------------------------------------------------------------ */

const setZoneAssetInput = z.strictObject({
  presentationId: presentationIdSchema,
  expectedRevision: expectedRevisionSchema,
  slideId: slideIdSchema,
  nodeId: nodeIdSchema,
  assetId: assetIdSchema,
  fit: z
    .enum(['contain', 'cover'])
    .default('contain')
    .describe('`contain` viser hele bildet, `cover` fyller sonen og beskjærer.'),
  replace: z
    .boolean()
    .default(false)
    .describe('Sett til true for å erstatte innhold som allerede ligger i sonen.'),
  replacedDisposition: dispositionSchema.describe('Hva som skjer med innholdet som erstattes.'),
})

export interface ZoneAssetPlacement {
  presentationId: string
  slideId: string
  nodeId: string
  assetId: string
  /** How many pieces of displaced content were parked in the sandbox. */
  movedToSandbox: number
  discarded: number
  /** The sandbox items this call actually created. */
  sandboxItemIds: string[]
}

export const setZoneAsset = defineOperation({
  name: 'set_zone_asset',
  summary: 'Plasser en eksisterende fil som innholdet i en sone.',
  mutates: true,
  scopes: ['presentations:write'],
  input: setZoneAssetInput,
  run(context, input): Promise<AgentResult<ZoneAssetPlacement>> {
    return mutatePresentation(context, input, (presentation) => {
      if (!presentation.assets.some((asset) => asset.id === input.assetId)) {
        // Checked here rather than left to the renderer: a zone pointing at a
        // file that does not exist is a broken slide, not a placement.
        return err('ASSET_NOT_FOUND', 'Presentasjonen har ingen fil med den id-en.', {
          assetId: input.assetId,
        })
      }

      const placed = setZoneContent(presentation, {
        slideId: input.slideId,
        nodeId: input.nodeId,
        content: createContainer({ type: 'asset', assetId: input.assetId, fit: input.fit }),
        replace: input.replace,
        replacedDisposition: input.replacedDisposition,
        ...structuralOptions(context),
      })
      if (!placed.ok) return placed

      return ok({
        presentation: placed.value.presentation,
        value: {
          presentationId: input.presentationId,
          slideId: input.slideId,
          nodeId: input.nodeId,
          assetId: input.assetId,
          movedToSandbox: placed.value.movedToSandbox.length,
          discarded: placed.value.discarded.length,
          sandboxItemIds: sandboxIdsAdded(presentation, placed.value.presentation),
        },
      })
    })
  },
})

/* ------------------------------------------------------------------ *
 * list_assets
 * ------------------------------------------------------------------ */

const listAssetsInput = z.strictObject({ presentationId: presentationIdSchema })

export interface ListedAsset extends AssetRef {
  /** Whether any slide or sandbox item actually shows this file. */
  used: boolean
}

export const listAssets = defineOperation({
  name: 'list_assets',
  summary: 'Filene som er registrert i en presentasjon.',
  mutates: false,
  scopes: ['presentations:read'],
  input: listAssetsInput,
  async run(context, input): Promise<AgentResult<{ assets: ListedAsset[] }>> {
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const used = usedAssetIds(loaded.value)
    return agentOk({
      assets: loaded.value.assets.map((asset) => ({ ...asset, used: used.has(asset.id) })),
    })
  },
})

/* ------------------------------------------------------------------ *
 * delete_asset
 * ------------------------------------------------------------------ */

export interface DeletedAsset {
  presentationId: string
  assetId: string
  /**
   * Whether the stored bytes went with the reference.
   *
   * The document is written first and the file second, because those two
   * failures cost different things: bytes nothing points at are reclaimed with
   * the presentation, while a document pointing at bytes that are gone is a
   * slide with a hole in it. So `false` here means the file left the deck and
   * an orphan blob was left in the store — the deletion stands, and a caller
   * that cares can retry it. It is never a dangling reference.
   */
  fileRemoved: boolean
}

export const deleteAsset = defineOperation({
  name: 'delete_asset',
  summary:
    'Slett en fil fra en presentasjon, både referansen og selve bytene. Avvises med ASSET_IN_USE så lenge filen vises et sted i dekket.',
  mutates: true,
  // The mirror of `upload_asset`, and the same scope: the authority that put a
  // file in is the authority that takes it out. It is enough *because* the
  // operation is confined to the file list — it refuses while anything shows
  // the file, so it can never remove a picture from a slide, and a token that
  // may only store files cannot use it to edit a deck.
  scopes: ['assets:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    assetId: assetIdSchema,
  }),
  async run(context, input): Promise<AgentResult<DeletedAsset & { revision: string }>> {
    // Two writes, and the order is the whole safety argument. The document goes
    // first: `removeAsset` refuses while the deck still shows the file, so by
    // the time the store is touched the bytes are provably unreferenced. A
    // refusal returns before either write — the document is never saved and the
    // file is never touched — which is what makes the rejection atomic without
    // a transaction spanning two stores.
    const removed = await mutatePresentation(context, input, (presentation) => {
      const without = removeAsset(presentation, input.assetId)
      if (!without.ok) return without
      return ok({
        presentation: without.value,
        value: { presentationId: presentation.id, assetId: input.assetId },
      })
    })
    if (!removed.ok) return removed

    return agentOk({ ...removed.value, fileRemoved: await deleteAssetFile(context, input.assetId) })
  },
})

export const assetOperations = [uploadAsset, createSvgAsset, setZoneAsset, listAssets, deleteAsset]
