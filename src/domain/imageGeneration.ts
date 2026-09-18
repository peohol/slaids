/**
 * The binding between one planned picture and the file that was generated for it.
 *
 * `imagePlan.ts` says what to make. `imageDeposit.ts` takes the finished files
 * back. This module is the only thing that can answer the question in between:
 * **is this file the file that was made for this planned picture?**
 *
 * It exists because of a failure where every other step behaved correctly.
 * Slaids planned nine pictures in slide order — såing, høsting, røyting,
 * bråking, hegling, spinning, veving, vasking, ferdig lin — the image generator
 * produced them in the order 1, 3, 9, 6, 5, 8, 2, 4, 7, and the files were then
 * named `1`‥`9` **by the order they came back in**. Seven of nine pictures
 * landed on a slide they were never made for, and nothing anywhere could see
 * it: the plan was right, the count was right, the names were well-formed, and
 * the deposit placed exactly what it was handed.
 *
 * The single rule that follows from that, and that everything here enforces:
 *
 *   **Generation order is never identity.**
 *
 * A picture is identified by the plan entry it was generated from —
 * `imagePlanItemId` — and by nothing else. The number is what the *file* is
 * called, and it is read off that entry rather than counted out as the files
 * arrive.
 *
 * So a delivery that came from an agent states its bindings, one record per
 * file, and `checkGeneratedImages` compares them against the plan the deck
 * actually holds. That is a check a prompt cannot replace: it does not ask the
 * agent whether it kept the order, it asks whether the set of bindings it
 * wrote down is the set of pictures the deck planned.
 *
 * Two flows, and only one of them has records:
 *
 *  - **agent-generated** — the bindings are authoritative, and the number is
 *    the file name derived from them. A conflict stops the deposit.
 *  - **manual upload** — a person saving «bilde 3» as `3.png` is the binding,
 *    and there is nothing to cross-check it against. The number in the file
 *    name stays authoritative there, exactly as before. See `reviewDeposit`.
 *
 * ## What the bindings reach, and what they do not
 *
 * Records alone are metadata about files, and metadata can be consistent about
 * the wrong files. Swap the *contents* of `1.png` and `2.png` and leave every
 * name and every record untouched: ids, numbers, zones and names all still
 * agree, and two pictures are still on the wrong slides. So a record **may**
 * carry `contentHash` — a SHA-256 of the bytes the generation response actually
 * returned — and where one is there, the deposit compares it against the bytes
 * of the file it was handed, before anything is sanitised, optimised or
 * inserted.
 *
 * Three limits on that, and they are stated rather than glossed:
 *
 *  - **It is an extra check, never a requirement.** The ordinary host cannot
 *    reach the bytes of what its own image tool produced — ChatGPT hands back a
 *    picture, not a buffer — so a flow that could not go on without a digest
 *    was a flow that could not be finished at all. A delivery without digests
 *    is a legal, self-reported delivery: checked against the plan, not against
 *    a file, and described that way.
 *  - **A digest that is there has to be taken from the generation response
 *    itself**, the moment that one file comes back. A digest computed later,
 *    from a folder of finished files, fingerprints whatever mix-up already
 *    happened and certifies it.
 *  - **It is file integrity, never motif control.** A matching digest says
 *    «this is the file that came back for that entry». It cannot say the
 *    picture shows the right thing — nothing here can, because Slaids never
 *    looks at the picture. `ImageBindingCheck` is named for what it covers so
 *    the two are not quietly conflated.
 *
 * See `reviewDeposit` and the deposit dialog for what each of the two
 * deliveries is allowed to be called.
 */

import { z } from 'zod'
import { MAX_PLANNED_IMAGES } from './constants'
import {
  CONTENT_HASH_PATTERN,
  generatedImageRecordSchema,
  type GeneratedImageRecord,
} from './imageBinding'
import { imagePanelOf } from './content'
import { collectLeaves } from './layout'
import { imageFileNumber, imageZoneKey, resolveImagePlan } from './imagePlan'
import { err, ok, type Result } from './result'
import type { Presentation } from './types'

/* ------------------------------------------------------------------ *
 * One generated file, and what it was generated for
 * ------------------------------------------------------------------ */

/** Re-exported so a caller reading about bindings finds the shape beside the checks. */
export type { GeneratedImageRecord } from './imageBinding'

/**
 * One file as it was actually handed over.
 *
 * The digest is over the bytes the deposit was given — before sanitising and
 * before optimisation, which is the point: those rewrite an SVG and would make
 * a correct file look like a substituted one. `AssetRef.contentHash` is over the
 * *stored* bytes and answers a different question (deduplication), so it cannot
 * stand in for this.
 */
export interface DeliveredImageFile {
  fileName: string
  /**
   * The digest, when the bytes have been read. Absent means nobody looked.
   *
   * Optional because reading bytes is work with a purpose only when there is
   * something to compare them against: a manual upload has no digests to check
   * against and must not be made to wait for a hash it will never use. Absent
   * on a file whose record *does* carry a digest, the comparison simply cannot
   * be made — which `imageBindingCheck` reports as unchecked rather than
   * passing off as checked.
   */
  contentHash?: string
}

/**
 * How far a delivery's binding was actually checked against the files.
 *
 *  - `'file-checked'` — every record carried a digest of the bytes its
 *    generation response returned, so the binding can be, and is, compared
 *    against the files themselves.
 *  - `'unchecked'` — at least one record carried none. The metadata may be
 *    perfectly consistent and still describe the wrong files.
 *
 * `'unchecked'` is the ordinary case, not a fault: most hosts cannot hash what
 * their image tool produced. It says what is known, so the browser's deposit
 * can ask a person to confirm what a machine could not.
 *
 * Named for what it covers. Neither value says the picture shows the right
 * motif: that is a judgement about an image, and Slaids never sees one.
 */
export type ImageBindingCheck = 'file-checked' | 'unchecked'

/**
 * What a delivery reported about its own bytes, as the agent boundary says it.
 *
 * The same question `imageBindingCheck` asks of the records — derived from it
 * rather than asked again — under the names that are true *there*. In the
 * browser a digest is compared against a file, so «file-checked» is a check
 * that ran. At the agent boundary nothing has been compared with anything:
 * Slaids never sees the bytes, so a digest is a string the caller supplied and
 * the honest word for the whole answer is «reported».
 */
export type ImageDeliveryReporting = 'self-reported' | 'hash-reported'

export function deliveryReporting(
  records: readonly GeneratedImageRecord[],
): ImageDeliveryReporting {
  return imageBindingCheck(records) === 'file-checked' ? 'hash-reported' : 'self-reported'
}

/**
 * Whether a delivery can be checked against its own files at all.
 *
 * Every record, not most: one picture whose binding nobody can check is one
 * picture that may be on the wrong slide, and a delivery that called itself
 * file-checked on the strength of the other eight would be worse than one that
 * claimed nothing. An empty delivery is `'unchecked'` for the same reason —
 * there is nothing there to have checked.
 */
export function imageBindingCheck(
  records: readonly GeneratedImageRecord[],
  delivered?: readonly DeliveredImageFile[],
): ImageBindingCheck {
  if (records.length === 0) return 'unchecked'
  const digested = delivered && new Map(delivered.map((file) => [baseName(file.fileName), file]))
  for (const record of records) {
    if (record.contentHash === undefined) return 'unchecked'
    if (!CONTENT_HASH_PATTERN.test(record.contentHash)) return 'unchecked'
    /* Both sides or neither. A record that carries a digest for a file nobody
       hashed is not a checked binding — it is a binding that *could* have been
       checked, which is a different sentence and must not be said as this one. */
    if (digested && digested.get(baseName(record.fileName))?.contentHash === undefined) {
      return 'unchecked'
    }
  }
  return 'file-checked'
}

/**
 * Everything an agent hands over with the files: which deck, and which bindings.
 *
 * The deck's id is part of it because a set of files is only meaningful against
 * one presentation, and «nine well-formed pictures for a different deck» is
 * otherwise indistinguishable from nine correct ones.
 */
export interface ImageGenerationManifest {
  presentationId: string
  images: GeneratedImageRecord[]
}

/* ------------------------------------------------------------------ *
 * What the plan expects
 * ------------------------------------------------------------------ */

/**
 * The manifest the deck's current plan would accept, entry by entry.
 *
 * Derived from `resolveImagePlan`, so it is the same numbering the placeholder
 * captions, the brief and the deposit slots use. The file extension is the one
 * thing it cannot know — that is a fact about the file the generator produced —
 * so a name is left as a stem plus whatever extension the file carries, and
 * `checkGeneratedImages` compares the *number* the name claims rather than the
 * string.
 */
export function expectedGeneratedImages(
  presentation: Presentation,
): Omit<GeneratedImageRecord, 'fileName' | 'contentHash'>[] {
  return resolveImagePlan(presentation).map((image) => ({
    imagePlanItemId: image.id,
    number: image.number,
    slideId: image.plan.slideId,
    nodeId: image.plan.nodeId,
  }))
}

/**
 * Every picture zone in the deck that currently holds a file, by zone.
 *
 * Read off the slides rather than out of a list, for the same reason
 * `depositSlots` is: the slides are where a zone can stop existing, and a list
 * beside them would keep naming one that is gone.
 */
function filledImageZones(presentation: Presentation): Set<string> {
  const filled = new Set<string>()
  for (const slide of presentation.slides) {
    if (slide.kind !== 'content') continue
    for (const leaf of collectLeaves(slide.root)) {
      const panel = leaf.content ? imagePanelOf(leaf.content) : null
      if (panel?.assetId) filled.add(imageZoneKey(slide.id, leaf.id))
    }
  }
  return filled
}

/**
 * The bindings that say a picture in the deck was made for an order the deck no
 * longer has.
 *
 * The distinction this exists to keep: a picture zone with a file in it and *no*
 * record is a file of unknown provenance — a manual upload, an older deck,
 * something a person put there — and there is nothing to say about it. A zone
 * with a file and a record whose entry has since been rewritten is different in
 * kind: the deck knows that picture was ordered differently than it is ordered
 * now.
 *
 * That difference is why this is derived rather than inferred from «the plan no
 * longer lists this zone». An entry's `imagePlanItemId` covers its whole order,
 * so rewriting a motif or the shared context is enough to make a record stale —
 * and *emptying the plan does not make it any less true*. Keeping these records
 * through a plan rewrite is what stops «rewrite the plan without the zones that
 * are done» from being a way to launder a mismatch into a finished deck, which
 * is exactly what it was before this existed.
 */
export function staleGeneratedImages(presentation: Presentation): GeneratedImageRecord[] {
  const records = presentation.generatedImages ?? []
  if (records.length === 0) return []
  const planned = new Set(resolveImagePlan(presentation).map((image) => image.id))
  const filled = filledImageZones(presentation)
  return records.filter(
    (record) =>
      !planned.has(record.imagePlanItemId) &&
      filled.has(imageZoneKey(record.slideId, record.nodeId)),
  )
}

/** The bindings that answer for the plan the deck holds now. */
export function plannedGeneratedImages(presentation: Presentation): GeneratedImageRecord[] {
  const records = presentation.generatedImages ?? []
  if (records.length === 0) return []
  const planned = new Set(resolveImagePlan(presentation).map((image) => image.id))
  return records.filter((record) => planned.has(record.imagePlanItemId))
}

/* ------------------------------------------------------------------ *
 * The checks
 * ------------------------------------------------------------------ */

/**
 * Why a set of generated files cannot be bound to the deck's plan.
 *
 *  - `WRONG_PRESENTATION` — the records were made for another deck.
 *  - `MANIFEST_UNREADABLE` — the file carrying the bindings could not be read.
 *                       Deliberately its own code: «no manifest» is a manual
 *                       upload, and collapsing the two would let a broken file
 *                       fall back to the file names, which is the original bug.
 *  - `PLAN_CHANGED`   — the record names a zone the plan still has, but under a
 *                       different id: the entry's number or motif changed after
 *                       the picture was generated, so the file is for a picture
 *                       the deck no longer plans.
 *  - `UNKNOWN_ITEM`   — the id matches no entry, and no zone explains it.
 *  - `DUPLICATE_ITEM` — two files claim the same plan entry.
 *  - `MISSING_ITEM`   — a planned entry has no file.
 *  - `NUMBER_MISMATCH`— the record's number is not the entry's number.
 *  - `DUPLICATE_NUMBER` — two files claim the same number.
 *  - `ZONE_MISMATCH`  — the record's slide or zone is not the entry's.
 *  - `FILE_NAME_MISMATCH` — the file is not called what its number says.
 *  - `FILE_MISSING`   — a record names a file that was not handed over.
 *  - `FILE_UNACCOUNTED` — a file was handed over that no record claims.
 *  - `CONTENT_MISMATCH` — the file's own bytes are not the bytes the generation
 *                       response returned for that entry. The one code that
 *                       reaches past the metadata: it is what catches two files
 *                       whose contents were swapped under unchanged names.
 */
export type ImageBindingIssueCode =
  | 'WRONG_PRESENTATION'
  | 'MANIFEST_UNREADABLE'
  | 'PLAN_CHANGED'
  | 'UNKNOWN_ITEM'
  | 'DUPLICATE_ITEM'
  | 'MISSING_ITEM'
  | 'NUMBER_MISMATCH'
  | 'DUPLICATE_NUMBER'
  | 'ZONE_MISMATCH'
  | 'FILE_NAME_MISMATCH'
  | 'FILE_MISSING'
  | 'FILE_UNACCOUNTED'
  | 'CONTENT_MISMATCH'

export interface ImageBindingIssue {
  code: ImageBindingIssueCode
  message: string
  /** Which binding it is about, when it is about one. */
  imagePlanItemId?: string
  number?: number
  fileName?: string
}

/**
 * Whether every planned picture is bound to exactly one file, and the right one.
 *
 * The whole check, in one pass, and deliberately *total*: it reports everything
 * wrong rather than the first thing wrong, because an agent that has to fix one
 * binding per round trip will regenerate pictures it did not need to.
 *
 * `delivered` is what was actually handed over, when that is known — the deposit
 * dialog holds the files, an agent reporting its own work does not. Left out,
 * the records are checked against the plan alone, and that is all an agent can
 * ask for. Passed, two further things become checkable and are the only reason
 * this check reaches past metadata at all: that every record has a file and
 * every file has a record, and that each file's **own bytes** are the bytes its
 * generation response returned.
 *
 * An empty list means the set may be deposited. Anything in it means it may
 * not: this is a gate, not advice. What an empty list does *not* mean is that
 * the binding was verified against the files — a delivery with no digests
 * passes every check there is to run here and is still `'unchecked'`. Callers
 * report `imageBindingCheck` alongside, never instead.
 */
export function checkGeneratedImages(
  presentation: Presentation,
  records: readonly GeneratedImageRecord[],
  delivered?: readonly DeliveredImageFile[],
): ImageBindingIssue[] {
  const issues: ImageBindingIssue[] = []
  const expected = expectedGeneratedImages(presentation)
  const byId = new Map(expected.map((item) => [item.imagePlanItemId, item]))
  /* The same entries addressed by zone, so an id that no longer resolves can be
     told apart from one that never did. A plan whose numbering moved, or whose
     motif was rewritten, produces new ids for the very same zones — and «the
     plan changed under your pictures» and «this id is not from this deck» are
     two different things for whoever has to fix it. */
  const byZone = new Map(expected.map((item) => [imageZoneKey(item.slideId, item.nodeId), item]))

  const idCounts = countBy(records, (record) => record.imagePlanItemId)
  const numberCounts = countBy(records, (record) => record.number)
  const seenIds = new Set<string>()

  for (const record of records) {
    const where = { imagePlanItemId: record.imagePlanItemId, number: record.number, fileName: record.fileName }
    const item = byId.get(record.imagePlanItemId)

    if (!item) {
      const sameZone = byZone.get(imageZoneKey(record.slideId, record.nodeId))
      issues.push(
        sameZone
          ? {
              code: 'PLAN_CHANGED',
              message: `Bildet med id ${record.imagePlanItemId} ble generert for en bildeplanoppføring som har endret seg etterpå – sonen er nå oppføring ${sameZone.number} med id ${sameZone.imagePlanItemId}. Hent bildeplanen på nytt og generer dette bildet om igjen.`,
              ...where,
            }
          : {
              code: 'UNKNOWN_ITEM',
              message: `Ingen oppføring i bildeplanen har id ${record.imagePlanItemId}. Bildet kan ikke plasseres.`,
              ...where,
            },
      )
      continue
    }

    if ((idCounts.get(record.imagePlanItemId) ?? 0) > 1) {
      // Reported once per id rather than once per file: two files for one
      // picture is one problem, and whoever fixes it removes one file.
      if (!seenIds.has(record.imagePlanItemId)) {
        seenIds.add(record.imagePlanItemId)
        issues.push({
          code: 'DUPLICATE_ITEM',
          message: `To bilder er registrert for bildeplanoppføring ${item.number} (${record.imagePlanItemId}). Behold ett av dem.`,
          ...where,
        })
      }
      continue
    }

    if (record.number !== item.number) {
      issues.push({
        code: 'NUMBER_MISMATCH',
        message: `Bildet for oppføring ${item.number} er registrert som nummer ${record.number}. Nummeret kommer fra bildeplanen, ikke fra genereringsrekkefølgen.`,
        ...where,
      })
      continue
    }

    if ((numberCounts.get(record.number) ?? 0) > 1) {
      issues.push({
        code: 'DUPLICATE_NUMBER',
        message: `To bilder er registrert som nummer ${record.number}. Hvert nummer skal forekomme nøyaktig én gang.`,
        ...where,
      })
      continue
    }

    if (record.slideId !== item.slideId || record.nodeId !== item.nodeId) {
      issues.push({
        code: 'ZONE_MISMATCH',
        message: `Bildet for oppføring ${item.number} peker på en annen sone enn bildeplanen: planen sier ${item.slideId}/${item.nodeId}, bildet sier ${record.slideId}/${record.nodeId}.`,
        ...where,
      })
      continue
    }

    if (imageFileNumber(record.fileName) !== item.number) {
      issues.push({
        code: 'FILE_NAME_MISMATCH',
        message: `Filen til oppføring ${item.number} heter «${record.fileName}». Den skal hete ${item.number} og filendelsen til formatet den har.`,
        ...where,
      })
    }
  }

  for (const item of expected) {
    if (idCounts.has(item.imagePlanItemId)) continue
    issues.push({
      code: 'MISSING_ITEM',
      message: `Bilde ${item.number} (${item.imagePlanItemId}) er ikke generert. Generer det enkeltvis før bildene deponeres.`,
      imagePlanItemId: item.imagePlanItemId,
      number: item.number,
    })
  }

  if (delivered) issues.push(...fileIssues(records, delivered))
  return issues
}

/**
 * The records against the files that actually arrived, contents included.
 *
 * Three directions, because they fail differently. A record with no file is a
 * picture somebody believes was delivered; a file no record claims is a picture
 * nobody can place; and a file whose bytes are not the bytes that came back for
 * that entry is the one failure every other check in this module is blind to —
 * the names agree, the ids agree, the numbers agree, and the pictures are
 * swapped.
 *
 * Addressing is still by name, because that is what a record names. The digest
 * is what decides whether the file behind that name is the right one, so the
 * two are not alternatives: the name finds the file and the bytes confirm it.
 */
function fileIssues(
  records: readonly GeneratedImageRecord[],
  delivered: readonly DeliveredImageFile[],
): ImageBindingIssue[] {
  const issues: ImageBindingIssue[] = []
  const byName = new Map(delivered.map((file) => [baseName(file.fileName), file]))
  const claimed = new Set(records.map((record) => baseName(record.fileName)))

  for (const record of records) {
    const file = byName.get(baseName(record.fileName))
    if (!file) {
      issues.push({
        code: 'FILE_MISSING',
        message: `Filen «${record.fileName}» er registrert for bilde ${record.number}, men ligger ikke blant filene som er levert.`,
        imagePlanItemId: record.imagePlanItemId,
        number: record.number,
        fileName: record.fileName,
      })
      continue
    }
    /* No digest on the record is not a mismatch — it is a binding nobody can
       check, which `imageBindingCheck` reports as such. Treating it as a
       failure here would refuse every host that cannot reach its own bytes;
       treating it as a pass would be the false reassurance this exists to
       remove. It is neither: it is unchecked, and said out loud. */
    if (record.contentHash === undefined) continue
    /* Nothing read on this side either: `imageBindingCheck` says so, and
       inventing a mismatch here would refuse a file for not having been
       looked at. */
    if (file.contentHash === undefined) continue
    if (record.contentHash === file.contentHash) continue
    issues.push({
      code: 'CONTENT_MISMATCH',
      message: `Filen «${record.fileName}» inneholder ikke de bytene bildegeneratoren returnerte for bilde ${record.number}. Filen er byttet ut eller forvekslet med en annen etter genereringen, så bildene kan ikke settes inn.`,
      imagePlanItemId: record.imagePlanItemId,
      number: record.number,
      fileName: record.fileName,
    })
  }
  for (const file of delivered) {
    if (claimed.has(baseName(file.fileName))) continue
    issues.push({
      code: 'FILE_UNACCOUNTED',
      message: `Filen «${file.fileName}» hører ikke til noen av de genererte bildene. Den kan ikke plasseres.`,
      fileName: file.fileName,
    })
  }
  return issues
}

/** The last segment of a path, since a dropped folder hands over paths. */
function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? ''
}

function countBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, number> {
  const counts = new Map<K, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

/* ------------------------------------------------------------------ *
 * The manifest as a file
 * ------------------------------------------------------------------ */

/**
 * What the file carrying the bindings is called.
 *
 * A fixed name rather than «any `.json` in the drop»: the deposit dialog has to
 * tell a manifest apart from whatever else somebody dragged in, and a rule that
 * guessed would turn an unrelated file into a set of bindings.
 */
export const IMAGE_MANIFEST_FILE_NAME = 'slaids-bilder.json'

/** Whether a dropped file is the manifest. Path segments are ignored. */
export function isImageManifestFileName(fileName: string): boolean {
  return baseName(fileName).toLowerCase() === IMAGE_MANIFEST_FILE_NAME
}

/**
 * The manifest as it arrives: a file a person can edit, so it is validated.
 *
 * A system boundary in the sense `CLAUDE.md` means — the JSON has been out of
 * the process, through a chat window and a download folder — so the shape is
 * asked rather than assumed. The record shape itself is `imageBinding.ts`'s,
 * shared with the copy the document stores, so a binding cannot be legal in one
 * and illegal in the other.
 */
export const imageGenerationManifestSchema = z.object({
  presentationId: z.string().min(1),
  images: z.array(generatedImageRecordSchema).min(1).max(MAX_PLANNED_IMAGES),
})

/**
 * Read a manifest, or say why it cannot be read.
 *
 * A `Result` rather than a throw, because an unreadable manifest is a thing the
 * deposit dialog has to *show* — the user is holding a file and needs to know
 * what is wrong with it — and because «no manifest at all» and «a manifest that
 * does not parse» must never collapse into the same outcome. Falling back to
 * the manual flow on a broken manifest would be the original bug again, with
 * an extra step.
 */
export function parseImageGenerationManifest(text: string): Result<ImageGenerationManifest> {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return err(
      'INVALID_ARGUMENT',
      `«${IMAGE_MANIFEST_FILE_NAME}» er ikke gyldig JSON, så koblingen mellom bildene og bildeplanen kan ikke leses.`,
    )
  }
  const parsed = imageGenerationManifestSchema.safeParse(json)
  if (!parsed.success) {
    return err(
      'INVALID_ARGUMENT',
      `«${IMAGE_MANIFEST_FILE_NAME}» har ikke den formen Slaids venter: ${parsed.error.issues[0]?.message ?? 'ukjent feil'}.`,
    )
  }
  return ok(parsed.data)
}

/**
 * The manifest as text, for an agent to hand over beside the files.
 *
 * Written here rather than by whoever needs one, so the file the deposit reads
 * and the file an agent writes are the same file by construction.
 */
export function composeImageGenerationManifest(manifest: ImageGenerationManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * Whether the manifest is for this deck at all.
 *
 * Asked before the bindings are, and separately, because it is the one mistake
 * that makes every other message meaningless: a manifest for another deck
 * reports nine unknown ids, and the list says nothing about what went wrong.
 */
export function manifestPresentationIssue(
  presentation: Presentation,
  manifest: ImageGenerationManifest,
): ImageBindingIssue | null {
  if (manifest.presentationId === presentation.id) return null
  return {
    code: 'WRONG_PRESENTATION',
    message: `Bildene er registrert for presentasjonen ${manifest.presentationId}, men dette er ${presentation.id}. Filene hører til et annet dekk.`,
  }
}
