import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-e2e-supabase',
      'node_modules',
      'playwright-report',
      'test-results',
      'coverage',
      // Generated: the agent API bundled for the serverless runtime.
      'src/server/generated/agentApi.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.mjs` too: the build scripts are Node programs, not browser code.
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Build and deploy scripts talk to whoever ran them.
    files: ['e2e/**/*.ts', '*.config.ts', 'vitest.setup.ts', 'scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
)
