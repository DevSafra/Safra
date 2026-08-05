import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
// The parser re-exported by `typescript-eslint`, which the linter already depends on —
// rather than a direct dependency on `@typescript-eslint/parser` added for one test file.
import { parser } from 'typescript-eslint';

// @ts-expect-error the local rule is plain ESM with JSDoc types, not a typed module
import rule from './no-hardcoded-text.mjs';

/**
 * Tests for the lint rule that enforces the no-hardcoded-copy decision.
 *
 * ## Why a lint rule needs tests more than most code
 *
 * A rule that misses things silently permits what it was written to prevent, and a rule that
 * over-reports gets switched off — at which point it also permits everything. The false
 * POSITIVES below are therefore as load-bearing as the negatives: `·`, `←`, `sea_view` and a
 * MIME type all appear in this codebase, and a version of this rule that shouted about them
 * would have been deleted within a day.
 *
 * The rule found real defects when it was first run — eleven staff-console files written
 * entirely in English, in a console that is Arabic-only by decision — so these cases are
 * written to keep that class of finding reachable.
 */
const tester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },
});

describe('no-hardcoded-text', () => {
  it('flags copy and permits identifiers, punctuation and internal errors', () => {
    tester.run('no-hardcoded-text', rule as never, {
      valid: [
        // ── Not copy: no letters ────────────────────────────────────────────────
        { code: 'const a = <p>·</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>←</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>—</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>✓</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>1,204</p>;', filename: 'apps/web/src/a.tsx' },

        // ── Not copy: machine identifiers ───────────────────────────────────────
        { code: 'const a = <p>sea_view</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>SCREAMING_CASE</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>booking.not_found</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>BKG-2026-000431</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>SAFRA</p>;', filename: 'apps/web/src/a.tsx' },
        { code: 'const a = <p>application/pdf</p>;', filename: 'apps/web/src/a.tsx' },
        {
          code: 'const a = <p>https://safra.example</p>;',
          filename: 'apps/web/src/a.tsx',
        },

        // ── Not user-facing: attributes a machine reads ──────────────────────────
        { code: 'const a = <input name="Full name" />;', filename: 'apps/web/src/a.tsx' },
        {
          code: 'const a = <div className="text sm" />;',
          filename: 'apps/web/src/a.tsx',
        },
        { code: 'const a = <a href="/booking list" />;', filename: 'apps/web/src/a.tsx' },

        // ── Copy read from a catalogue ──────────────────────────────────────────
        { code: 'const a = <p>{t.nav.bookings}</p>;', filename: 'apps/web/src/a.tsx' },
        {
          code: 'const a = <input placeholder={t.table.search} />;',
          filename: 'apps/web/src/a.tsx',
        },

        /**
         * An internal invariant. A plain `Error` never reaches a browser — Nest answers a
         * generic 500 and the text lands in the log, which is where rule 1 wants it.
         */
        {
          code: "throw new Error('Wallet insert returned no rows');",
          filename: 'apps/api/src/a.ts',
        },
        {
          code: "throw new TypeError('Expected a decimal string');",
          filename: 'apps/api/src/a.ts',
        },

        // ── The catalogue itself IS the copy ────────────────────────────────────
        {
          code: "export const ar = { title: 'Booking not found' };",
          filename: 'packages/i18n/src/messages/admin/ar.ts',
        },
      ],

      invalid: [
        // ── The eleven English console files looked exactly like this ────────────
        {
          code: 'const a = <p>Booking not found</p>;',
          filename: 'apps/admin/src/a.tsx',
          errors: [{ messageId: 'jsxText' }],
        },
        {
          code: 'const a = <Section title="Sanctions screening" />;',
          filename: 'apps/admin/src/a.tsx',
          errors: [{ messageId: 'attribute' }],
        },
        {
          code: 'const a = <Stamp label="Confirmation due" />;',
          filename: 'apps/admin/src/a.tsx',
          errors: [{ messageId: 'attribute' }],
        },
        {
          code: 'const a = <input placeholder="Search bookings" />;',
          filename: 'apps/web/src/a.tsx',
          errors: [{ messageId: 'attribute' }],
        },
        {
          // A screen reader reads this out, so it is copy.
          code: 'const a = <nav aria-label="breadcrumb" />;',
          filename: 'apps/web/src/a.tsx',
          errors: [{ messageId: 'attribute' }],
        },
        {
          code: 'const a = <img alt="A room with a sea view" />;',
          filename: 'apps/web/src/a.tsx',
          errors: [{ messageId: 'attribute' }],
        },

        // ── Client-facing exceptions ────────────────────────────────────────────
        {
          code: "throw new NotFoundException('Booking not found.');",
          filename: 'apps/api/src/a.ts',
          errors: [{ messageId: 'thrown' }],
        },
        {
          // The template-literal form, which is what most of the API's messages were.
          code: 'throw new BadRequestException(`A stay may not exceed ${max} nights.`);',
          filename: 'apps/api/src/a.ts',
          errors: [{ messageId: 'thrown' }],
        },
        {
          code: "throw new ConflictException('This dispute is already closed.');",
          filename: 'apps/api/src/a.ts',
          errors: [{ messageId: 'thrown' }],
        },

        // ── Arabic is copy too: the rule is about hardcoding, not about English ──
        {
          code: 'const a = <p>لم يُعثر على هذا الحجز</p>;',
          filename: 'apps/admin/src/a.tsx',
          errors: [{ messageId: 'jsxText' }],
        },
      ],
    });
  });
});
