import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { schema } from '@safra/db';

import { ROTATED_COLUMNS, type RotatedColumn } from './field-key-rotation.js';

/**
 * Nothing that holds field ciphertext can be left out of a key rotation.
 *
 * The rotation once covered one column of five (go-live audit, 2026-10-06), because each new
 * encrypted column was added by a feature that had no reason to open the rotation script. These two
 * sweeps make that omission a failing test in the change that introduces the column, rather than a
 * set of unreadable rows the day the retired key is removed.
 *
 *   1. SCHEMA: every `*_encrypted` column in `@safra/db` is in `ROTATED_COLUMNS`, and nothing in
 *      `ROTATED_COLUMNS` names a column that no longer exists.
 *   2. SOURCE: every `.encrypt(` call in the API is declared below with the columns it writes, and
 *      each of those is in `ROTATED_COLUMNS`. A new call, or a second call in a file, fails until
 *      somebody says where its ciphertext goes, which is the question the rotation needs answered.
 */
const ENCRYPT_CALL_SITES: Record<
  string,
  { calls: number; writes: readonly RotatedColumn[] }
> = {
  'auth/auth.service.ts': { calls: 1, writes: ['users.totp_secret_encrypted'] },
  'auth/two-factor.service.ts': { calls: 1, writes: ['users.totp_secret_encrypted'] },
  'bookings/booking-actions.service.ts': {
    calls: 1,
    writes: ['payments.payer_account_encrypted'],
  },
  'payments/refund.service.ts': {
    calls: 1,
    writes: ['payments.payer_account_encrypted'],
  },
  'payouts/payout-account.service.ts': {
    calls: 2,
    writes: ['partner_payout_accounts.account_number_encrypted'],
  },
  'payouts/safra-payout.service.ts': {
    calls: 1,
    writes: ['safra_payout_accounts.account_number_encrypted'],
  },
  'scripts/prepare-load-accounts.ts': {
    calls: 1,
    writes: ['users.totp_secret_encrypted'],
  },
  'scripts/seed-testbed.ts': { calls: 1, writes: ['users.totp_secret_encrypted'] },
  'common/crypto/field-key-rotation.ts': { calls: 3, writes: [...ROTATED_COLUMNS] },
};

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sourceFiles(path);

    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('field-encryption key rotation coverage', () => {
  it('rotates every *_encrypted column the schema declares, and only those', () => {
    const declared = Object.values(schema as Record<string, unknown>)
      .filter((value): value is PgTable => is(value, PgTable))
      .flatMap((table) => {
        const config = getTableConfig(table);

        return config.columns
          .filter((column) => column.name.endsWith('_encrypted'))
          .map((column) => `${config.name}.${column.name}`);
      })
      .sort();

    /* The sweep must find something, or a broken import would pass by finding nothing. */
    expect(declared.length).toBeGreaterThanOrEqual(5);
    expect(declared).toEqual([...ROTATED_COLUMNS].sort());
  });

  /*
    The setting that lifts the set-once rule on the payer and refund ciphertext is the rotation's
    alone. Any other code path setting it could repoint a refund at an account with the same last
    four, which is exactly what post/0027 exists to refuse.
  */
  it('lets only the rotation set safra.field_key_rotation', () => {
    const setters = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('field_key_rotation'))
      .map((file) => relative(SRC, file));

    expect(setters).toEqual(['common/crypto/field-key-rotation.ts']);
  });

  it('knows where every encrypt() call in the API writes its ciphertext', () => {
    const found: Record<string, number> = {};

    for (const file of sourceFiles(SRC)) {
      const calls = readFileSync(file, 'utf8').match(/\.encrypt\(/g)?.length ?? 0;

      if (calls > 0) found[relative(SRC, file)] = calls;
    }

    expect(
      found,
      'a new encrypt() call: add it to ENCRYPT_CALL_SITES with the column it writes, and make ' +
        'sure rotateFieldEncryption covers that column',
    ).toEqual(
      Object.fromEntries(
        Object.entries(ENCRYPT_CALL_SITES).map(([file, s]) => [file, s.calls]),
      ),
    );

    for (const [file, site] of Object.entries(ENCRYPT_CALL_SITES)) {
      for (const column of site.writes) {
        expect(ROTATED_COLUMNS, `${file} writes ${column}`).toContain(column);
      }
    }
  });
});
