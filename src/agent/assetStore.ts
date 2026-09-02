/**
 * The one way an asset enters Slaids from an agent.
 *
 * Both asset operations end up here, which is the point: an SVG posted as
 * markup and an SVG uploaded as a file are the same file once they are stored,
 * so they must meet the same rules. Slaids never *makes* a picture — there is
 * no image generation in this codebase and no external image provider behind
 * it — it only accepts one that already exists, or vector markup that describes
 * one. See `IMPLEMENTATION_PLAN.md` §44.
 *
 * Binary never enters the presentation JSON: the bytes go to the asset store
 * and the document keeps an `AssetRef` that points at them.
 *
 * Storing is two writes — the file, then the document that references it — and
 * the interesting part is what happens when the second one fails. See
 * `resolveAmbiguousRegistration`.
 */

import { registerAsset } from '../domain/commands'
import { MAX_ASSET_BYTES } from '../domain/constants'
import { newAssetId } from '../domain/ids'
import { presentationRevision } from '../domain/revision'
import { probeImageFormat } from '../domain/imageBytes'
import { readRasterImage } from '../domain/imageFile'
import { bytesToBlob } from '../persistence/blob'
import { sanitizeSvg, SVG_MIME_TYPE, type SvgSanitizeReport } from '../domain/svg'
import type { AssetRef, Presentation } from '../domain/types'
import { loadPresentation, revisionConflict, savePresentation, storageFailure } from './presentation'
import {
  agentErr,
  agentOk,
  fromDomainError,
  type AgentContext,
  type AgentFailure,
  type AgentResult,
} from './types'

export interface StoreAssetInput {
  presentationId: string
  /** The reading the caller wrote against; see `presentation.ts`. */
  expectedRevision?: string
  name: string
  bytes: Uint8Array
  /**
   * Set by a caller that already said what it was sending. It changes nothing
   * about what is stored — only what an agent is told when the content turns
   * out to be something else: "this is not valid SVG" is a more useful answer
   * to `create_svg_asset` than "unknown file type".
   */
  declaredKind?: 'svg'
}

export interface StoredAssetResult {
  assetId: string
  ref: AssetRef
  /** The presentation's revision after the file was registered. */
  revision: string
  /** Present when the file was SVG: what the sanitiser dropped, if anything. */
  sanitized?: SvgSanitizeReport
}

export async function storeAsset(
  context: AgentContext,
  input: StoreAssetInput,
): Promise<AgentResult<StoredAssetResult>> {
  const name = input.name.trim()
  if (name.length === 0) return agentErr('INVALID_ARGUMENT', 'Filen må ha et navn.')
  if (input.bytes.byteLength === 0) return agentErr('INVALID_ARGUMENT', 'Filen er tom.')

  const oversized = tooLarge(input.bytes)
  if (oversized) return oversized

  const format = probeImageFormat(input.bytes)
  const wantsSvg = input.declaredKind === 'svg'
  if (!format || (wantsSvg && format.mimeType !== SVG_MIME_TYPE)) {
    return wantsSvg
      ? agentErr('INVALID_SVG', 'Innholdet er ikke SVG-markup med <svg> som rotelement.')
      : agentErr(
          'UNSUPPORTED_MEDIA_TYPE',
          'Innholdet er ikke et bildeformat Slaids kan vise. Bruk PNG, JPEG, GIF, WEBP eller SVG.',
        )
  }

  // Two validators, one per kind of content. SVG is text and is sanitised;
  // everything else is binary and is walked from end to end. Neither trusts the
  // header alone, and neither takes the caller's word for the size.
  let bytes = input.bytes
  let sanitized: SvgSanitizeReport | undefined
  let width: number
  let height: number

  if (format.mimeType === SVG_MIME_TYPE) {
    const clean = sanitizeSvg(new TextDecoder().decode(input.bytes))
    if (!clean.ok) return fromDomainError(clean.error)
    bytes = new TextEncoder().encode(clean.value.markup)
    sanitized = clean.value.report
    width = clean.value.width
    height = clean.value.height

    // Re-serialising can grow the file — every `&` in the source comes back as
    // `&amp;` — so the limit is checked again on what is actually stored, not
    // only on what arrived.
    const grewTooLarge = tooLarge(bytes)
    if (grewTooLarge) return grewTooLarge
  } else {
    const raster = readRasterImage(input.bytes)
    if (!raster.ok) return fromDomainError(raster.error)
    width = raster.value.width
    height = raster.value.height
  }

  const loaded = await loadPresentation(context, input.presentationId)
  if (!loaded.ok) return loaded

  // Checked before a single byte is written: a conflict that is discovered
  // after the file is stored leaves an orphan to clean up for nothing.
  const conflict = revisionConflict(loaded.value, input.expectedRevision)
  if (conflict) return conflict

  const ref: AssetRef = {
    id: newAssetId(),
    name,
    mimeType: format.mimeType,
    byteSize: bytes.byteLength,
    width,
    height,
    isVector: format.isVector,
  }
  // The revision reported is the one of the document that is actually stored,
  // which in the ambiguous case below is the copy read back from the store
  // rather than the one this process built.
  const success = (stored: Presentation): AgentResult<StoredAssetResult> =>
    agentOk({
      assetId: ref.id,
      ref,
      revision: presentationRevision(stored),
      ...(sanitized ? { sanitized } : {}),
    })

  try {
    await context.repository.putAsset(input.presentationId, ref, bytesToBlob(bytes, ref.mimeType))
  } catch (error) {
    return storageFailure(error, 'Kunne ikke lagre filen.', { name: ref.name })
  }

  const registered = registerAsset(loaded.value, ref)
  if (!registered.ok) {
    // Nothing was written to the document, so the file is provably unreferenced.
    await discard(context, ref.id)
    return fromDomainError(registered.error)
  }

  const saved = await savePresentation(context, registered.value)
  if (saved.ok) return success(saved.value)
  return resolveAmbiguousRegistration(context, input.presentationId, ref, saved, success)
}

/**
 * The file is stored, the document write failed — but did it?
 *
 * A failed write is not proof that the server did not write. Supabase can
 * commit the row and lose the response on the way back, and the naive rollback
 * ("the save failed, so delete the file") then deletes bytes that the stored
 * presentation already points at: a slide with a permanently broken picture,
 * caused by the cleanup rather than by the fault.
 *
 * So the question is answered by reading, not assumed from the error:
 *
 *  - the stored presentation lists the asset → the write landed; the file stays
 *    and the caller is told it worked, because that is what the state says;
 *  - the stored presentation does not list it → the write did not land; the
 *    file is unreferenced and can be removed;
 *  - the presentation is gone entirely → nothing can reference the file;
 *  - the store cannot be read either → undecidable, so the file is kept. An
 *    unreferenced file costs storage; a missing file that a slide points at
 *    costs the slide. Its id comes back in `details.retainedAssetId` so the
 *    caller can retry or clean up deliberately, and it is deleted with its
 *    presentation either way.
 */
async function resolveAmbiguousRegistration(
  context: AgentContext,
  presentationId: string,
  ref: AssetRef,
  failure: AgentFailure,
  success: (stored: Presentation) => AgentResult<StoredAssetResult>,
): Promise<AgentResult<StoredAssetResult>> {
  const stored = await loadPresentation(context, presentationId)

  if (stored.ok) {
    if (stored.value.assets.some((asset) => asset.id === ref.id)) return success(stored.value)
    await discard(context, ref.id)
    return failure
  }

  if (stored.error.code === 'PRESENTATION_NOT_FOUND') {
    await discard(context, ref.id)
    return failure
  }

  return retaining(failure, ref.id)
}

function retaining(failure: AgentFailure, assetId: string): AgentFailure {
  return {
    ok: false,
    error: {
      ...failure.error,
      message: `${failure.error.message} Filen er beholdt fordi det ikke kunne avgjøres om registreringen landet.`,
      details: { ...(failure.error.details ?? {}), retainedAssetId: assetId },
    },
  }
}

function tooLarge(bytes: Uint8Array): AgentFailure | null {
  if (bytes.byteLength <= MAX_ASSET_BYTES) return null
  return {
    ok: false,
    error: {
      code: 'ASSET_TOO_LARGE',
      message: `Filen er for stor (maks ${MAX_ASSET_BYTES} byte).`,
      details: { byteSize: bytes.byteLength, maxByteSize: MAX_ASSET_BYTES },
    },
  }
}

async function discard(context: AgentContext, assetId: string): Promise<void> {
  try {
    await context.repository.deleteAsset(assetId)
  } catch {
    // Best effort, and only ever called once the file is known to be
    // unreferenced: the caller is already being told the write failed, and the
    // orphan sweeper reclaims whatever is left behind.
  }
}
