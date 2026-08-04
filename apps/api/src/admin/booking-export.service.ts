import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export interface ExportFilters {
  readonly q?: string | undefined;
  readonly status?: string | undefined;
}

/** Hard ceiling. 20,000 rows is a generous real export and a bounded response. */
const MAX_ROWS = 20_000;

const HEADER = [
  'reference',
  'property',
  'customer',
  'check_in',
  'check_out',
  'amount',
  'currency',
  'status',
] as const;

/**
 * Exporting bookings as CSV, with an audit entry (B-13, Bashar's decision 2026-08-04).
 *
 * ## Why this moved out of the web tier
 *
 * The first version streamed from the admin app's route handler, walking the public API a page at a
 * time. It worked, and it could not write an audit row inside the API's transaction — so an export
 * left no trace. An export removes data from the console's access controls; it is precisely the kind
 * of action the audit log exists for.
 *
 * ## The audit row is written BEFORE the bytes go out
 *
 * Deliberately, and it is the one ordering decision here worth stating. Writing it afterwards means
 * a client that disconnects mid-stream produces no record of an export that partly happened. The
 * cost is an occasional audit row for an export that was abandoned — which is the right way round:
 * over-recording is a nuisance, under-recording is a hole.
 *
 * `rowCount` is therefore what was SELECTED and about to be written, established by counting first.
 * A separate count query on a scoped, filtered set is cheap and makes the audit entry exact rather
 * than approximate.
 *
 * ## Scope applies
 *
 * The same predicate as the list. A Latakia-scoped agent exporting "all bookings" gets Latakia's —
 * and the audit row records the filters they asked for, so the difference is reconstructible.
 */
@Injectable()
export class BookingExportService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * Builds the CSV and records the export.
   *
   * Returns a string rather than a stream. At the 20,000-row ceiling that is roughly 2MB, which is
   * well within a response buffer — and a string lets the audit row and the payload be produced
   * from one consistent read, which a stream interleaved with a transaction cannot promise.
   */
  async toCsv(
    actor: AccessTokenClaims | undefined,
    filters: ExportFilters,
  ): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
    const conditions: SQL[] = [
      sql`b.deleted_at IS NULL`,
      scopeFilter(actor, 'b.city_id'),
    ];

    if (filters.status) {
      conditions.push(sql`b.status = ${filters.status}::booking_status`);
    }

    if (filters.q) {
      const term = `%${filters.q}%`;

      conditions.push(
        sql`(b.reference ILIKE ${filters.q + '%'}
             OR p.name_ar ILIKE ${term}
             OR p.name_en ILIKE ${term}
             OR c.full_name ILIKE ${term})`,
      );
    }

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const counted = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM bookings b
      LEFT JOIN properties p        ON p.id = b.property_id
      LEFT JOIN customer_profiles c ON c.id = b.customer_profile_id
      ${where}
    `);

    const total = Number(counted.rows[0]?.n ?? 0);
    const truncated = total > MAX_ROWS;

    const rows = await this.db.execute<{
      reference: string;
      property: string;
      customer: string;
      check_in: string;
      check_out: string;
      amount: string;
      currency: string;
      status: string;
    }>(sql`
      SELECT b.reference,
             coalesce(p.name_ar, p.name_en, '—') AS property,
             coalesce(c.full_name, '—')          AS customer,
             to_char(b.check_in,  'YYYY-MM-DD')  AS check_in,
             to_char(b.check_out, 'YYYY-MM-DD')  AS check_out,
             b.total_amount::text                AS amount,
             coalesce(cur.code, '')              AS currency,
             b.status::text                      AS status
      FROM bookings b
      LEFT JOIN properties p        ON p.id = b.property_id
      LEFT JOIN customer_profiles c ON c.id = b.customer_profile_id
      LEFT JOIN currencies cur      ON cur.id = b.currency_id
      ${where}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${MAX_ROWS}
    `);

    /*
      Recorded before the bytes leave, with everything Bashar asked for: who, when (the audit row's
      own `created_at`), which filters, and how many records. `audit_log` is append-only by trigger,
      so this entry is immutable and shows up in سجل التدقيق like any other.
    */
    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'booking.exported',
      subjectType: 'booking_export',
      subjectId: null,
      after: {
        format: 'csv',
        filters: {
          q: filters.q ?? null,
          status: filters.status ?? null,
        },
        rowCount: rows.rows.length,
        matchedCount: total,
        truncated,
        /* Whether the exporter's own scope narrowed the set — the audit reader needs to know. */
        scoped: actor?.scope?.kind === 'cities',
      },
    });

    const lines: string[] = [HEADER.join(',')];

    for (const row of rows.rows) {
      lines.push(
        [
          row.reference,
          row.property,
          row.customer,
          row.check_in,
          row.check_out,
          row.amount,
          row.currency,
          row.status,
        ]
          .map(csvCell)
          .join(','),
      );
    }

    if (truncated) {
      // Truncation is STATED in the file. A silently short CSV looks complete.
      lines.push(`# truncated at ${MAX_ROWS} of ${total} rows; narrow the filter`);
    }

    /*
      A UTF-8 BOM. Without it Excel on Windows reads the file as the system codepage and every
      Arabic property name becomes mojibake — which is most of this file's content.
    */
    return {
      csv: `\uFEFF${lines.join('\n')}\n`,
      rowCount: rows.rows.length,
      truncated,
    };
  }
}

/**
 * Escapes one CSV cell.
 *
 * Quotes anything containing a comma, a quote or a newline, per RFC 4180 — and also prefixes an
 * apostrophe to anything starting with `=`, `+`, `-` or `@`, which spreadsheet software interprets
 * as a FORMULA. A property name beginning with `=` would otherwise execute on open: a real path
 * from a partner-supplied string to code running on a finance officer's laptop.
 */
function csvCell(value: string): string {
  const dangerous = /^[=+\-@\t\r]/.test(value);
  const needsQuotes = dangerous || /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');

  return needsQuotes ? `"${dangerous ? `'${escaped}` : escaped}"` : escaped;
}
