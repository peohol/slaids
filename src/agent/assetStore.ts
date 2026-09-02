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
 */

import { registerAsset } from '../domain/commands'
import { MAX_ASSET_BYTES } from '../domain/constants'
import { newAssetId } from '../domain/ids'
import { probeImage } from '../domain/imageBytes'
import { bytesToBlob } from '../persistence/blob'
import { sanitizeSvg, SVG_MIME_TYPE, type SvgSanitizeReport } from '../domain/svg'
import type { AssetRef } from '../domain/types'
import { loadPresentation, savePresentation, storageFailure } from './presentation'
import { agentErr, agentOk, fromDomainError, type AgentContext, type AgentResult } from './types'

export interface StoreAssetInput {
  presentationId: string
  name: string
  bytes: Uint8Array
  /**
   * Set by a caller that already said what it was sending. It changes nothing
   * about what is stored — only what an agent is told when the content turns
   * out to be something else: "this is not valid SVG" is a more useful answer
   * to `create_svg_asset` than "unknown file type".
   */
  declaredKind?: 'svg'
  /** Only used for formats whose header does not carry a size (AVIF). */
  width?: number
  height?: number
}

export interface StoredAssetResult {
  assetId: string
  ref: AssetRef
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

  const probed = probeImage(input.bytes)
  if (!probed || (input.declaredKind === 'svg' && probed.mimeType !== SVG_MIME_TYPE)) {
    return input.declaredKind === 'svg'
      ? agentErr('INVALID_SVG', 'Innholdet er ikke SVG-markup med <svg> som rotelement.')
      : agentErr(
          'UNSUPPORTED_MEDIA_TYPE',
          'Innholdet er ikke et bildeformat Slaids kan vise. Bruk PNG, JPEG, GIF, WEBP, AVIF eller SVG.',
        )
  }

  // SVG is the only format whose *content* is inspected, because it is the only
  // one that could carry behaviour. What is stored is the sanitiser's output.
  let bytes = input.bytes
  let sanitized: SvgSanitizeReport | undefined
  let width = probed.width
  let height = probed.height

  if (probed.mimeType === SVG_MIME_TYPE) {
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
  }

  if (width <= 0 || height <= 0) {
    // Only reachable for formats this build cannot measure; a caller that knows
    // the size may say so, and layout keeps its aspect ratio either way.
    width = input.width ?? 0
    height = input.height ?? 0
  }

  const loaded = await loadPresentation(context, input.presentationId)
  if (!loaded.ok) return loaded

  const ref: AssetRef = {
    id: newAssetId(),
    name,
    mimeType: probed.mimeType,
    byteSize: bytes.byteLength,
    width,
    height,
    isVector: probed.isVector,
  }

  try {
    await context.repository.putAsset(input.presentationId, ref, bytesToBlob(bytes, ref.mimeType))
  } catch (error) {
    return storageFailure(error, 'Kunne ikke lagre filen.', { name: ref.name })
  }

  const registered = registerAsset(loaded.value, ref)
  if (!registered.ok) {
    await discard(context, ref.id)
    return fromDomainError(registered.error)
  }

  const saved = await savePresentation(context, registered.value)
  if (!saved.ok) {
    // The bytes are stored but nothing references them, and an asset row with
    // no reference is exactly what `deleteOrphanAssets` exists to clean up —
    // so it is taken back out now rather than left for the sweeper.
    await discard(context, ref.id)
    return saved
  }

  return agentOk({ assetId: ref.id, ref, ...(sanitized ? { sanitized } : {}) })
}

function tooLarge(bytes: Uint8Array): AgentResult<never> | null {
  if (bytes.byteLength <= MAX_ASSET_BYTES) return null
  return agentErr('ASSET_TOO_LARGE', `Filen er for stor (maks ${MAX_ASSET_BYTES} byte).`, {
    byteSize: bytes.byteLength,
    maxByteSize: MAX_ASSET_BYTES,
  })
}

async function discard(context: AgentContext, assetId: string): Promise<void> {
  try {
    await context.repository.deleteAsset(assetId)
  } catch {
    // Best effort: the caller is already being told the write failed, and the
    // orphan sweeper reclaims whatever is left behind.
  }
}
