import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No English prose is written into the console's components.
 *
 * ## Why this is a test and not a lint rule
 *
 * `safra/no-hardcoded-text` visits JSX text, user-facing attributes and exception messages. Every
 * string this catches is a literal in an EXPRESSION instead — a ternary inside `{…}`, a
 * `Record<string, string>` lookup, a `setError(…)` argument — and the rule's own header explains
 * why widening it to every literal would mean flagging imports, class names and HTTP headers too.
 *
 * So the gap was real either way, and roughly forty strings had accumulated behind it. They were
 * found one screenshot at a time — a German customer reading Arabic is the failure mode the copy
 * rule exists to prevent, and its console equivalent is an Arabic operator reading English.
 *
 * ## What it looks for
 *
 * Sentence-shaped English: a capital letter, then lower-case words, then a space — inside a single
 * or double quoted string, in a `.tsx` file. That shape is what prose looks like and what an
 * identifier, a class name and a URL do not.
 *
 * ## When this fails
 *
 * Move the string to `packages/i18n/src/messages/admin/ar.ts` and read it through `t`. If it is
 * genuinely not user-facing, add it to `ALLOWED` below WITH a reason — the list is short on
 * purpose, and every entry is a small exception somebody has to justify.
 */
const ROOT = new URL('../', import.meta.url).pathname;

/**
 * Strings that are not copy.
 *
 * Each is exempt for a stated reason, matching the documented exceptions in `docs/i18n.md`:
 * enum values and setting keys, HTTP header names, and CSS class fragments.
 */
const ALLOWED = new Set([
  /* HTTP, not prose. */
  'Content-Type',
  'application/json',
  'Not signed in.',
  /* A CSS custom-property fragment, not a sentence. */
  'Desktop Chrome',
]);

/** Prose: a capital, lower-case letters, then a space and another word. */
const PROSE = /(['"])([A-Z][a-z]+(?:\s+[A-Za-z'’,.…-]+){1,})\1/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) return walk(full);

    return full.endsWith('.tsx') ? [full] : [];
  });
}

/** Comments carry English deliberately — the codebase explains itself in it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the console speaks Arabic', () => {
  it('has no English prose written into a component', () => {
    const offenders: string[] = [];

    for (const file of walk(ROOT)) {
      const source = withoutComments(readFileSync(file, 'utf8'));

      for (const [, , text] of source.matchAll(PROSE)) {
        if (!text || ALLOWED.has(text)) continue;

        offenders.push(`${file.slice(ROOT.length)}: «${text}»`);
      }
    }

    /*
      The whole list, not the first one. A failure naming one string sends somebody to fix one
      string; a failure naming forty is the actual state of the file they are about to edit.
    */
    expect(offenders).toStrictEqual([]);
  });
});
