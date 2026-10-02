import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { InternalCaptureProvider } from './providers/internal-capture.provider.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
import { SimulatorProvider } from './providers/simulator.provider.js';

/**
 * The database's list of offline rails is the provider registry's (2026-10-02).
 *
 * `post/0027_bank_transfer_refund.sql` refuses to complete an offline refund unless it went back to
 * the account the money came from, and it names the offline rails by slug, because a trigger
 * cannot ask the registry. A provider added as `isOffline` and left out of that list would settle
 * refunds to any account with no error anywhere, so this reads the SQL and the providers and fails
 * on the difference. Sham Cash, the day it is contracted, lands here first.
 */
const SQL = readFileSync(
  new URL(
    '../../../../packages/db/migrations/post/0027_bank_transfer_refund.sql',
    import.meta.url,
  ),
  'utf8',
);

const listed = (/pay\.provider NOT IN \(([^)]*)\)/.exec(SQL)?.[1] ?? '')
  .split(',')
  .map((slug) => slug.trim().replace(/^'|'$/g, ''))
  .filter(Boolean);

const providers = [
  new ManualTransferProvider(),
  new InternalCaptureProvider(),
  new SimulatorProvider([], 'https://safra.test'),
];

describe('the offline rails the refund rule names', () => {
  it('reads a list from the SQL at all', () => {
    expect(listed.length, 'the pattern still finds the list').toBeGreaterThan(0);
  });

  it('names every provider the registry treats as offline', () => {
    const offline = providers.filter((one) => one.isOffline).map((one) => one.slug);

    expect(offline.filter((slug) => !listed.includes(slug))).toEqual([]);
  });

  it('names nothing that is not an offline provider', () => {
    const offline = new Set<string>(
      providers.filter((one) => one.isOffline).map((one) => one.slug),
    );

    expect(listed.filter((slug) => !offline.has(slug))).toEqual([]);
  });
});
