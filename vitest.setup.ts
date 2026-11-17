import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import globals from 'globals'
import { afterEach } from 'vitest'

/**
 * jsdom's Blob cannot survive fake-indexeddb's structured clone (it comes back
 * as a plain object). Node's Blob clones correctly, so the unit-test
 * environment uses it. Real browsers are unaffected.
 */
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob
globalThis.File = NodeFile as unknown as typeof globalThis.File

/**
 * Vakt for testfiler som kjører i `node`-miljøet (se `test.projects` i
 * `vite.config.ts`).
 *
 * Kode i Slaids spør ofte `typeof document === 'undefined'` og velger en annen
 * vei uten DOM, for eksempel et estimat i stedet for en ekte måling. En test som
 * egentlig trenger DOM, ville da kunne bli grønn i node-miljøet mens den tester
 * noe annet enn den skal. Derfor får hver nettleserglobal som Node ikke har selv
 * (listen kommer fra pakken `globals`), en getter her: Leser Slaids-kode eller en
 * test den, kastes en feil, og testen feiler også om feilen ble fanget og svelget
 * underveis. Biblioteker i `node_modules` får `undefined` som i ekte Node, slik at
 * deres egen miljødeteksjon virker som før.
 */
if (!('document' in globalThis)) {
  // Lagringen sjekker serverkoden selv (`src/supabase/authStorage.ts`), og der
  // er fravær det normale. Bruker en test `localStorage` direkte, feiler den
  // uansett med ReferenceError.
  const SERVER_SAFE = new Set(['localStorage', 'sessionStorage'])
  const violations: string[] = []

  const callerFile = (getter: () => unknown): string => {
    const original = Error.prepareStackTrace
    Error.prepareStackTrace = (_error, sites) => sites
    const holder: { stack?: NodeJS.CallSite[] } = {}
    Error.captureStackTrace(holder, getter)
    const sites = holder.stack ?? []
    Error.prepareStackTrace = original
    return sites[0]?.getFileName() ?? ''
  }

  for (const name of Object.keys(globals.browser)) {
    if (name in globalThis || SERVER_SAFE.has(name)) continue
    const get = (): undefined => {
      const file = callerFile(get)
      if (file.includes('/node_modules/')) return undefined
      const message =
        `«${name}» ble brukt i node-miljøet (${file || 'ukjent fil'}). ` +
        'Testen trenger DOM: gi testfilen endelsen .test.tsx, eller legg ' +
        "`// @vitest-environment jsdom` øverst i den."
      violations.push(message)
      throw new ReferenceError(message)
    }
    // Et bibliotek som legger inn sin egen polyfill (for eksempel `URLPattern`),
    // skal få gjøre det.
    const set = (value: unknown) => {
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
    }
    Object.defineProperty(globalThis, name, { configurable: true, enumerable: false, get, set })
  }

  afterEach(() => {
    if (violations.length === 0) return
    const messages = [...new Set(violations.splice(0))]
    throw new Error(messages.join('\n'))
  })
}
