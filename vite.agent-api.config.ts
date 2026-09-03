/**
 * The agent API, bundled for the serverless runtime.
 *
 * This config exists because of one deployment fact that is invisible locally:
 * the platform compiles each `.ts` file to `.js` on its own and lets Node
 * resolve the imports between them. TypeScript emits module specifiers
 * verbatim — it has never rewritten them — so `import { x } from './handler'`
 * survives as `'./handler'`, which Node's ESM resolver cannot resolve at all:
 * ESM has no extension guessing and no directory/index lookup. The whole
 * `src/` tree, written the way every bundler expects, is unloadable that way.
 *
 * So the function is handed a single file with no relative imports left in it.
 * `api/agent/v1.ts` is then the one committed entry point, and it imports that
 * file by its real name, with its extension.
 *
 * Dependencies stay external: `zod` and `@supabase/supabase-js` remain bare
 * specifiers, which Node resolves from `node_modules` and the platform's
 * dependency tracer follows. Only *our* code is bundled, which is precisely the
 * part Node could not resolve.
 *
 * `emptyOutDir: false` is not incidental: the output lives beside a committed
 * `.d.ts` that gives the entry point its types, and emptying the directory
 * would delete it.
 */

import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    ssr: 'src/server/agent/index.ts',
    outDir: 'src/server/generated',
    emptyOutDir: false,
    target: 'node20',
    // Readable on purpose. This is a server bundle nobody downloads, and a
    // stack trace from production is worth more than the bytes.
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'agentApi.js' },
    },
  },
})
