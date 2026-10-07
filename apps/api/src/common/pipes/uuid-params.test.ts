import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every route parameter is either parsed by a pipe or is one of the names that is NOT a uuid.
 *
 * ## The defect this generalises
 *
 * A uuid column compared with a value that is not one makes Postgres raise `22P02 invalid input
 * syntax for type uuid`, which reaches the client as a 500. Thirty handlers took `:id`,
 * `:userId`, `:unitId` or `:imageId` with no pipe (go-live audit, 2026-10-06): a payout, a payout
 * account, a SAFRA payout, a unit, a property or city image, a staff scope and an emergency mode.
 *
 * ## Why a sweep, and what the list below is
 *
 * The other fifty handlers already carried `ParseUUIDPipe`; the thirty were the same mistake
 * in seven files, not one code path. So the test reads every controller and requires a pipe on
 * every `@Param`, except the names listed here. Each of those is a human-readable REFERENCE,
 * code, slug or enum value, looked up against a text column — never a uuid — and a garbage value
 * there is an ordinary "not found". A new uuid parameter cannot be added without either a pipe or
 * an entry here, and an entry here has to say why it is not a uuid.
 */
const NOT_A_UUID: Readonly<Record<string, string>> = {
  reference: 'BKG-…, PAR-…, PRO-… references; text, matched exactly',
  bookingReference: 'a booking reference, as above',
  code: 'coupon, gift-card, amenity and catalogue codes; text',
  slug: 'city and group-trip slugs; text',
  key: 'a platform setting key; text',
  party: 'original | safra | partner, refused with a 404 otherwise',
  provider: 'a payment provider name; text',
  kind: 'media: the whole key is matched against MediaController.KEY_PATTERN first',
  owner: 'media, as above',
  filename: 'media, as above',
};

const SRC = join(import.meta.dirname, '..', '..');

function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return controllers(path);

    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

describe('route parameters', () => {
  const files = controllers(SRC);

  it('finds the controllers it is meant to read', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('parses every uuid parameter with a pipe', () => {
    const bare: string[] = [];
    let seen = 0;

    for (const file of files) {
      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(/@Param\(\s*'([^']+)'\s*(,[^)]*)?\)/g)) {
        seen += 1;

        const [, name, pipe] = match;

        if (pipe !== undefined || name === undefined) continue;

        if (!Object.hasOwn(NOT_A_UUID, name)) {
          bare.push(`${relative(SRC, file)}: @Param('${name}')`);
        }
      }
    }

    /* A regex that silently matched nothing would make the next assertion vacuous. */
    expect(seen).toBeGreaterThan(150);
    expect(bare, 'add ParseUUIDPipe, or say here why the name is not a uuid').toEqual([]);
  });
});
