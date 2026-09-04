/**
 * Local `.slaids` backup format.
 *
 * Browser storage can be evicted, so a presentation must be exportable to a
 * single file and importable again — validated and migrated on the way in.
 *
 *   manifest.json           format + version
 *   presentations/<id>.json presentation documents
 *   templates.json          layout-only templates
 *   assets/index.json       asset metadata, including owning presentation
 *   assets/<id>             raw asset bytes
 *
 * An archive is a file from outside Slaids, whoever made it. The documents in
 * it are validated and migrated, and the *files* in it go through
 * `domain/assetIngress.ts` — the same door the editor's upload dialog and the
 * agent's `upload_asset` stand behind. An old backup must not be a way around
 * the SVG rule: a `.slaids` handed to somebody is exactly as trustworthy as an
 * `.svg` handed to them, and both are opened by the same parser.
 *
 * Raster files are kept byte for byte, with the size the archive recorded when
 * they were first stored (`raster: 'caller'`). Re-deriving it would make a
 * picture that has been in a deck for a year unimportable for a reason the
 * owner cannot act on, and the bytes already came through this door once. SVG
 * gets no such benefit of the doubt: markup is executable content, the
 * sanitiser is cheap, and what is stored is what comes back out of it.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { acceptAsset, type AcceptedAsset } from '../domain/assetIngress'
import { migratePresentation } from '../domain/migrations'
import { describeError } from '../domain/result'
import { newAssetId, newPresentationId, newTemplateId } from '../domain/ids'
import { remapAssetIds } from '../domain/docs'
import { slaidsFileManifestSchema, validateLayoutTemplate } from '../domain/schema'
import type { AssetRef, LayoutTemplate, Presentation } from '../domain/types'
import { RepositoryConflictError, type SlaidsRepository } from './repository'
import { blobToBytes, bytesToBlob } from './blob'

export const SLAIDS_FILE_EXTENSION = '.slaids'
export const SLAIDS_FILE_MIME = 'application/x-slaids+zip'

interface AssetIndexEntry extends AssetRef {
  presentationId: string
  file: string
}

function assetFileName(ref: AssetRef): string {
  const extension = ref.isVector ? 'svg' : (ref.mimeType.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '')
  return `assets/${ref.id}.${extension}`
}

/**
 * The archive's metadata about a file, corrected by what the door accepted.
 *
 * The index says what an entry claims to be; the bytes decide. An entry
 * claiming `image/png` for a document that turns out to be SVG markup is
 * sanitised as the SVG it is and stored under the type it really has — the type
 * a file is served with is what makes it active content, so it can never be the
 * archive's word for it. The size follows the same rule: an SVG brings the one
 * read out of the document while it was sanitised, and a raster keeps the one
 * that was measured the day it was first stored.
 */
function acceptedRef(ref: AssetRef, file: AcceptedAsset): AssetRef {
  return {
    ...ref,
    mimeType: file.mimeType,
    isVector: file.isVector,
    byteSize: file.bytes.byteLength,
    ...(file.size ?? {}),
  }
}

export interface ExportOptions {
  presentationIds: string[]
  includeTemplates?: boolean
}

/** Build a `.slaids` archive as a Blob. */
export async function exportSlaidsArchive(
  repository: SlaidsRepository,
  options: ExportOptions,
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {}
  const assetIndex: AssetIndexEntry[] = []

  for (const id of options.presentationIds) {
    const presentation = await repository.loadPresentation(id)
    files[`presentations/${presentation.id}.json`] = strToU8(JSON.stringify(presentation))
    for (const ref of presentation.assets) {
      const stored = await repository.getAsset(ref.id)
      if (!stored) continue
      const file = assetFileName(ref)
      files[file] = await blobToBytes(stored.blob)
      assetIndex.push({ ...ref, presentationId: presentation.id, file })
    }
  }

  if (options.includeTemplates !== false) {
    const templates = await repository.listTemplates()
    files['templates.json'] = strToU8(JSON.stringify(templates))
  }

  files['assets/index.json'] = strToU8(JSON.stringify(assetIndex))
  files['manifest.json'] = strToU8(
    JSON.stringify({
      format: 'slaids-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      presentationCount: options.presentationIds.length,
    }),
  )

  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped as unknown as BlobPart], { type: SLAIDS_FILE_MIME })
}

/** The archive's template, renamed and re-identified as this library's copy. */
function asImportedTemplate(template: LayoutTemplate): LayoutTemplate {
  return { ...template, id: newTemplateId(), name: `${template.name} (importert)` }
}

interface PreparedImport {
  presentation: Presentation
  /** Archive asset id → the id it is stored under. */
  assetMap: Map<string, string>
}

export interface ImportReport {
  importedPresentations: string[]
  importedTemplates: number
  importedAssets: number
  errors: string[]
}

/**
 * Import a `.slaids` archive. Existing presentations are never overwritten:
 * a clashing id is imported as a new copy instead.
 */
export async function importSlaidsArchive(
  repository: SlaidsRepository,
  file: Blob,
): Promise<ImportReport> {
  const report: ImportReport = {
    importedPresentations: [],
    importedTemplates: 0,
    importedAssets: 0,
    errors: [],
  }

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(await blobToBytes(file))
  } catch {
    report.errors.push('Filen kunne ikke pakkes ut. Er den en gyldig .slaids-fil?')
    return report
  }

  const manifestRaw = entries['manifest.json']
  if (!manifestRaw) {
    report.errors.push('Filen mangler manifest.json.')
    return report
  }
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(strFromU8(manifestRaw))
  } catch {
    report.errors.push('Manifestet kunne ikke leses.')
    return report
  }
  const manifest = slaidsFileManifestSchema.safeParse(manifestJson)
  if (!manifest.success) {
    report.errors.push('Manifestet er ugyldig eller fra et ukjent format.')
    return report
  }

  let assetIndex: AssetIndexEntry[] = []
  if (entries['assets/index.json']) {
    try {
      const parsedIndex = JSON.parse(strFromU8(entries['assets/index.json']))
      if (Array.isArray(parsedIndex)) assetIndex = parsedIndex as AssetIndexEntry[]
    } catch {
      report.errors.push('assets/index.json kunne ikke leses; filer hoppes over.')
    }
  }

  const existing = new Set((await repository.listPresentations()).map((summary) => summary.id))
  // The archive carries no folders, so a `folderId` in a document points at
  // this library's folders or at nothing.
  const existingFolders = new Set((await repository.listFolders()).map((folder) => folder.id))

  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith('presentations/') || !path.endsWith('.json')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(strFromU8(bytes))
    } catch {
      report.errors.push(`${path}: kunne ikke leses som JSON.`)
      continue
    }
    const migrated = migratePresentation(parsed)
    if (!migrated.ok) {
      report.errors.push(`${path}: ${migrated.error.message}`)
      continue
    }

    const archived: Presentation = migrated.value
    // A folder from somebody else's library is not a folder here, and remotely
    // the foreign key rejects the reference outright. Keep it only when the
    // folder actually exists; otherwise the presentation lands in the root,
    // where it can be filed by hand. Conjuring an empty folder to satisfy the
    // constraint would invent something the user never made.
    const folderId =
      archived.folderId && existingFolders.has(archived.folderId) ? archived.folderId : null
    const filed: Presentation =
      folderId === archived.folderId ? archived : { ...archived, folderId }
    const owned = assetIndex.filter((entry) => entry.presentationId === filed.id)

    /*
     * Every file the archive brings, taken at the shared door — and taken
     * before a single row is written. Two things follow from doing it here
     * rather than in the write loop below: a rejected figure can never leave a
     * half-written presentation behind it, and the document that gets saved
     * describes the files that will actually be there rather than what the
     * archive claimed about them.
     */
    const accepted = new Map<string, AcceptedAsset>()
    for (const entry of owned) {
      const archivedBytes = entries[entry.file]
      if (!archivedBytes) {
        report.errors.push(`Mangler fildata for «${entry.name}».`)
        continue
      }
      const verdict = acceptAsset(archivedBytes, { raster: 'caller' })
      if (!verdict.ok) {
        // Reported and skipped, exactly as missing file data is: the deck is
        // still worth importing, and the figure that was refused is named so
        // the owner knows which one to replace. Nothing unsafe is stored, and
        // that is the whole point of the rule.
        report.errors.push(`Filen «${entry.name}» ble avvist: ${describeError(verdict.error)}`)
        continue
      }
      accepted.set(entry.id, verdict.value)
    }

    const source: Presentation = {
      ...filed,
      assets: filed.assets.map((ref) => {
        const file = accepted.get(ref.id)
        return file ? acceptedRef(ref, file) : ref
      }),
    }
    const incomingAssetIds = [
      ...new Set([...source.assets.map((ref) => ref.id), ...owned.map((entry) => entry.id)]),
    ]

    /**
     * The ids this entry will actually be written under.
     *
     * Asset rows are keyed by asset id alone, so a taken id has to be remapped
     * even when the presentation itself is new — writing it would otherwise
     * overwrite another presentation's file and hand ownership of it to this
     * import, so deleting the import later would take that file with it. As a
     * copy, nothing from the archive keeps its id.
     */
    const prepare = async (asCopy: boolean): Promise<PreparedImport> => {
      const assetMap = new Map<string, string>()
      if (asCopy) {
        for (const id of incomingAssetIds) assetMap.set(id, newAssetId())
        return {
          presentation: remapAssetIds(
            { ...source, id: newPresentationId(), title: `${source.title} (importert)` },
            assetMap,
          ),
          assetMap,
        }
      }
      const taken = new Set(await repository.existingAssetIds(incomingAssetIds))
      for (const id of incomingAssetIds) {
        if (taken.has(id)) assetMap.set(id, newAssetId())
      }
      return {
        presentation: assetMap.size > 0 ? remapAssetIds(source, assetMap) : source,
        assetMap,
      }
    }

    const clashesLocally = existing.has(source.id)
    let prepared = await prepare(clashesLocally)

    // The presentation is written before its files, so a file always has an
    // owner: remotely, an asset row whose presentation does not exist is
    // rejected outright by the foreign key.
    try {
      await repository.savePresentation(prepared.presentation)
    } catch (error) {
      // A remote store shows a user only their own rows, so an id that looked
      // free can still belong to an account we cannot see — which is what
      // happens when a backup travels between two people. The clash surfaces
      // only here, and the answer is the same as for a visible one: import it
      // as a copy.
      if (clashesLocally || !(error instanceof RepositoryConflictError)) throw error
      prepared = await prepare(true)
      await repository.savePresentation(prepared.presentation)
    }

    const { presentation, assetMap } = prepared
    existing.add(presentation.id)

    try {
      for (const entry of owned) {
        const file = accepted.get(entry.id)
        // Missing or refused, and already reported when it was read.
        if (!file) continue
        const { presentationId: _presentationId, file: _file, ...ref } = entry
        const stored: AssetRef = {
          ...acceptedRef(ref, file),
          id: assetMap.get(ref.id) ?? ref.id,
        }
        await repository.putAsset(presentation.id, stored, bytesToBlob(file.bytes, stored.mimeType))
        report.importedAssets += 1
      }
    } catch (error) {
      // A presentation whose files did not all make it is worse than none: the
      // import reports a failure while a half-imported deck shows up on the
      // next refresh. Take it back out, files first.
      try {
        await repository.deleteAssetsForPresentation(presentation.id)
        await repository.deletePresentation(presentation.id)
      } catch {
        // Nothing more to try; the original error is the one worth reporting.
      }
      existing.delete(presentation.id)
      throw error
    }

    report.importedPresentations.push(presentation.id)
  }

  if (entries['templates.json']) {
    try {
      const parsed = JSON.parse(strFromU8(entries['templates.json']))
      const templates = Array.isArray(parsed) ? (parsed as LayoutTemplate[]) : []
      const existingTemplates = new Set((await repository.listTemplates()).map((entry) => entry.id))
      for (const stored of templates) {
        const validated = validateLayoutTemplate(stored)
        if (!validated.ok || !validated.value) continue
        // The validated value, because validating a template also rewrites
        // ratios saved before they had to be whole numbers.
        const template = validated.value as LayoutTemplate
        // A local template with the same id may have been edited since the
        // backup was taken, so it is never overwritten.
        const clash = existingTemplates.has(template.id)
        let toSave = clash ? asImportedTemplate(template) : template
        try {
          try {
            await repository.saveTemplate(toSave)
          } catch (error) {
            // The same hidden clash presentations have: an id can belong to an
            // account whose rows this user cannot see, and only the write says
            // so. A conflict and nothing else — treating a network failure as a
            // clash would leave two copies of the same template.
            if (clash || !(error instanceof RepositoryConflictError)) throw error
            toSave = asImportedTemplate(template)
            await repository.saveTemplate(toSave)
          }
          existingTemplates.add(toSave.id)
          report.importedTemplates += 1
        } catch (error) {
          report.errors.push(
            `Kunne ikke lagre malen «${template.name}» (${
              error instanceof Error ? error.message : 'ukjent feil'
            }).`,
          )
        }
      }
    } catch {
      report.errors.push('templates.json kunne ikke leses.')
    }
  }

  if (report.importedPresentations.length === 0 && report.errors.length === 0) {
    report.errors.push('Fant ingen presentasjoner i filen.')
  }
  return report
}

export function suggestedFileName(title: string): string {
  const safe = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe || 'slaids'}${SLAIDS_FILE_EXTENSION}`
}
