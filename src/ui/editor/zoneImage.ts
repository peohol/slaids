import { hasAsset, placeZoneImage, type ContentDisposition } from '../../domain/commands'
import { IMAGE_FILE_EXTENSION_LIST } from '../../domain/imageBytes'
import { findLeaf } from '../../domain/layout'
import { findContentSlide } from '../../domain/presentation'
import { describeError, err } from '../../domain/result'
import type { NodeId, ZoneContent } from '../../domain/types'
import { describeSanitizing, discardUploadedAssets, storeUploadedFile } from '../../state/assetUpload'
import { domFitCheckers } from '../../state/measure'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') ||
    IMAGE_FILE_EXTENSION_LIST.includes(file.name.split('.').at(-1)?.toLowerCase() ?? '')
}

/** Noen nettlesere legger utklippstavlens bilde bare i `items`. */
export function imageTransferFiles(transfer: DataTransfer): File[] {
  const files = Array.from(transfer.files).filter(isImageFile)
  if (files.length > 0) return files
  return Array.from(transfer.items)
    .flatMap((item) => {
      const file = item.kind === 'file' ? item.getAsFile() : null
      return file && (item.type.startsWith('image/') || isImageFile(file)) ? [file] : []
    })
}

export interface ZoneImageRequest {
  file: File
  presentationId: string
  slideId: string
  nodeId: NodeId
  content: ZoneContent | null
}

export function zoneImageRequest(file: File, nodeId: NodeId): ZoneImageRequest | null {
  const state = useEditorStore.getState()
  const slide = state.currentContentSlide()
  const leaf = slide && findLeaf(slide.root, nodeId)
  if (!state.presentation || !slide || !leaf) return null
  return { file, presentationId: state.presentation.id, slideId: slide.id, nodeId, content: leaf.content }
}

function discardIfRejected(assetId: string): void {
  const pending = useEditorStore.getState().pendingDepositBreak
  if (!pending || !hasAsset(pending.presentation, assetId)) {
    void discardUploadedAssets([assetId])
    return
  }
  // En bekreftelse kan holde hele endringen tilbake. Vent til valget er
  // tatt og dokumentet er oppdatert før vi eventuelt fjerner filen.
  const unsubscribe = useEditorStore.subscribe((state) => {
    if (state.pendingDepositBreak === pending) return
    unsubscribe()
    queueMicrotask(() => {
      const live = useEditorStore.getState()
      const documents = [
        live.presentation,
        ...live.past.map((step) => step.presentation),
        ...live.future.map((step) => step.presentation),
      ]
      if (!documents.some((document) => document && hasAsset(document, assetId))) {
        void discardUploadedAssets([assetId])
      }
    })
  })
}

export async function uploadZoneImage(
  request: ZoneImageRequest,
  replacedDisposition?: ContentDisposition,
): Promise<boolean> {
  const { file, presentationId, slideId, nodeId, content } = request
  const presentation = useEditorStore.getState().presentation
  if (!presentation || presentation.id !== presentationId) return false

  let newAssetId: string | null = null
  try {
    const stored = await storeUploadedFile(presentation, file)
    if (!stored.ok) {
      notify.error(describeError(stored.error))
      return false
    }
    const { ref, reused, report } = stored.value
    if (!reused) newAssetId = ref.id
    const state = useEditorStore.getState()
    if (state.presentation?.id !== presentationId) return false
    const placed = state.runStructural('place-asset', (current) => {
      const slide = findContentSlide(current, slideId)
      const leaf = slide && findLeaf(slide.root, nodeId)
      if (!leaf || leaf.content !== content) {
        return err('INVALID_ARGUMENT', 'Sonen ble endret før bildet kunne settes inn.')
      }
      if (reused && !hasAsset(current, ref.id)) {
        return err('ASSET_NOT_FOUND', 'Bildefilen ble fjernet. Sett inn bildet på nytt.')
      }
      return placeZoneImage(current, {
        slideId,
        nodeId,
        asset: ref,
        replacedDisposition,
        ...domFitCheckers,
      })
    })
    if (!placed) {
      const pending = useEditorStore.getState().pendingDepositBreak
      return pending !== null && pending !== state.pendingDepositBreak
    }
    newAssetId = null
    const dropped = describeSanitizing(report)
    if (dropped) notify.warning(dropped)
    if (reused) notify.info('Presentasjonen hadde allerede denne filen, så den ble brukt igjen.')
    return true
  } catch (error) {
    notify.error(error instanceof Error ? error.message : 'Opplastingen feilet.')
    return false
  } finally {
    if (newAssetId) discardIfRejected(newAssetId)
  }
}
