import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    globals: true,
    // The headless preview inlines the app's own stylesheets with `?inline`
    // (see `src/render/styles.ts`). Without this Vitest hands back an empty
    // string for a CSS import, which would make every preview test pass
    // against an unstyled slide — the one thing the preview must not be.
    css: true,
    setupFiles: ['./vitest.setup.ts'],
    // Vitest bruker som standard én arbeider færre enn antall kjerner. På CI
    // venter hovedprosessen mest, og én arbeider per kjerne var målbart raskere
    // (om lag 10 % på fire kjerner). Lokalt beholdes standarden, så maskinen
    // ikke blir tregere å bruke under `vitest` i watch-modus.
    ...(process.env.CI ? { maxWorkers: '100%' } : {}),
    // Miljøet følger filendelsen, så nye tester havner riktig uten en liste her:
    // `*.test.tsx` kjører i jsdom, `*.test.ts` i Node. Å bygge et jsdom-vindu
    // koster mer enn mange av testene selv, så tester uten DOM slipper det. En
    // `.ts`-test som trenger DOM, sier det selv med `// @vitest-environment
    // jsdom` øverst i filen. Glemmer den det, feiler den høylytt: se vakten i
    // `vitest.setup.ts`.
    projects: [
      { extends: true, test: { name: 'dom', environment: 'jsdom', include: testFiles('tsx') } },
      { extends: true, test: { name: 'node', environment: 'node', include: testFiles('ts') } },
    ],
  },
})

/**
 * Testfilene med den gitte endelsen under hver rot.
 *
 * The Edge Function's rules are the public security model, so they are
 * covered like everything else. Only the pure module is reachable from here;
 * its Deno entry point is not, and does not need to be.
 */
function testFiles(extension: 'ts' | 'tsx'): string[] {
  return ['src', 'supabase/functions', 'supabase/tests', 'scripts'].map(
    (root) => `${root}/**/*.test.${extension}`,
  )
}
