import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No form that carries a credential may fall back to a GET.
 *
 * ## What was measured
 *
 * On 2026-09-07, driving the partner sign-in in a browser, submitting the form produced:
 *
 *     http://localhost:3002/login?email=partner1-legacy%40safra.test&password=a-testbed-password-1
 *
 * The password, in the URL. On the dev server AND on the standalone build the containers run.
 *
 * Every one of these forms is a client component whose submit is handled in JavaScript, so the
 * handler calls `preventDefault` and no navigation happens — WHEN it is attached. A form with no
 * `method` is a GET, so for the window before hydration finishes, or whenever it does not finish
 * at all, the browser does its own submit and serialises every field into the query string. Which
 * is then in the browser history, the server's access log, and any `Referer` the next request
 * sends.
 *
 * Nine files, twelve forms, and not one of them declared a method.
 *
 * ## Why this is a sweep and not nine assertions
 *
 * The failure is invisible on the path everybody tests: with JavaScript working the attribute is
 * never consulted, so no functional test can see its absence and no reviewer misses it twice.
 * What makes it come back is somebody adding the tenth form — and that is exactly what a sweep
 * catches and a per-file test does not.
 *
 * ## The floor
 *
 * A file containing a password input must declare `method="post"` on as many forms as it has. It
 * is deliberately crude: it counts, rather than parsing JSX to pair each form with its own fields.
 * A file with two forms where only one takes the password still has to say `post` twice, which
 * costs one attribute and removes the judgement call about which of them is the sensitive one.
 *
 * ## Comments are stripped first, and that is not a detail
 *
 * The first version counted raw occurrences and could not fail. Every one of these files carries a
 * comment explaining why the attribute is there — and that comment QUOTES it, so a file with one
 * form scored two and stripping the real attribute still left it passing. Watched to fail before
 * this note was written: removing `method="post"` from `auth-form.tsx` changed nothing.
 *
 * A sweep whose own documentation satisfies it is worse than no sweep, because it reports the
 * coverage it does not have.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

/** How a password field is spelled in this codebase, including the shared component. */
const CREDENTIAL = [`type="password"`, `type={'password'}`, 'PasswordField'];

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (entry.endsWith('.tsx')) {
      out.push(relative);
    }
  }

  return out;
}

describe('a credential never reaches the query string', () => {
  /** The source with every comment removed, so prose about a rule cannot satisfy it. */
  const code = (body: string) =>
    body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

  const carrying = APPS.flatMap(sources)
    .filter((file) => !file.endsWith('.test.tsx'))
    .map((file) => ({ file, body: code(readFileSync(join(ROOT, file), 'utf8')) }))
    .filter(
      (one) =>
        one.body.includes('<form') && CREDENTIAL.some((mark) => one.body.includes(mark)),
    );

  /*
    The fixture has to be able to reach the thing it protects. A sweep over an empty list is the
    worst kind of green: it reports coverage of a rule nothing was ever checked against, which is
    how one privacy test in this repo passed while pointing at the wrong table.
  */
  it('finds the forms it is meant to be checking', () => {
    expect(carrying.length).toBeGreaterThanOrEqual(9);
  });

  it('declares method="post" on every form that carries one', () => {
    const offenders = carrying
      .map(({ file, body }) => ({
        file,
        forms: (body.match(/<form[\s>]/g) ?? []).length,
        posts: (body.match(/method="post"/g) ?? []).length,
      }))
      .filter((one) => one.posts < one.forms)
      .map((one) => `${one.file} (${one.forms} forms, ${one.posts} declared)`);

    expect(offenders, 'every form holding a credential must POST').toEqual([]);
  });
});
