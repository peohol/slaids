/**
 * Blob helpers.
 *
 * `Blob.arrayBuffer()` is not available everywhere (older Safari, and the jsdom
 * environment used by the unit tests), so reads go through this helper.
 */

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer())
  }
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.byteLength
      }
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('Kunne ikke lese filen.'))
    reader.readAsArrayBuffer(blob)
  })
}

export function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  const buffer = bytes.slice().buffer as ArrayBuffer
  return new Blob([buffer], { type: mimeType })
}
