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
    environment: 'jsdom',
    globals: true,
    // The headless preview inlines the app's own stylesheets with `?inline`
    // (see `src/render/styles.ts`). Without this Vitest hands back an empty
    // string for a CSS import, which would make every preview test pass
    // against an unstyled slide — the one thing the preview must not be.
    css: true,
    setupFiles: ['./vitest.setup.ts'],
    // The Edge Function's rules are the public security model, so they are
    // covered like everything else. Only the pure module is reachable from
    // here; its Deno entry point is not, and does not need to be.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'supabase/functions/**/*.test.ts',
      'scripts/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
    ],
  },
})
