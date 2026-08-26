import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import type { Role } from '@safra/contracts';

import { DATABASE } from '../../database/database.module.js';
import {
  currentRequestContext,
  type RequestContext,
} from '../logging/request-context.js';
import { describeError } from '../errors/safe-error.js';

/**
 * Optional fields accept `undefined` as well as `null` so callers can spread a
 * request context straight in. `record()` normalises both to null for the column.
 */
export interface AuditEntry {
  actorUserId?: string | null | undefined;
  actorRole?: Role | null | undefined;
  action: string;
  subjectType: string;
  subjectId?: string | null | undefined;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
  reason?: string | null | undefined;
}

/**
 * SRS §15: an audit trail for every admin action, payment, refund, status change,
 * price edit and partner approval, recording IP, device, time and staff member.
 *
 * The table itself rejects UPDATE and DELETE (see migrations/post), so this service
 * can only ever append.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Writes an audit row inside the CALLER's transaction when one is supplied.
   *
   * Passing `tx` is strongly preferred for state changes: it makes the audit row
   * and the change it describes atomic, so neither can exist without the other.
   */
  async record(entry: AuditEntry, tx?: Database): Promise<void> {
    const executor = tx ?? this.db;
    /*
      §15's origin, from the request that is running — unless the caller named one.

      An explicit value still wins, because a few paths know better than the ambient context: the
      staff routes pass it deliberately, and a job replaying work on somebody's behalf must not
      inherit whatever request happens to be open. Everything else — forty-one services writing
      administrative rows four calls deep — gets it without taking a parameter.

      Outside a request there is no context and both stay null, which is the honest answer for a
      scheduled sweep: nobody's device did it.
    */
    const origin: Partial<RequestContext> = currentRequestContext() ?? {};

    await executor.insert(schema.auditLog).values({
      actorUserId: entry.actorUserId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      subjectType: entry.subjectType,
      subjectId: entry.subjectId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ipAddress: entry.ipAddress ?? origin.ipAddress ?? null,
      userAgent: entry.userAgent ?? origin.userAgent ?? null,
      requestId: entry.requestId ?? null,
      reason: entry.reason ?? null,
    });
  }

  /**
   * Fire-and-forget variant for observational events that must never break the
   * request they describe — a failed login, for instance.
   *
   * Used ONLY where losing the row is acceptable. State changes must use record()
   * with a transaction: an audit log with silent gaps is worse than none, because
   * it looks complete.
   */
  recordDetached(entry: AuditEntry): void {
    void this.record(entry).catch((error: unknown) => {
      this.logger.error(
        `Failed to write audit entry "${entry.action}": ${describeError(error)}`,
      );
    });
  }

  /** Redacts values that must never reach the audit log (rule 1). */
  static redact<T extends Record<string, unknown>>(value: T): Partial<T> {
    const FORBIDDEN = [
      'password',
      'passwordhash',
      'password_hash',
      'token',
      'tokenhash',
      'token_hash',
      'totpsecret',
      'totpsecretencrypted',
      'totp_secret_encrypted',
      'accountnumber',
      'accountnumberencrypted',
      'account_number_encrypted',
      'codehash',
      'code_hash',
      'secret',
      'authorization',
      'cookie',
    ];

    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      output[key] = FORBIDDEN.includes(key.toLowerCase()) ? '[redacted]' : item;
    }

    return output as Partial<T>;
  }
}
