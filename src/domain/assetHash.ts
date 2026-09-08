/**
 * The identity of a file's contents.
 *
 * Two files are the same file when their bytes are, whatever they were called
 * and whenever they were uploaded — and that is the question deduplication asks.
 * The answer is a SHA-256 over the stored bytes, as lowercase hex, recorded on
 * the `AssetRef` as `contentHash` once it has been computed so it need not be
 * computed again.
 *
 * The hash is advisory, never load-bearing: a reference without one is simply a
 * file nobody has hashed yet, and every consumer hashes on demand. Which is why
 * it can be optional in the schema, why an import may drop it, and why nothing
 * breaks when a document written before the field existed is opened.
 *
 * WebCrypto, because it is the one digest all three runtimes share — the
 * browser, the worker and the Node process behind the agent API — and because a
 * cryptographic hash is what makes "same hash, same bytes" a statement rather
 * than a hope.
 */

export const ASSET_HASH_ALGORITHM = 'SHA-256'

export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Kan ikke beregne filens innholdshash: WebCrypto er ikke tilgjengelig her.')
  }
  // A view can sit anywhere inside a larger buffer; the digest wants exactly
  // the bytes the view covers.
  const digest = await subtle.digest(
    ASSET_HASH_ALGORITHM,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
