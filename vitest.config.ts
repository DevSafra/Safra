import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * One test runner for the whole monorepo. Kept at the root so `pnpm test` from
 * anywhere runs every suite, and so CI has a single entry point.
 */
export default defineConfig({
  resolve: {
    alias: {
      /**
       * `server-only` is resolved by Next's bundler and is not a package on disk, so any
       * test importing an `apps/admin` server module would fail on module load. See the stub
       * for why this does not weaken the guard it provides.
       */
      'server-only': fileURLToPath(
        new URL('./test/server-only.stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      '{apps,packages}/*/src/**/*.{test,spec}.ts',
      // The local ESLint rules live outside any workspace package: they are build tooling,
      // not shipped code. They still get tested — a lint rule that over-reports gets
      // switched off, which is worse than not having it.
      'tools/eslint-rules/*.test.ts',
    ],
    environment: 'node',
    // Security-relevant paths must stay covered as the codebase grows.
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/schema/**', '**/migrations/**'],
    },
  },
});
