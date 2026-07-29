import { index, jsonb, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, foreignId, primaryId } from './_shared.js';
import { userRole } from './enums.js';
import { users } from './identity.js';

/**
 * SRS §15: "an Audit Log that cannot be deleted, for every admin action, payment,
 * refund, status change, price edit, and partner approval/rejection", recording
 * IP, device, time and staff member.
 *
 * Immutability is enforced by a BEFORE UPDATE OR DELETE trigger installed in
 * migrations/post/0001_constraints.sql, which raises rather than allowing the
 * write. An audit trail the application can rewrite is not an audit trail — and
 * P-003 forbids deletion outright — so this is a database guarantee, not a code
 * convention. Verified by test: both UPDATE and DELETE are rejected.
 *
 * Written by a NestJS interceptor, not by hand at each call site: the one thing
 * worse than no audit log is one with gaps nobody noticed.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    /** Null for system-initiated actions (queue workers, scheduled jobs). */
    actorUserId: foreignId('actor_user_id').references(() => users.id),
    actorRole: userRole('actor_role'),
    /** "booking.status_changed", "partner.approved", "settings.updated", … */
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: foreignId('subject_id'),
    /** Changed fields only, before and after — not whole-row snapshots. */
    before: jsonb('before'),
    after: jsonb('after'),
    /** §15 explicitly requires IP and device on sensitive operations. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Correlates an audit row with API logs and traces for one request. */
    requestId: text('request_id'),
    reason: text('reason'),
    ...createdAt,
  },
  (t) => [
    index('audit_log_subject_idx').on(t.subjectType, t.subjectId, t.createdAt),
    index('audit_log_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_log_action_idx').on(t.action, t.createdAt),
    index('audit_log_created_idx').on(t.createdAt),
  ],
);
