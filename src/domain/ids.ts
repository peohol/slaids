/** Stable, collision-resistant id generation for domain objects. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomToken(length: number): string {
  const bytes = new Uint8Array(length)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

let counter = 0

export function createId(prefix: string): string {
  counter = (counter + 1) % 0xffff
  return `${prefix}_${randomToken(10)}${counter.toString(36)}`
}

export const newNodeId = () => createId('n')
export const newSlideId = () => createId('s')
export const newPresentationId = () => createId('p')
export const newContentId = () => createId('c')
export const newSubfieldId = () => createId('f')
export const newReferenceId = () => createId('r')
export const newSandboxId = () => createId('sb')
export const newAssetId = () => createId('a')
export const newTemplateId = () => createId('t')
export const newFolderId = () => createId('fl')
export const newIdeaId = () => createId('i')
export const newIdeaCategoryId = () => createId('ic')

/**
 * A share token.
 *
 * This one is not like the ids above: it *is* the access control for a shared
 * link, so knowing the format must not help anybody guess one. A v4 UUID from
 * the platform CSPRNG is enough entropy for that, and the `Math.random()`
 * fallback `createId` is content with would not be — so when there is no
 * cryptographic source, this refuses rather than quietly minting a weak secret.
 */
export function newShareToken(): string {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error(
      'Kan ikke lage en delingslenke her: nettleseren mangler en kryptografisk tilfeldighetskilde.',
    )
  }
  const bytes = source.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
