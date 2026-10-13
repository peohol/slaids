/**
 * Copy, cut and paste of a whole zone's content.
 *
 * One implementation for every way in — the keyboard in zone mode and the
 * context menu — so the clipboard format, the asset hand-over and the undo step
 * a paste makes are the same however it was asked for. Each takes the zone it
 * is about rather than reading the selection: a menu acts on what was
 * right-clicked, which need not be what was selected.
 */

import { registerAsset, setZoneContent } from '../../domain/commands'
import { findLeaf } from '../../domain/layout'
import { ok } from '../../domain/result'
import type { NodeId } from '../../domain/types'
import { readStructuralClipboard, writeStructuralClipboard } from '../../state/clipboard'
import { domFitCheckers } from '../../state/measure'
import { materializeClipboardContent } from '../../state/pasteAssets'
import { useEditorStore } from '../../state/store'
import { notify } from '../../state/toast'

/** The zone's content on the current slide, or `null` when it has none. */
function contentOf(nodeId: NodeId) {
  const state = useEditorStore.getState()
  const slide = state.currentContentSlide()
  if (!state.presentation || !slide) return null
  const content = findLeaf(slide.root, nodeId)?.content ?? null
  return content ? { presentation: state.presentation, slide, content } : null
}

export function copyZoneToClipboard(nodeId: NodeId): boolean {
  const found = contentOf(nodeId)
  if (!found) return false
  writeStructuralClipboard(found.content, found.presentation.assets)
  notify.info('Innholdet ble kopiert.')
  return true
}

export function cutZoneToClipboard(nodeId: NodeId): boolean {
  const found = contentOf(nodeId)
  if (!found) return false
  writeStructuralClipboard(found.content, found.presentation.assets)
  return useEditorStore.getState().runStructural('cut-content', (presentation) =>
    setZoneContent(presentation, {
      slideId: found.slide.id,
      nodeId,
      content: null,
      replace: true,
      replacedDisposition: 'delete',
    }),
  )
}

/**
 * Paste into an empty zone.
 *
 * The system clipboard is read first so a copy survives a reload or reaches
 * another tab; it falls back to the in-memory payload.
 */
export async function pasteClipboardIntoZone(nodeId: NodeId): Promise<void> {
  const before = useEditorStore.getState()
  const slideId = before.currentContentSlide()?.id
  const presentationId = before.presentation?.id
  if (!slideId || !presentationId) return
  const payload = await readStructuralClipboard()
  if (!payload) {
    notify.warning('Utklippstavlen er tom.')
    return
  }
  const live = useEditorStore.getState().presentation
  if (!live || live.id !== presentationId) return
  // Copy any referenced assets into this presentation first, so a paste
  // across presentations does not depend on the source surviving.
  const { content, refs, missing } = await materializeClipboardContent(payload, live)
  if (missing.length > 0) {
    notify.warning(
      missing.length === 1
        ? `Filen «${missing[0].name}» finnes ikke lenger, så den ble ikke med.`
        : `${missing.length} filer finnes ikke lenger, så de ble ikke med.`,
    )
  }
  // Content and the metadata for the files it points at are one commit:
  // undone separately, the document would reference assets the
  // presentation no longer lists, and export would quietly drop them.
  useEditorStore.getState().runStructural('paste-content', (presentation) => {
    const placed = setZoneContent(presentation, { slideId, nodeId, content, ...domFitCheckers })
    if (!placed.ok) return placed
    let next = placed.value.presentation
    for (const ref of refs) {
      const registered = registerAsset(next, ref)
      if (!registered.ok) return registered
      next = registered.value
    }
    return ok({ ...placed.value, presentation: next })
  })
}
