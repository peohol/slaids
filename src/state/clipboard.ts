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

/** How long to wait for the system clipboard when memory can answer instead. */
const SYSTEM_READ_TIMEOUT_MS = 500
/** With nothing in memory the system clipboard is the only source worth waiting for. */
const SYSTEM_READ_TIMEOUT_EMPTY_MS = 3000

/**
 * The system clipboard first, so a copy survives a reload or reaches another
 * tab, then the in-memory payload. Foreign text simply fails validation.
 */
export async function readStructuralClipboard(): Promise<ClipboardPayload | null> {
  const text = await readSystemText(
    memory ? SYSTEM_READ_TIMEOUT_MS : SYSTEM_READ_TIMEOUT_EMPTY_MS,
  )
  if (text) {
    try {
      const parsed = validateClipboardPayload(JSON.parse(text))
      if (parsed.ok && parsed.value) return parsed.value as ClipboardPayload
    } catch {
      // Ordinary text copied from somewhere else; not our payload.
    }
  }
  return memory
}

/**
 * Reading the system clipboard can wait on a permission prompt the user never
 * answers, and that promise then never settles. Racing it against a deadline
 * keeps paste responsive instead of silently doing nothing.
 */
async function readSystemText(timeoutMs: number): Promise<string | null> {
  try {
    const read = navigator.clipboard?.readText()
    if (!read) return null
    return await Promise.race([
      read.catch(() => null),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } catch {
    return null
  }
}

/** The in-memory payload only — no permission prompt, no await. */
export function readStructuralClipboardSync(): ClipboardPayload | null {
  return memory
}

export function instantiateClipboardContent(payload: ClipboardPayload): ZoneContent {
  return cloneContentWithNewIds(payload.content)
}

export function hasStructuralClipboard(): boolean {
  return memory !== null
}
