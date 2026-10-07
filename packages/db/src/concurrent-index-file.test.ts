import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NO_TRANSACTION_MARKER,
  isConcurrentIndexFile,
  parseConcurrentIndexFile,
} from './concurrent-index-file.js';

/**
 * A concurrent index file runs WITHOUT a transaction, so a statement in it that is not an index
 * build would be applied half-way on a failure with nothing to roll it back. The parser is the only
 * thing that keeps those files to the one statement that is safe there.
 */
const file = (body: string): string => `${NO_TRANSACTION_MARKER}\n${body}`;

describe('concurrent index files', () => {
  it('is recognised only by its first line', () => {
    expect(
      isConcurrentIndexFile(file('CREATE INDEX CONCURRENTLY IF NOT EXISTS a ON t (x);')),
    ).toBe(true);
    expect(isConcurrentIndexFile(`-- note\n${NO_TRANSACTION_MARKER}\n`)).toBe(false);
  });

  it('splits statements and names each index, skipping comments', () => {
    const parsed = parseConcurrentIndexFile(
      'x.sql',
      file(`
-- why the first one exists
CREATE INDEX CONCURRENTLY IF NOT EXISTS first_idx
  ON t (a, created_at DESC)
  WHERE a IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS second_idx ON t USING gin (b gin_trgm_ops);
`),
    );

    expect(parsed.map((one) => one.name)).toEqual(['first_idx', 'second_idx']);
    expect(parsed[0]?.statement).toMatch(/WHERE a IS NOT NULL$/);
  });

  it.each([
    ['a plain index build, which locks writes', 'CREATE INDEX IF NOT EXISTS a ON t (x);'],
    [
      'a build without IF NOT EXISTS, which fails on a re-run',
      'CREATE INDEX CONCURRENTLY a ON t (x);',
    ],
    ['anything else', 'UPDATE t SET x = 1;'],
    [
      'a second statement on one line',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS a ON t (x); DROP TABLE t;',
    ],
    [
      'a block comment',
      '/* hidden */ CREATE INDEX CONCURRENTLY IF NOT EXISTS a ON t (x);',
    ],
  ])('refuses %s', (_label, body) => {
    expect(() => parseConcurrentIndexFile('x.sql', file(body))).toThrow(/x\.sql/);
  });

  it('accepts the files in the repository', () => {
    const post = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'migrations',
      'post',
    );
    const text = readFileSync(join(post, '0028_request_path_indexes.sql'), 'utf8');

    expect(isConcurrentIndexFile(text)).toBe(true);
    expect(parseConcurrentIndexFile('0028', text).map((one) => one.name)).toEqual([
      'notifications_partner_idx',
      'notifications_customer_idx',
      'notifications_channel_status_created_idx',
      'refunds_payment_idx',
      'customer_profiles_created_id_idx',
      'customer_profiles_search_trgm_idx',
      'conversations_created_id_idx',
      'conversations_customer_idx',
    ]);
  });
});
