/**
 * The editor's door for a miniapp file.
 *
 * A `File` from a picker or a drop becomes the text an interactive slide
 * stores, or a refusal the dialog can show. The rules are
 * `domain/interactive.ts`'s — the same ones the agent's `add_interactive_slide`
 * runs under — and this only reads the bytes and carries the verdict.
 *
 * The size is checked against the file's own length before it is read, so an
 * oversized pick is refused without being pulled into memory; the domain then
 * measures the text that would actually be stored, which is the number that
 * counts.
 */

import { MAX_INTERACTIVE_HTML_BYTES } from '../domain/constants'
import {
  acceptInteractiveFile,
  formatByteSize,
  type InteractiveSource,
} from '../domain/interactive'
import { err, type Result } from '../domain/result'
import { blobToBytes } from '../persistence/blob'

export async function readInteractiveFile(file: File): Promise<Result<InteractiveSource>> {
  if (file.size > MAX_INTERACTIVE_HTML_BYTES) {
    return err(
      'INTERACTIVE_HTML_TOO_LARGE',
      `HTML-filen er ${formatByteSize(file.size)}, som er mer enn grensen på ${formatByteSize(MAX_INTERACTIVE_HTML_BYTES)} per interaktiv slide.`,
      { byteSize: file.size, maxByteSize: MAX_INTERACTIVE_HTML_BYTES },
    )
  }
  return acceptInteractiveFile({ fileName: file.name, bytes: await blobToBytes(file) })
}
