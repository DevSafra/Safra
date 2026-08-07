import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { transform } from '@swc/core';
import { defineConfig, type Plugin } from 'vitest/config';

/** The API's own source — not its tests, which need no decorator metadata of their own. */
const API_SOURCE = /[/\\]apps[/\\]api[/\\]src[/\\].*(?<!\.(?:test|spec))\.ts$/;

/**
 * Compiles the API's source the way the API itself is compiled.
 *
 * Vitest transforms with esbuild, which implements `experimentalDecorators` but NOT
 * `emitDecoratorMetadata` — it has no type information to emit. NestJS reads exactly that metadata
 * (`design:paramtypes`) to know what a constructor asks for, so under plain esbuild every
 * dependency without an explicit `@Inject()` resolves to `undefined` and no test can assemble the
 * container. That is why `PayoutModule` could ship missing a provider with `pnpm verify` green.
 *
 * SWC does emit it, and `apps/api/tsconfig.json` already turns both flags on, so this makes the
 * test build agree with the production build rather than introducing a new one. Scoped to the API
 * because it is the only decorator-driven code here; everything else stays on esbuild.
 */
function nestDecoratorMetadata(): Plugin {
  return {
    name: 'safra:nest-decorator-metadata',
    enforce: 'pre',
    async transform(code: string, id: string) {
      if (!API_SOURCE.test(id)) return null;

      const output = await transform(code, {
        filename: id,
        sourceMaps: true,
        jsc: {
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
          target: 'es2022',
        },
        // Left as ESM for Vite to handle; SWC only performs the TypeScript transform.
        module: { type: 'es6' },
      });

      return { code: output.code, map: output.map ?? null };
    },
  };
}

/**
 * Resolves the Next apps' `@/…` alias the way each app's own `tsconfig.json` does.
 *
 * Both apps map `@/*` to THEIR OWN `src/*`, so a single string alias cannot serve both: pointing
 * `@/` at the console's `src` would make a future `apps/web` test import the console's module of
 * the same name and pass against the wrong file. So the app is decided by which app the importing
 * file belongs to, which is the same rule the bundlers apply.
 *
 * Without this, any test of an app module that uses `@/` failed on module load — and the effect
 * was not a red test but no test at all: `format.ts` had none, and the bookings table shipped a
 * date range that overflowed its column.
 */
function resolveAppAlias(source: string, importer: string | undefined): string {
  const app = importer?.includes(`${'/apps/web/'}`) ? 'web' : 'admin';
  const base = fileURLToPath(new URL(`./apps/${app}/src/`, import.meta.url));
  const target = `${base}${source}`;

  // Extensions are the resolver's job, and it does not get a chance to run after an alias.
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  // Let the default resolver produce the error, which names the real missing path.
  return target;
}

/**
 * One test runner for the whole monorepo. Kept at the root so `pnpm test` from
 * anywhere runs every suite, and so CI has a single entry point.
 */
export default defineConfig({
  plugins: [nestDecoratorMetadata()],
  resolve: {
    alias: [
      /**
       * `server-only` is resolved by Next's bundler and is not a package on disk, so any
       * test importing an `apps/admin` server module would fail on module load. See the stub
       * for why this does not weaken the guard it provides.
       */
      {
        find: 'server-only',
        replacement: fileURLToPath(
          new URL('./test/server-only.stub.ts', import.meta.url),
        ),
      },
      {
        find: /^@\//,
        // Unused: `customResolver` receives the stripped specifier and decides the path.
        replacement: '',
        customResolver: (source, importer) => resolveAppAlias(source, importer),
      },
    ],
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
