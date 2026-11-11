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

import { acceptAsset } from '../domain/assetIngress'
import { hashBytes } from '../domain/assetHash'
import { registerAsset } from '../domain/commands'
import { newAssetId } from '../domain/ids'
import { presentationRevision } from '../domain/revision'
import { findIdenticalAsset } from '../persistence/assetDedupe'
import { bytesToBlob } from '../persistence/blob'
import type { SvgSanitizeReport } from '../domain/svg'
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
  /**
   * The presentation already held these exact bytes, so `assetId` names the
   * file it had and nothing was written — a second copy of one picture is one
   * picture. The revision is then the one that was read.
   */
  deduplicated: boolean
  /** Present when the file was SVG: what the sanitiser dropped, if anything. */
  sanitized?: SvgSanitizeReport
}

/**
 * A file whose bytes are in the store, but which no document lists yet.
 *
 * The first half of storing, kept apart so that a caller that must register
 * the file *and* change something else in the same guarded document save (a
 * theme template with a logo, say) goes through the same door as
 * `upload_asset` without a second document write. The caller then owns the
 * rest: register `ref` unless `deduplicated`, save against `revision`, and on a
 * failed save hand the question to `resolveAmbiguousRegistration`.
 */
export interface PreparedAsset {
  /** The presentation as it was read, before anything was written. */
  presentation: Presentation
  /** Its revision: the guard the registering save must be written against. */
  revision: string
  ref: AssetRef
  /**
   * The presentation already lists these exact bytes as `ref`, so nothing was
   * written and nothing needs registering or cleaning up.
   */
  deduplicated: boolean
  /** Present when the file was SVG: what the sanitiser dropped, if anything. */
  sanitized?: SvgSanitizeReport
}

export async function prepareAsset(
  context: AgentContext,
  input: StoreAssetInput,
): Promise<AgentResult<PreparedAsset>> {
  const name = input.name.trim()
  if (name.length === 0) return agentErr('INVALID_ARGUMENT', 'Filen må ha et navn.')

  // The whole ingress policy, shared with the editor's dialog and `.slaids`
  // import: the format is read from the bytes, an SVG is parsed and
  // re-serialised by `domain/svg.ts`, a raster file is walked end to end by
  // `domain/imageFile.ts`, and the size never comes from the caller. What comes
  // back is what gets stored.
  const accepted = acceptAsset(input.bytes, {
    raster: 'bitstream',
    expect: input.declaredKind === 'svg' ? 'vector' : undefined,
  })
  if (!accepted.ok) return fromDomainError(accepted.error)
  const { bytes, mimeType, isVector, size } = accepted.value
  const sanitized = accepted.value.report ? { sanitized: accepted.value.report } : {}

  const loaded = await loadPresentation(context, input.presentationId)
  if (!loaded.ok) return loaded
  const presentation = loaded.value
  const revision = presentationRevision(presentation)

  // Checked before a single byte is written: a conflict that is discovered
  // after the file is stored leaves an orphan to clean up for nothing.
  const conflict = revisionConflict(presentation, input.expectedRevision, revision)
  if (conflict) return conflict

  // Identical bytes already in the deck are the file the agent is asking for,
  // under whatever name it gave this time. Answered before anything is written.
  const hash = await hashBytes(bytes)
  const identical = await findIdenticalAsset(context.repository, presentation, {
    bytes,
    mimeType,
    hash,
  })
  if (identical) {
    return agentOk({ presentation, revision, ref: identical.ref, deduplicated: true, ...sanitized })
  }

  const ref: AssetRef = {
    id: newAssetId(),
    name,
    mimeType,
    byteSize: bytes.byteLength,
    width: size.width,
    height: size.height,
    isVector,
    contentHash: hash,
  }
  try {
    await context.repository.putAsset(input.presentationId, ref, bytesToBlob(bytes, ref.mimeType))
  } catch (error) {
    return storageFailure(error, 'Kunne ikke lagre filen.', { name: ref.name })
  }
  return agentOk({ presentation, revision, ref, deduplicated: false, ...sanitized })
}

export async function storeAsset(
  context: AgentContext,
  input: StoreAssetInput,
): Promise<AgentResult<StoredAssetResult>> {
  const prepared = await prepareAsset(context, input)
  if (!prepared.ok) return prepared
  const { presentation, revision, ref, deduplicated, sanitized } = prepared.value

  // The revision reported is the one of the document that is actually stored,
  // which in the ambiguous case below is the copy read back from the store
  // rather than the one this process built.
  const result = (storedRevision: string): AgentResult<StoredAssetResult> =>
    agentOk({
      assetId: ref.id,
      ref,
      revision: storedRevision,
      deduplicated,
      ...(sanitized ? { sanitized } : {}),
    })
  if (deduplicated) return result(revision)

  const registered = registerAsset(presentation, ref)
  if (!registered.ok) {
    // Nothing was written to the document, so the file is provably unreferenced.
    await discard(context, ref.id)
    return fromDomainError(registered.error)
  }

  const saved = await savePresentation(context, registered.value, revision)
  if (saved.ok) return result(presentationRevision(saved.value))
  return resolveAmbiguousRegistration(context, input.presentationId, ref.id, saved, (stored) =>
    result(presentationRevision(stored)),
  )
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
 *
 * `success` builds the caller's answer from the stored document, because a
 * save that landed may have carried more than the registration (a theme
 * template applied in the same write, for one).
 */
export async function resolveAmbiguousRegistration<T>(
  context: AgentContext,
  presentationId: string,
  assetId: string,
  failure: AgentFailure,
  success: (stored: Presentation) => AgentResult<T>,
): Promise<AgentResult<T>> {
  const stored = await loadPresentation(context, presentationId)

  if (stored.ok) {
    if (stored.value.assets.some((asset) => asset.id === assetId)) return success(stored.value)
    await discard(context, assetId)
    return failure
  }

  if (stored.error.code === 'PRESENTATION_NOT_FOUND') {
    await discard(context, assetId)
    return failure
  }

  return retaining(failure, assetId)
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

/**
 * Remove the stored bytes of a file nothing references any more.
 *
 * Never throws, and says whether the bytes are actually gone. Both callers need
 * exactly that and neither can do anything else with a failure: the rollback
 * path below is already reporting a failed write, and `delete_asset` has
 * *already* stored a document that no longer lists the file — undoing that
 * would put the `AssetRef` back and be a second write to fix a cleanup.
 *
 * The answer is the repository's own, not "the call did not throw". Deleting a
 * file in Supabase is two removals — the row, then the object — and a failed
 * object removal deliberately does not fail the call: the row is gone, which is
 * what the caller asked for. It is still a file that is *there*, so reporting
 * `true` on the strength of the call resolving would be publishing a claim
 * about storage nobody checked. See `SlaidsRepository.deleteAsset`.
 *
 * The asymmetry is the same one `resolveAmbiguousRegistration` turns on, in
 * the other direction: bytes nothing points at cost storage until the
 * presentation is deleted with them, while a document pointing at bytes that
 * are gone costs the slide. So the document is always written first and this
 * always comes second — and a `false` here is an orphan, never a broken deck.
 */
export async function deleteAssetFile(
  context: AgentContext,
  assetId: string,
): Promise<boolean> {
  try {
    return await context.repository.deleteAsset(assetId)
  } catch {
    return false
  }
}

async function discard(context: AgentContext, assetId: string): Promise<void> {
  // Best effort, and only ever called once the file is known to be
  // unreferenced: the caller is already being told the write failed, and the
  // orphan sweeper reclaims whatever is left behind.
  await deleteAssetFile(context, assetId)
}
