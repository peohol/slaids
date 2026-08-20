/**
 * Structural clipboard for zone mode.
 *
 * This is separate from text editing: it moves one whole `ZoneContent` unit.
 * The payload is versioned and validated on the way back in, and ids are
 * regenerated on paste so a copy can never collide with the original.
 */

import { cloneContentWithNewIds } from '../domain/layout'
import { validateClipboardPayload } from '../domain/schema'
import type { AssetRef, ZoneContent } from '../domain/types'

export const SLAIDS_CLIPBOARD_FORMAT = 'application/x-slaids-content'

interface ClipboardPayload {
  format: typeof SLAIDS_CLIPBOARD_FORMAT
  version: 1
  content: ZoneContent
  assets: AssetRef[]
}

let memory: ClipboardPayload | null = null

export function writeStructuralClipboard(content: ZoneContent, assets: AssetRef[]): void {
  const payload: ClipboardPayload = {
    format: SLAIDS_CLIPBOARD_FORMAT,
    version: 1,
    content,
    assets,
  }
  memory = payload
  // Best effort: also place it on the system clipboard so it survives a reload.
  try {
    void navigator.clipboard?.writeText(JSON.stringify(payload))
  } catch {
    // Clipboard permissions vary; the in-memory copy is the reliable path.
  }
}

/** Returns a fresh copy with new ids, ready to be placed into a zone. */
export async function readStructuralClipboard(): Promise<ClipboardPayload | null> {
  try {
    const text = await navigator.clipboard?.readText()
    if (text) {
      const parsed = validateClipboardPayload(JSON.parse(text))
      if (parsed.ok && parsed.value) return parsed.value as ClipboardPayload
    }
  } catch {
    // Fall through to the in-memory clipboard.
  }
  return memory
}

export function readStructuralClipboardSync(): ClipboardPayload | null {
  return memory
}

export function instantiateClipboardContent(payload: ClipboardPayload): ZoneContent {
  return cloneContentWithNewIds(payload.content)
}

export function hasStructuralClipboard(): boolean {
  return memory !== null
}
