/**
 * The library's own operations, against a real repository.
 *
 * These are the four calls that act on a presentation from the outside — where
 * it lives, copying it, ending it — and what has to be pinned about them is not
 * that a method was called. It is what is left in the store afterwards: a copy
 * that survives the deletion of its original, an original that survives an edit
 * to its copy, a deck that is gone along with its files, and a folder id that
 * never reaches the document unless the library actually has that folder. A stub
 * could not answer any of those, so this uses `DexieSlaidsRepository`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { newFolderId, newShareToken } from '../domain/ids'
import { createPresentation } from '../domain/presentation'
import { presentationRevision } from '../domain/revision'
import { blobToBytes } from '../persistence/blob'
import { SlaidsDatabase } from '../persistence/db'
import { DexieSlaidsRepository } from '../persistence/dexieRepository'
import {
  RepositoryError,
  type ShareState,
  type SharingRepository,
  type SlaidsRepository,
} from '../persistence/repository'
import type { SharedPresentationSnapshot } from '../domain/sharing'
import { realImages } from '../domain/testImages'
import type { Folder, Presentation } from '../domain/types'
import { runOperation } from './registry'
import type { AgentContext, AgentResult } from './types'
import type { PresentationView } from './operations/deck'
import type { DeletedPresentation, MovedPresentation } from './operations/library'

let counter = 0
const databases: SlaidsDatabase[] = []

function freshContext(sharing?: SharingRepository): AgentContext {
  counter += 1
  const database = new SlaidsDatabase(`slaids-agent-library-${counter}`)
  databases.push(database)
  return { repository: new DexieSlaidsRepository(database), ...(sharing ? { sharing } : {}) }
}

afterEach(async () => {
  while (databases.length > 0) await databases.pop()?.delete()
})

async function call<T>(
  context: AgentContext,
  name: string,
  input: Record<string, unknown> = {},
): Promise<AgentResult<T>> {
  return (await runOperation(context, name, input)) as AgentResult<T>
}

function expectOk<T>(result: AgentResult<T>): T {
  if (!result.ok) {
    throw new Error(`Forventet suksess, fikk ${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

function expectErr(result: AgentResult<unknown>): {
  code: string
  message: string
  details?: Record<string, unknown>
} {
  if (result.ok) throw new Error('Forventet en feil')
  return result.error
}

async function folderIn(context: AgentContext, name: string): Promise<Folder> {
  const folder: Folder = { id: newFolderId(), name, createdAt: new Date().toISOString() }
  await context.repository.saveFolder(folder)
  return folder
}

async function deckIn(context: AgentContext, title = 'Bibliotektest'): Promise<Presentation> {
  const presentation = createPresentation({ title })
  await context.repository.savePresentation(presentation)
  return presentation
}

/**
 * The real repository with one method replaced.
 *
 * Built on the instance rather than around it: a spread would copy the fields
 * and leave every prototype method behind, and a class per case would be four
 * classes to say one thing. Method lookup falls through to the real repository,
 * so what is under test is the operation meeting one genuine failure.
 */
function overriding(base: SlaidsRepository, overrides: Partial<SlaidsRepository>): SlaidsRepository {
  return Object.assign(Object.create(base) as SlaidsRepository, overrides)
}

/** The publishing backend, in memory — the same double the sharing tests use. */
class MemorySharing implements SharingRepository {
  private state = new Map<string, ShareState>()

  readShareState(presentationId: string): Promise<ShareState> {
    return Promise.resolve(this.state.get(presentationId) ?? { shared: false, token: null })
  }

  enableSharing(presentationId: string, _snapshot: SharedPresentationSnapshot): Promise<ShareState> {
    const next: ShareState = { shared: true, token: newShareToken() }
    this.state.set(presentationId, next)
    return Promise.resolve(next)
  }

  disableSharing(presentationId: string): Promise<ShareState> {
    this.state.set(presentationId, { shared: false, token: newShareToken() })
    return Promise.resolve({ shared: false, token: null })
  }
}

/* ------------------------------------------------------------------ *
 * list_folders
 * ------------------------------------------------------------------ */

describe('list_folders', () => {
  it('svarer med bibliotekets egne mapper', async () => {
    const context = freshContext()
    const first = await folderIn(context, 'Kundemøter')
    const second = await folderIn(context, 'Arkiv')

    const listed = expectOk(await call<{ folders: Folder[] }>(context, 'list_folders'))
    expect(listed.folders.map((folder) => folder.id).sort()).toEqual([first.id, second.id].sort())
    // The repository's own rows, unchanged: id, name, creation time. No second
    // folder model invented for the API.
    expect(listed.folders.find((folder) => folder.id === first.id)).toEqual(first)
  })

  it('svarer med en tom liste når biblioteket ikke har noen mapper', async () => {
    // Not an error and not a missing field: "no folders" is a perfectly normal
    // library, and an agent that has to tell it apart from a failure cannot.
    const context = freshContext()
    expect(expectOk(await call<{ folders: Folder[] }>(context, 'list_folders'))).toEqual({
      folders: [],
    })
  })

  it('gjør en lagringsfeil om til STORAGE_FAILED i stedet for et kast', async () => {
    const context = freshContext()
    const failing = overriding(context.repository, {
      listFolders: () => Promise.reject(new RepositoryError('Basen svarer ikke.')),
    })

    const refused = expectErr(await call({ ...context, repository: failing }, 'list_folders'))
    expect(refused.code).toBe('STORAGE_FAILED')
  })
})

/* ------------------------------------------------------------------ *
 * move_presentation
 * ------------------------------------------------------------------ */

describe('move_presentation', () => {
  it('flytter en presentasjon inn i en mappe, i dokumentet og i oversikten', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const folder = await folderIn(context, 'Kundemøter')

    const moved = expectOk(
      await call<MovedPresentation & { revision: string }>(context, 'move_presentation', {
        presentationId: deck.id,
        folderId: folder.id,
      }),
    )
    expect(moved).toMatchObject({ presentationId: deck.id, folderId: folder.id })

    // Both places the folder is named, because the library filters on one and
    // the editor reads the other.
    const stored = await context.repository.loadPresentation(deck.id)
    expect(stored.folderId).toBe(folder.id)
    expect((await context.repository.listPresentations())[0].folderId).toBe(folder.id)
    // And the receipt's revision is the one the next call writes against.
    expect(moved.revision).toBe(presentationRevision(stored))
  })

  it('flytter tilbake til roten med null', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const folder = await folderIn(context, 'Kundemøter')
    await call(context, 'move_presentation', { presentationId: deck.id, folderId: folder.id })

    const moved = expectOk(
      await call<MovedPresentation>(context, 'move_presentation', {
        presentationId: deck.id,
        folderId: null,
      }),
    )
    expect(moved.folderId).toBeNull()
    expect((await context.repository.loadPresentation(deck.id)).folderId).toBeNull()
  })

  it('krever at feltet er der: en flytting må si hvor', async () => {
    // Omitting it would have to mean "leave it where it is", which is not a
    // move. `null` is how you say "out of every folder".
    const context = freshContext()
    const deck = await deckIn(context)
    expect(expectErr(await call(context, 'move_presentation', { presentationId: deck.id })).code).toBe(
      'INVALID_INPUT',
    )
  })

  it('avviser en mappe biblioteket ikke har, og skriver ingenting', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const before = await context.repository.loadPresentation(deck.id)

    const refused = expectErr(
      await call(context, 'move_presentation', { presentationId: deck.id, folderId: 'fl_finnes_ikke' }),
    )
    expect(refused.code).toBe('FOLDER_NOT_FOUND')
    expect(refused.details).toEqual({ folderId: 'fl_finnes_ikke' })
    // A deck in a folder that does not exist is shown nowhere, so the refusal
    // has to come before the write — not be repaired afterwards.
    expect(await context.repository.loadPresentation(deck.id)).toEqual(before)
  })

  it('lekker ikke mappenavn til et token som ikke får lese dem', async () => {
    // The refusal names the id the caller already sent and nothing else. A list
    // of the real folders would be `list_folders` answered without its scope.
    const context = freshContext()
    const deck = await deckIn(context)
    await folderIn(context, 'Hemmelig mappenavn')

    const refused = expectErr(
      await call(context, 'move_presentation', { presentationId: deck.id, folderId: 'fl_nei' }),
    )
    expect(JSON.stringify(refused)).not.toContain('Hemmelig mappenavn')
  })

  it('er en no-op som ikke flytter revisjonen når dekket allerede ligger der', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const folder = await folderIn(context, 'Kundemøter')
    const first = expectOk(
      await call<MovedPresentation & { revision: string }>(context, 'move_presentation', {
        presentationId: deck.id,
        folderId: folder.id,
      }),
    )

    const again = expectOk(
      await call<MovedPresentation & { revision: string }>(context, 'move_presentation', {
        presentationId: deck.id,
        folderId: folder.id,
      }),
    )
    // Calling it on routine must not make anybody else's `expectedRevision`
    // stale for a change that never happened.
    expect(again.revision).toBe(first.revision)
    expect(again.folderId).toBe(folder.id)
  })

  it('avviser en gammel revisjon med CONFLICT', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const folder = await folderIn(context, 'Kundemøter')
    const stale = presentationRevision(deck)
    await call(context, 'set_presentation_title', { presentationId: deck.id, title: 'Endret' })

    const refused = expectErr(
      await call(context, 'move_presentation', {
        presentationId: deck.id,
        folderId: folder.id,
        expectedRevision: stale,
      }),
    )
    expect(refused.code).toBe('CONFLICT')
    expect((await context.repository.loadPresentation(deck.id)).folderId).toBeNull()
  })

  it('gjelder den samme mappesjekken for create_presentation', async () => {
    // The other door into a folder. A deck created straight into a folder that
    // does not exist would be just as invisible as one moved there.
    const context = freshContext()
    const refused = expectErr(
      await call(context, 'create_presentation', { title: 'Nytt dekk', folderId: 'fl_nei' }),
    )
    expect(refused.code).toBe('FOLDER_NOT_FOUND')
    expect(await context.repository.listPresentations()).toEqual([])

    const folder = await folderIn(context, 'Kundemøter')
    const created = expectOk(
      await call<PresentationView>(context, 'create_presentation', {
        title: 'Nytt dekk',
        folderId: folder.id,
      }),
    )
    expect(created.folderId).toBe(folder.id)
  })

  it('sier PRESENTATION_NOT_FOUND om presentasjonen, ikke om mappen', async () => {
    const context = freshContext()
    const folder = await folderIn(context, 'Kundemøter')
    expect(
      expectErr(await call(context, 'move_presentation', { presentationId: 'p_nei', folderId: folder.id }))
        .code,
    ).toBe('PRESENTATION_NOT_FOUND')
  })
})

/* ------------------------------------------------------------------ *
 * duplicate_presentation
 * ------------------------------------------------------------------ */

/** A deck with text, a cited reference and a placed picture in it. */
async function filledDeck(context: AgentContext): Promise<{
  presentationId: string
  slideId: string
  nodeId: string
  referenceId: string
  assetId: string
}> {
  const created = expectOk(
    await call<PresentationView>(context, 'create_presentation', { title: 'Full presentasjon' }),
  )
  const presentationId = created.presentationId
  const slideId = created.slides[0].slideId

  const inspected = expectOk(
    await call<{ rootNodeId: string }>(context, 'inspect_slide', { presentationId, slideId }),
  )
  const split = expectOk(
    await call<{ childNodeIds: string[] }>(context, 'split_zone', {
      presentationId,
      slideId,
      nodeId: inspected.rootNodeId,
      axis: 'x',
      weights: [1, 1],
    }),
  )
  const [left, right] = split.childNodeIds

  const reference = expectOk(
    await call<{ reference: { id: string } }>(context, 'add_reference', {
      presentationId,
      title: 'En kilde',
      authors: 'Forfatter',
      year: '2026',
    }),
  ).reference

  await call(context, 'set_zone_text', {
    presentationId,
    slideId,
    nodeId: left,
    blocks: [
      {
        type: 'paragraph',
        spans: [{ text: 'Tekst med kilde' }, { citation: [reference.id] }],
      },
    ],
  })

  const asset = expectOk(
    await call<{ assetId: string }>(context, 'upload_asset', {
      presentationId,
      name: 'figur.png',
      content: { encoding: 'bytes', data: realImages.png() },
    }),
  )
  await call(context, 'set_zone_asset', {
    presentationId,
    slideId,
    nodeId: right,
    assetId: asset.assetId,
  })

  return { presentationId, slideId, nodeId: left, referenceId: reference.id, assetId: asset.assetId }
}

describe('duplicate_presentation', () => {
  it('kopierer innhold, referanser og filer til en selvstendig presentasjon', async () => {
    const context = freshContext()
    const source = await filledDeck(context)

    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )

    expect(copy.presentationId).not.toBe(source.presentationId)
    expect(copy.title).toBe('Full presentasjon (kopi)')
    expect(copy.slideCount).toBe(1)
    expect(copy.referenceCount).toBe(1)
    expect(copy.assetCount).toBe(1)
    // The same view `create_presentation` answers with, so an agent that has
    // just made a deck can carry on without reading it again.
    expect(copy.revision).toBe(
      presentationRevision(await context.repository.loadPresentation(copy.presentationId)),
    )

    const stored = await context.repository.loadPresentation(copy.presentationId)
    const original = await context.repository.loadPresentation(source.presentationId)

    // Every identity inside the document is new …
    expect(stored.slides[0].id).not.toBe(original.slides[0].id)
    expect(stored.slides[0].root.id).not.toBe(original.slides[0].root.id)
    expect(stored.assets[0].id).not.toBe(original.assets[0].id)
    // … and the file is a real second file, not a shared reference.
    const copied = await context.repository.getAsset(stored.assets[0].id)
    const origin = await context.repository.getAsset(original.assets[0].id)
    expect(copied).not.toBeNull()
    expect(await blobToBytes(copied!.blob)).toEqual(await blobToBytes(origin!.blob))

    // The zone in the copy points at the copy's own file, never at the source's.
    const inspected = expectOk(
      await call<{ zones: { assetIds?: string[]; referenceIds?: string[] }[] }>(
        context,
        'inspect_slide',
        { presentationId: copy.presentationId, slideId: stored.slides[0].id },
      ),
    )
    const assetIds = inspected.zones.flatMap((zone) => zone.assetIds ?? [])
    expect(assetIds).toEqual([stored.assets[0].id])
    // The citation survived, and it still names a reference the copy has.
    const citedIds = inspected.zones.flatMap((zone) => zone.referenceIds ?? [])
    expect(citedIds).toEqual([source.referenceId])
    expect(stored.references.map((reference) => reference.id)).toEqual([source.referenceId])
  })

  it('deler ingen id-er med originalen, heller ikke i sandkassen', async () => {
    const context = freshContext()
    const source = await filledDeck(context)
    // Park something: sandbox content is addressable too, and a copy that shared
    // those ids would be two decks whose parked work is the same object.
    await call(context, 'clear_zone', {
      presentationId: source.presentationId,
      slideId: source.slideId,
      nodeId: source.nodeId,
    })

    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )
    const original = await context.repository.loadPresentation(source.presentationId)
    const stored = await context.repository.loadPresentation(copy.presentationId)
    expect(stored.sandbox).toHaveLength(1)

    const identities = (presentation: Presentation): string[] => {
      const ids: string[] = [presentation.id]
      const walk = (node: (typeof presentation.slides)[number]['root']): void => {
        ids.push(node.id)
        if (node.kind === 'split') {
          for (const child of node.children) walk(child)
          return
        }
        if (node.content) ids.push(node.content.id)
      }
      for (const slide of presentation.slides) {
        ids.push(slide.id)
        walk(slide.root)
      }
      for (const item of presentation.sandbox) ids.push(item.id, item.content.id)
      for (const asset of presentation.assets) ids.push(asset.id)
      return ids
    }

    const shared = identities(stored).filter((id) => identities(original).includes(id))
    expect(shared).toEqual([])
  })

  it('lar originalen stå uendret når kopien redigeres', async () => {
    const context = freshContext()
    const source = await filledDeck(context)
    const before = await context.repository.loadPresentation(source.presentationId)

    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )
    const copySlideId = copy.slides[0].slideId
    expectOk(
      await call(context, 'set_slide_title', {
        presentationId: copy.presentationId,
        slideId: copySlideId,
        spans: [{ text: 'Bare i kopien' }],
      }),
    )
    expectOk(
      await call(context, 'add_slide', { presentationId: copy.presentationId }),
    )

    expect(await context.repository.loadPresentation(source.presentationId)).toEqual(before)
  })

  it('lar kopiens filer overleve at originalen slettes', async () => {
    // The sharpest form of "self-contained": files belong to a presentation and
    // are deleted with it, so a copy that pointed at the original's files would
    // be one deletion away from a deck of missing pictures.
    const context = freshContext()
    const source = await filledDeck(context)
    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )
    const stored = await context.repository.loadPresentation(copy.presentationId)

    expectOk(await call(context, 'delete_presentation', { presentationId: source.presentationId }))

    expect(await context.repository.getAsset(source.assetId)).toBeNull()
    expect(await context.repository.getAsset(stored.assets[0].id)).not.toBeNull()
    expect((await context.repository.loadPresentation(copy.presentationId)).assets).toHaveLength(1)
  })

  it('tar imot et navn på kopien, så en variant ikke trenger et ekstra kall', async () => {
    const context = freshContext()
    const deck = await deckIn(context, 'Grunnlag')

    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', {
        presentationId: deck.id,
        title: 'Variant for styret',
      }),
    )
    expect(copy.title).toBe('Variant for styret')
    expect((await context.repository.loadPresentation(deck.id)).title).toBe('Grunnlag')
  })

  it('arver aldri mappen som en overraskelse: kopien blir liggende der originalen lå', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const folder = await folderIn(context, 'Kundemøter')
    await call(context, 'move_presentation', { presentationId: deck.id, folderId: folder.id })

    const copy = expectOk(
      await call<PresentationView>(context, 'duplicate_presentation', { presentationId: deck.id }),
    )
    expect(copy.folderId).toBe(folder.id)
  })

  it('avviser en gammel revisjon med CONFLICT, og kopierer ingenting', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const stale = presentationRevision(deck)
    await call(context, 'set_presentation_title', { presentationId: deck.id, title: 'Endret' })

    const refused = expectErr(
      await call(context, 'duplicate_presentation', {
        presentationId: deck.id,
        expectedRevision: stale,
      }),
    )
    expect(refused.code).toBe('CONFLICT')
    expect(await context.repository.listPresentations()).toHaveLength(1)
  })

  it('sier PRESENTATION_NOT_FOUND for en kilde som ikke finnes', async () => {
    const context = freshContext()
    expect(expectErr(await call(context, 'duplicate_presentation', { presentationId: 'p_nei' })).code).toBe(
      'PRESENTATION_NOT_FOUND',
    )
  })

  it('avviser en kopi der en kildefil forsvant etter revisjonssjekken', async () => {
    // The race the rollback below cannot see: the source was consistent when it
    // was read, and a concurrent `delete_asset` or `delete_presentation` took
    // the file out before the bytes were copied. Skipping it would answer `ok`
    // with a deck whose document lists a file that was never stored — a picture
    // that can never load — so it is a refusal, and the copy goes back out.
    const context = freshContext()
    const source = await filledDeck(context)
    const gone = overriding(context.repository, {
      getAsset: (id) =>
        id === source.assetId ? Promise.resolve(null) : context.repository.getAsset(id),
    })

    const refused = expectErr(
      await call({ ...context, repository: gone }, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )
    expect(refused.code).toBe('STORAGE_FAILED')
    expect(refused.message).toContain('figur.png')

    // Nothing survived the attempt: no second presentation, and no files under
    // one. The original is untouched.
    expect(await context.repository.listPresentations()).toHaveLength(1)
    expect(await context.repository.deleteOrphanAssets()).toBe(0)
    expect(await context.repository.getAsset(source.assetId)).not.toBeNull()
  })

  it('etterlater ingen halv kopi når filene ikke kom med', async () => {
    const context = freshContext()
    const source = await filledDeck(context)
    const failing = overriding(context.repository, {
      putAsset: () => Promise.reject(new RepositoryError('Filen kunne ikke lagres.')),
    })

    const refused = expectErr(
      await call({ ...context, repository: failing }, 'duplicate_presentation', {
        presentationId: source.presentationId,
      }),
    )
    expect(refused.code).toBe('STORAGE_FAILED')
    // A copy whose files did not all make it is worse than no copy: the library
    // must not grow a half-copied presentation on the next refresh.
    expect(await context.repository.listPresentations()).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * delete_presentation
 * ------------------------------------------------------------------ */

describe('delete_presentation', () => {
  it('sletter presentasjonen, og svarer uten en revisjon å skrive mot', async () => {
    const context = freshContext()
    const deck = await deckIn(context)

    const deleted = expectOk(
      await call<DeletedPresentation>(context, 'delete_presentation', { presentationId: deck.id }),
    )
    expect(deleted).toEqual({ presentationId: deck.id, deleted: true })
    // Every other mutation reports the reading it produced. There is no document
    // left to have one, and inventing a field for it would be a lie an agent
    // could write against.
    expect(deleted).not.toHaveProperty('revision')
    expect(await context.repository.listPresentations()).toEqual([])
  })

  it('tar filene med seg, både radene og bytene', async () => {
    const context = freshContext()
    const source = await filledDeck(context)

    expectOk(await call(context, 'delete_presentation', { presentationId: source.presentationId }))

    expect(await context.repository.listAssets(source.presentationId)).toEqual([])
    expect(await context.repository.getAsset(source.assetId)).toBeNull()
    // And nothing is left for the sweep to find, which is what "no half-deleted
    // presentation" means in the store rather than in the answer.
    expect(await context.repository.deleteOrphanAssets()).toBe(0)
  })

  it('sletter en publisert presentasjon uten å be om sharing:write', async () => {
    // Deleting takes a public link down, which is the safe direction. Requiring
    // the publishing scope would mean a token that may delete every deck cannot
    // delete the one that happens to be shared.
    const sharing = new MemorySharing()
    const context = freshContext(sharing)
    const deck = await deckIn(context)
    const published = expectOk(
      await call<{ shared: boolean; token: string | null }>(context, 'set_sharing', {
        presentationId: deck.id,
        shared: true,
      }),
    )
    expect(published.shared).toBe(true)

    expectOk(await call(context, 'delete_presentation', { presentationId: deck.id }))
    expect(await context.repository.listPresentations()).toEqual([])
  })

  it('sier PRESENTATION_NOT_FOUND i stedet for å lykkes stille', async () => {
    // Both stores delete by id and do not mind an id that is not there, so this
    // is the operation's own answer: an agent must be able to tell "it is gone
    // now" from "it was never there".
    const context = freshContext()
    expect(expectErr(await call(context, 'delete_presentation', { presentationId: 'p_nei' })).code).toBe(
      'PRESENTATION_NOT_FOUND',
    )
  })

  it('avviser en gammel revisjon med CONFLICT, og sletter ingenting', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const stale = presentationRevision(deck)
    await call(context, 'set_presentation_title', { presentationId: deck.id, title: 'Endret' })

    const refused = expectErr(
      await call(context, 'delete_presentation', {
        presentationId: deck.id,
        expectedRevision: stale,
      }),
    )
    expect(refused.code).toBe('CONFLICT')
    expect(await context.repository.listPresentations()).toHaveLength(1)
  })

  it('sletter mot lesingen den selv tok, også uten en oppgitt revisjon', async () => {
    // The write is guarded whether or not the caller asked for it: two calls can
    // both pass their own precondition, and then it is the store that has to
    // stop the second one. Here the document moves between this operation's load
    // and its delete, which is the race that guard exists for.
    const context = freshContext()
    const deck = await deckIn(context)
    const repository = context.repository
    const racing = overriding(repository, {
      loadPresentation: async (id) => {
        const loaded = await repository.loadPresentation(id)
        await repository.savePresentation({ ...loaded, title: 'Skrevet av en annen' })
        return loaded
      },
    })

    const refused = expectErr(
      await call({ ...context, repository: racing }, 'delete_presentation', {
        presentationId: deck.id,
      }),
    )
    expect(refused.code).toBe('CONFLICT')
    expect(await repository.listPresentations()).toHaveLength(1)
  })

  it('gjør en lagringsfeil om til STORAGE_FAILED', async () => {
    const context = freshContext()
    const deck = await deckIn(context)
    const failing = overriding(context.repository, {
      deletePresentation: () => Promise.reject(new RepositoryError('Basen svarer ikke.')),
    })

    const refused = expectErr(
      await call({ ...context, repository: failing }, 'delete_presentation', {
        presentationId: deck.id,
      }),
    )
    expect(refused.code).toBe('STORAGE_FAILED')
    expect(await context.repository.listPresentations()).toHaveLength(1)
  })
})
