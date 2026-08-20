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
