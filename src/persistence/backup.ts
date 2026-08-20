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
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import { migratePresentation } from '../domain/migrations'
import { newAssetId, newPresentationId } from '../domain/ids'
import { remapAssetIds } from '../domain/docs'
import { slaidsFileManifestSchema, validateLayoutTemplate } from '../domain/schema'
import type { AssetRef, LayoutTemplate, Presentation } from '../domain/types'
import type { SlaidsRepository } from './repository'
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
  const manifest = slaidsFileManifestSchema.safeParse(JSON.parse(strFromU8(manifestRaw)))
  if (!manifest.success) {
    report.errors.push('Manifestet er ugyldig eller fra et ukjent format.')
    return report
  }

  const assetIndex: AssetIndexEntry[] = entries['assets/index.json']
    ? (JSON.parse(strFromU8(entries['assets/index.json'])) as AssetIndexEntry[])
    : []

  const existing = new Set((await repository.listPresentations()).map((summary) => summary.id))

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

    let presentation: Presentation = migrated.value
    const originalId = presentation.id
    const assetMap = new Map<string, string>()

    if (existing.has(presentation.id)) {
      presentation = {
        ...presentation,
        id: newPresentationId(),
        title: `${presentation.title} (importert)`,
      }
      for (const ref of migrated.value.assets) assetMap.set(ref.id, newAssetId())
      presentation = remapAssetIds(presentation, assetMap)
    }

    const owned = assetIndex.filter((entry) => entry.presentationId === originalId)
    for (const entry of owned) {
      const bytesForAsset = entries[entry.file]
      if (!bytesForAsset) {
        report.errors.push(`Mangler fildata for «${entry.name}».`)
        continue
      }
      const { presentationId: _presentationId, file: _file, ...ref } = entry
      const targetId = assetMap.get(ref.id) ?? ref.id
      await repository.putAsset(
        presentation.id,
        { ...ref, id: targetId },
        bytesToBlob(bytesForAsset, ref.mimeType),
      )
      report.importedAssets += 1
    }

    await repository.savePresentation(presentation)
    existing.add(presentation.id)
    report.importedPresentations.push(presentation.id)
  }

  if (entries['templates.json']) {
    try {
      const templates = JSON.parse(strFromU8(entries['templates.json'])) as LayoutTemplate[]
      for (const template of templates) {
        if (!validateLayoutTemplate(template).ok) continue
        await repository.saveTemplate(template)
        report.importedTemplates += 1
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
