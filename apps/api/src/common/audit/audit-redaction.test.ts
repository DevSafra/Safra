import { describe, expect, it } from 'vitest';

import { ROTATED_COLUMNS } from '../crypto/field-key-rotation.js';
import { AuditService } from './audit.service.js';

/*
  Every encrypted column is kept out of the audit log, in both spellings a payload uses (2026-10-06).

  `redact` named two of the five, and the sender and refund-destination ciphertext would have been
  stored in `audit_log` had a payload ever carried them. The list of encrypted columns is the one the
  key rotation is held to, `ROTATED_COLUMNS`, whose own sweep fails on a column it does not name, so a
  sixth encrypted column arrives here too rather than being remembered.
*/
const camel = (snake: string) =>
  snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

describe('audit redaction', () => {
  const columns = ROTATED_COLUMNS.map((qualified) => qualified.split('.')[1] ?? '');

  it.each(columns)('hides %s, as it is stored and as a payload names it', (column) => {
    const redacted = AuditService.redact({
      [column]: 'ciphertext',
      [camel(column)]: 'ciphertext',
    });

    expect(Object.values(redacted)).toEqual(['[redacted]', '[redacted]']);
  });

  /* The control: redaction is by name, and an ordinary field passes through. */
  it('leaves an ordinary field alone', () => {
    expect(AuditService.redact({ reference: 'PAY-2026-000001' })).toEqual({
      reference: 'PAY-2026-000001',
    });
  });
});
