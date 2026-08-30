import { describe, expect, it } from 'vitest';

/**
 * Which media prefixes a stranger can read, and which they cannot.
 *
 * ## Why this is a test and not a runbook line
 *
 * `docs/media-integrity.md` records the three checks to run «after every policy change», and a
 * check somebody has to remember is a check that eventually is not run. Both halves have failed
 * in production shape already: `ads/*` was missing when advertising creatives shipped, and
 * `cities/*` was missing when city photography did (2026-08-30). The failure is silent in the
 * worst way — the URL is right, the object is stored, the row says `ready`, and the browser
 * renders nothing with `naturalWidth` zero and no error anybody can see.
 *
 * ## The negative half is the half that matters
 *
 * `identity/` holds identity documents and `disputes/` holds photographs of the inside of
 * somebody's home filed in a complaint. Both are served through authorised routes precisely
 * because they are private, and a policy widened with a wildcard would open them without anything
 * failing. Listing is refused too: the keys are the only thing between a stranger and every
 * document ever uploaded.
 *
 * Skipped when the object store is not running; `pnpm e2e` and CI both have one.
 */
const ENDPOINT = process.env['S3_ENDPOINT'];
const BUCKET = process.env['S3_BUCKET'];

const describeIfStore = ENDPOINT && BUCKET ? describe : describe.skip;

/** A key that does not exist: the STATUS is the subject, not the object. */
const PROBE = 'safra-policy-probe.webp';

describeIfStore('what the media bucket serves anonymously', () => {
  const status = async (path: string): Promise<number> => {
    const response = await fetch(`${ENDPOINT}/${BUCKET}/${path}`, { method: 'GET' });

    return response.status;
  };

  /*
    404 rather than 200, because the object is absent — what is being asserted is that the request
    got PAST the policy. A private prefix answers 403 whether the key exists or not, which is what
    makes these two states distinguishable without seeding a file.
  */
  it.each(['properties', 'ads', 'cities'])(
    'lets a stranger reach %s/',
    async (prefix) => {
      expect(await status(`${prefix}/${PROBE}`)).toBe(404);
    },
  );

  it.each(['identity', 'disputes'])('refuses %s/ to a stranger', async (prefix) => {
    expect(await status(`${prefix}/${PROBE}`)).toBe(403);
  });

  /** Without listing, a key is a secret. With it, every key on the platform is enumerable. */
  it('refuses to list the bucket', async () => {
    expect(await status('?list-type=2')).toBe(403);
  });
});
