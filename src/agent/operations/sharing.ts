/**
 * Publishing a deck, and reading whether it is published.
 *
 * Sharing is the one thing an agent can do that reaches outside the owner's
 * account, which is why it has a scope of its own: a token that may rewrite
 * every slide in the library still may not hand any of them to the internet.
 * See `IMPLEMENTATION_PLAN.md` §44, "Autentisering av agenter".
 *
 * Everything else about sharing is unchanged from the editor's version, because
 * it is the same repository underneath:
 *
 *  - the snapshot is built by `domain/sharing.ts`, by listing what goes in
 *    rather than deleting what must not, so a field added to `Presentation`
 *    later stays private until somebody publishes it on purpose;
 *  - what gets published is the document as *stored*. An agent's mutations are
 *    saved before they return, so reading the presentation here is reading what
 *    the audience would see — there is no unsaved editor to get ahead of;
 *  - the token rotates on both activation and deactivation, in the repository,
 *    so a link that was revoked can never come back to life.
 *
 * Local mode has no public backend and therefore no sharing at all. That is a
 * `SHARING_UNAVAILABLE` rather than a link that looks live: a pretend answer
 * here would be an address that cannot work.
 */

import { z } from 'zod'
import { buildSharedSnapshot } from '../../domain/sharing'
import { presentationRevision } from '../../domain/revision'
import { SHARE_PATH_PREFIX } from '../../routing'
import type { SharingRepository } from '../../persistence/repository'
import { defineOperation, expectedRevisionSchema, presentationIdSchema } from '../operation'
import { loadPresentation, revisionConflict, storageFailure } from '../presentation'
import { agentErr, agentOk, type AgentContext, type AgentResult } from '../types'

export interface SharingView {
  presentationId: string
  shared: boolean
  /** Only ever set while `shared` is true. A revoked token is not a link. */
  token: string | null
  /**
   * Where the published deck lives, relative to wherever Slaids is served.
   * The origin is the transport's to know, not Agent Core's.
   */
  path: string | null
}

function sharingView(presentationId: string, state: { shared: boolean; token: string | null }): SharingView {
  const token = state.shared ? state.token : null
  return {
    presentationId,
    shared: state.shared,
    token,
    path: token ? `${SHARE_PATH_PREFIX}${token}` : null,
  }
}

/** The publishing backend, or the reason there is not one. */
function requireSharing(context: AgentContext): SharingRepository | null {
  return context.sharing ?? null
}

const unavailable = <T,>(presentationId: string): AgentResult<T> =>
  agentErr(
    'SHARING_UNAVAILABLE',
    'Denne Slaids-installasjonen har ingen offentlig delingsbackend, så det finnes ingenting å publisere til.',
    { presentationId },
  )

/* ------------------------------------------------------------------ *
 * get_sharing
 * ------------------------------------------------------------------ */

export const getSharing = defineOperation({
  name: 'get_sharing',
  summary: 'Om presentasjonen er publisert, og hvilken delingslenke som er aktiv.',
  mutates: false,
  scopes: ['presentations:read'],
  input: z.strictObject({ presentationId: presentationIdSchema }),
  async run(context, input): Promise<AgentResult<SharingView>> {
    const sharing = requireSharing(context)
    if (!sharing) return unavailable(input.presentationId)
    try {
      const state = await sharing.readShareState(input.presentationId)
      return agentOk(sharingView(input.presentationId, state))
    } catch (error) {
      return storageFailure(error, 'Kunne ikke lese delingsstatusen.', {
        presentationId: input.presentationId,
      })
    }
  },
})

/* ------------------------------------------------------------------ *
 * set_sharing
 * ------------------------------------------------------------------ */

export const setSharing = defineOperation({
  name: 'set_sharing',
  summary:
    'Publiser presentasjonen på en hemmelig lenke, eller trekk delingen tilbake. Krever scopet sharing:write.',
  mutates: true,
  scopes: ['sharing:write'],
  input: z.strictObject({
    presentationId: presentationIdSchema,
    expectedRevision: expectedRevisionSchema,
    shared: z
      .boolean()
      .describe(
        'true publiserer den lagrede presentasjonen på en ny lenke; false slår delingen av og gjør lenken ugyldig for godt.',
      ),
  }),
  async run(context, input): Promise<AgentResult<SharingView>> {
    const sharing = requireSharing(context)
    if (!sharing) return unavailable(input.presentationId)

    // Loading serves two purposes: it is what the snapshot is cut from, and it
    // is what tells the repository which database version this publication
    // belongs to — so a document another writer has moved on from is a conflict
    // rather than an audience left on a version the owner has already replaced.
    const loaded = await loadPresentation(context, input.presentationId)
    if (!loaded.ok) return loaded

    const conflict = revisionConflict(loaded.value, input.expectedRevision)
    if (conflict) return conflict

    try {
      const state = input.shared
        ? await sharing.enableSharing(input.presentationId, buildSharedSnapshot(loaded.value))
        : await sharing.disableSharing(input.presentationId)
      return agentOk(sharingView(input.presentationId, state))
    } catch (error) {
      return storageFailure(
        error,
        input.shared ? 'Kunne ikke dele presentasjonen.' : 'Kunne ikke slå av delingen.',
        { presentationId: input.presentationId, revision: presentationRevision(loaded.value) },
      )
    }
  },
})

export const sharingOperations = [getSharing, setSharing]
