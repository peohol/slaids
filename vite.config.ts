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
    setupFiles: ['./vitest.setup.ts'],
    // The Edge Function's rules are the public security model, so they are
    // covered like everything else. Only the pure module is reachable from
    // here; its Deno entry point is not, and does not need to be.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'supabase/functions/**/*.test.ts',
    ],
  },
})
