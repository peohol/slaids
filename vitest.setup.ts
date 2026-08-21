import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

/**
 * jsdom's Blob cannot survive fake-indexeddb's structured clone (it comes back
 * as a plain object). Node's Blob clones correctly, so the unit-test
 * environment uses it. Real browsers are unaffected.
 */
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob
globalThis.File = NodeFile as unknown as typeof globalThis.File
