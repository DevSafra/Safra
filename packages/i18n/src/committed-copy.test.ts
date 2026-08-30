import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/**
 * Every catalogue key a COMMITTED screen reads is defined in the COMMITTED catalogue.
 *
 * ## The hole this closes, and it is a hole in the gate rather than in any one commit
 *
 * `main` did not build for several hours on 2026-08-24, and **every `pnpm verify` all three
 * sessions ran said exit 0.** Two commits shipped partner screens carrying 31 references to
 * catalogue blocks that had never been committed — the blocks existed only in the working tree.
 *
 * Nothing caught it because **`verify` typechecks the WORKING TREE**. The tree had the copy, so it
 * compiled; the commit did not. Our verify-before-commit rule cannot see a commit that is missing a
 * file, because the file is sitting right there while the gate runs.
 *
 * And the rule that makes it possible is one we are right to keep: explicit paths on every commit.
 * Naming `violations/page.tsx` and not naming `ar.ts` produces a commit that builds nowhere but on
 * the machine that made it. Three sessions sharing one index makes that a daily risk rather than a
 * rare one.
 *
 * ## Why it reads git rather than the filesystem
 *
 * That is the entire point. A test over the working tree would have passed throughout, because the
 * working tree was correct the whole time. This asks a different question — *what did we actually
 * commit* — and it is the only question that predicts whether anybody else can build it.
 *
 * It therefore fails AFTER the bad commit rather than before it. That is still early enough: it
 * fails on the next run, before the push, and it keeps failing until somebody commits the copy.
 *
 * ## Scope
 *
 * Top-level catalogue blocks only, not every leaf. A missing block is the failure that breaks the
 * build; a missing leaf inside a present block is caught by the completeness tests beside this file
 * and by `label()` returning the raw key, which `a-missing-translation-must-look-like-one` requires.
 */
const APPS: Record<string, string> = {
  admin: 'packages/i18n/src/messages/admin/ar.ts',
  partner: 'packages/i18n/src/messages/partner/ar.ts',
};

/** Committed content, or null when the path is not in HEAD at all. */
function committed(path: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * The module that DEFINES `t` is not a consumer of it.
 *
 * Each app's `lib/strings.ts` is `export const t = adminAr` plus helpers, and its docblock names
 * `t.bookings.title` while explaining what the binding is for. The crude matcher below reads that
 * as a catalogue reference, which it is not.
 *
 * Excluded by path rather than by trying to tell prose from code — a matcher clever enough to do
 * that is a matcher nobody can be sure of, and this one is deliberately crude so that it
 * over-collects rather than under-collects.
 *
 * No path globs in this comment: a star followed by a slash ends the block, which is how this very
 * docblock broke the file on its first write. Same shape as a backtick inside a sql template.
 */
const DEFINES_T = /\/lib\/strings\.ts$/;

function trackedSources(app: string): string[] {
  return execFileSync('git', ['ls-files', `apps/${app}/src`], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.endsWith('.tsx') || path.endsWith('.ts'))
    .filter((path) => !path.includes('.test.'))
    .filter((path) => !DEFINES_T.test(path));
}

/**
 * The top-level blocks a file reads — `t.violations.…` yields `violations`.
 *
 * Deliberately crude. It over-collects rather than under-collects: a false positive is a block that
 * exists, which passes, and a false negative is the defect this test is for.
 */
function blocksRead(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/\bt\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1] ?? ''),
  );
}

/** The top-level keys the catalogue defines, at two-space indentation. */
function blocksDefined(catalogue: string): Set<string> {
  return new Set(
    [...catalogue.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map(
      (match) => match[1] ?? '',
    ),
  );
}

describe('what we committed, not what is in the tree', () => {
  for (const [app, cataloguePath] of Object.entries(APPS)) {
    describe(app, () => {
      const catalogue = committed(cataloguePath);
      const defined = catalogue ? blocksDefined(catalogue) : new Set<string>();

      /** A guard on the guard: an empty catalogue would make every assertion below vacuous. */
      it('reads the committed catalogue at all', () => {
        expect(catalogue, `${cataloguePath} is not committed`).not.toBeNull();
        expect(defined.size).toBeGreaterThan(5);
      });

      /*
        Given room, because this shells out to `git show` ONCE PER SCREEN.

        It reads ~250 committed files through git, which is a second or two alone and comfortably
        past vitest's 5-second default when the rest of the suite is running beside it. It timed
        out three times in one session on 2026-08-30 while asserting nothing — a red run whose
        cause is the clock teaches everybody to re-run rather than to read, which is worse than a
        slow test. The bound is generous rather than tuned: this is not a performance assertion.
      */
      it(
        'has every catalogue block its committed screens read',
        { timeout: 60_000 },
        () => {
          const missing = new Map<string, string[]>();

          for (const path of trackedSources(app)) {
            const source = committed(path);

            if (source === null) continue;

            const unresolved = [...blocksRead(source)].filter(
              (block) => !defined.has(block),
            );

            if (unresolved.length > 0) missing.set(path, unresolved);
          }

          expect(
            Object.fromEntries(missing),
            'These COMMITTED files read catalogue blocks that are not in the COMMITTED catalogue. ' +
              'The working tree compiles and nobody else can build this. Commit the copy.',
          ).toEqual({});
        },
      );
    });
  }
});
