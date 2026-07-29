import { defineConfig } from 'vitest/config';

/**
 * One test runner for the whole monorepo. Kept at the root so `pnpm test` from
 * anywhere runs every suite, and so CI has a single entry point.
 */
export default defineConfig({
  test: {
    include: ['{apps,packages}/*/src/**/*.{test,spec}.ts'],
    environment: 'node',
    // Security-relevant paths must stay covered as the codebase grows.
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/schema/**', '**/migrations/**'],
    },
  },
});
