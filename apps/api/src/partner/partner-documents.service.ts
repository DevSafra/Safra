import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';

import type { Database } from '@safra/db';
import type { PartnerDocumentKind } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { MailService } from '../mail/mail.service.js';
import { partnerDocumentsCompleteMail } from '../mail/mail.templates.js';
import { hasRequiredDocuments, pairsSatisfied } from './required-documents.js';
import { StorageService } from '../storage/storage.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';

/** §8.1 requires proof of identity and of the right to let the property. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_PARTNER = 20;

export interface UploadedDocument {
  readonly buffer: Buffer;
  readonly originalname: string;
  readonly mimetype: string;
}

export interface DocumentRecord {
  readonly id: string;
  readonly kind: string;
  readonly fileName: string;
  readonly status: string;
  readonly reviewNotes: string | null;
  readonly createdAt: string;
}

/**
 * Partner verification documents (SRS §8.1, roadmap item 82).
 *
 * These are identity documents — a passport page, a commercial register extract —
 * held by a German entity, so they are treated as the most sensitive partner data
 * after payout details:
 *
 *  - **Never public.** Property images get a CDN URL; these are read back through an
 *    authorised handler that records who looked. `publicUrl` is not used, and a
 *    document key never leaves the server.
 *  - **Type is proved by CONTENT, not by the Content-Type header**, which the client
 *    chooses and can lie about.
 *  - **Images are re-encoded, PDFs are not.** Re-encoding an image strips EXIF (a
 *    phone photo of an ID carries the GPS coordinates of wherever it was taken) and
 *    destroys any polyglot payload hiding in the container. A PDF cannot survive
 *    that treatment, so it is stored verbatim and defended at the READ side instead
 *    — served as an attachment, with nosniff, never inline.
 *
 * Retention is deliberately absent: nothing deletes these on a schedule. Under a
 * German entity that is a legal question (roadmap item 195), and inventing a period
 * would be worse than leaving it visibly open.
 */
@Injectable()
export class PartnerDocumentsService {
  private readonly logger = new Logger(PartnerDocumentsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async upload(
    partnerId: string,
    kind: PartnerDocumentKind,
    file: UploadedDocument | undefined,
    actor: AccessTokenClaims | undefined,
  ): Promise<DocumentRecord> {
    if (!file?.buffer?.byteLength) {
      throw badRequest(ERROR.UPLOAD_FILE_MISSING);
    }

    if (file.buffer.byteLength > MAX_BYTES) {
      throw badRequest(ERROR.UPLOAD_FILE_TOO_LARGE, { maxMb: 8 });
    }

    const detected = detectType(file.buffer);

    if (!detected) {
      /**
       * Deliberately does not echo what was detected. A precise "this looked like a
       * ZIP" is a probing oracle for what the filter accepts; the caller only needs
       * to know which formats are allowed.
       */
      throw badRequest(ERROR.DOCUMENT_TYPE_UNSUPPORTED);
    }

    const existing = await this.db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM partner_documents
      WHERE partner_id = ${partnerId} AND deleted_at IS NULL
    `);

    if (Number(existing.rows[0]?.count ?? 0) >= MAX_PER_PARTNER) {
      throw badRequest(ERROR.DOCUMENT_LIMIT_REACHED, { max: MAX_PER_PARTNER });
    }

    /*
      Whether §8.1 was ALREADY satisfied, read before the insert.

      It used to ask whether this KIND was covered, which was the right half-question while the set
      was "all five kinds": every kind was required, so a new kind could only ever be a step toward
      completion. Under §8.1's «أو» pairs it is wrong — `bank_confirmation` and the second option in
      a pair are both new kinds that complete NOTHING, and the notice fired again for each of them.

      Asking about the SET is the question that was always meant: notify when this upload moved the
      partner from incomplete to complete, and at no other time. It subsumes the old check —
      replacing a settled document leaves the set already satisfied, so it stays quiet — while
      still firing after a rejection, because a rejected document stops counting.
    */
    const wasComplete = await hasRequiredDocuments(this.db, partnerId);

    const { body, contentType, extension } = await this.normalise(file.buffer, detected);

    /**
     * The key is generated here and never derived from the uploaded filename. A
     * caller-controlled key is a path traversal write, and a predictable one is an
     * enumeration target for anything that ever serves these by key.
     */
    const key = `partners/${partnerId}/documents/${randomUUID()}.${extension}`;

    await this.storage.put(key, body, contentType);

    const inserted = await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; created_at: string }>(sql`
        INSERT INTO partner_documents (partner_id, kind, file_key, file_name)
        VALUES (${partnerId}, ${kind}, ${key}, ${safeFileName(file.originalname)})
        RETURNING id, created_at::text AS created_at
      `);

      const row = rows.rows[0];
      if (!row) throw new Error('Document insert returned no row.');

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_document.uploaded',
          subjectType: 'partner',
          subjectId: partnerId,
          // The KEY is recorded, never the bytes and never a URL.
          after: { documentId: row.id, kind, contentType },
        },
        tx as unknown as Database,
      );

      return row;
    });

    this.logger.log(`Partner ${partnerId} uploaded a ${kind} document.`);

    /*
      AFTER the commit, and it can never fail the upload.

      A partner whose fifth document was stored successfully must not be told the upload failed
      because an SMTP server was down — they would send it again, and the reviewer would get a
      duplicate instead of a notification. `MailService.send` already resolves on failure; the
      catch here covers the QUERIES, which do not.
    */
    await this.notifyStaffIfComplete(partnerId, wasComplete).catch((error: unknown) => {
      this.logger.error(
        `Could not notify staff about ${partnerId}'s documents: ` +
          `${describeError(error)}`,
      );
    });

    return {
      id: inserted.id,
      kind,
      fileName: safeFileName(file.originalname),
      status: 'pending',
      reviewNotes: null,
      createdAt: new Date(inserted.created_at).toISOString(),
    };
  }

  /** As `list`, resolving the partner by their §13.2 reference. */
  async listByReference(reference: string): Promise<DocumentRecord[]> {
    return this.list(await this.partnerIdOf(reference));
  }

  /**
   * Staff filing a document on a partner's behalf, keyed on the §13.2 reference.
   *
   * ## Why staff may upload at all
   *
   * Because of where onboarding now happens. A super admin sitting with a partner has their
   * passport and their commercial register ON THE TABLE (Bashar, 2026-08-23); telling that partner
   * to go home, find an inbox, redeem an invitation and upload them is the round trip the
   * in-person flow exists to remove.
   *
   * ## It is the same upload, deliberately
   *
   * This delegates to `upload` rather than reimplementing it, so a staff-filed document goes
   * through every control a partner-filed one does — the magic-byte type check, the EXIF-stripping
   * re-encode, the size and per-partner ceilings, the generated storage key, and the same audit
   * entry. A second upload path would be a second place for one of those to be forgotten, and the
   * one that was forgotten would be the interesting one.
   *
   * What differs is only the ACTOR on the audit row, which is the caller's claims either way — so
   * the log already distinguishes "the partner sent this" from "a super admin filed this for
   * them" without a flag saying so.
   */
  async uploadByReference(
    reference: string,
    kind: PartnerDocumentKind,
    file: UploadedDocument | undefined,
    actor: AccessTokenClaims | undefined,
  ): Promise<DocumentRecord> {
    return this.upload(await this.partnerIdOf(reference), kind, file, actor);
  }

  /**
   * A partner's uuid from their reference.
   *
   * A missing partner and a soft-deleted one answer the same way, which is the house rule: "not
   * yours" and "not there" must be indistinguishable, or the difference between them is an
   * enumeration oracle.
   */
  private async partnerIdOf(reference: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partners WHERE reference = ${reference} AND deleted_at IS NULL
    `);

    const partnerId = rows.rows[0]?.id;
    if (!partnerId) throw notFound(ERROR.PARTNER_NOT_FOUND);

    return partnerId;
  }

  /** Metadata only — the bytes are never included in a list. */
  async list(partnerId: string): Promise<DocumentRecord[]> {
    const rows = await this.db.execute<{
      id: string;
      kind: string;
      file_name: string;
      status: string;
      review_notes: string | null;
      created_at: string;
    }>(sql`
      SELECT id, kind, file_name, status::text AS status, review_notes,
             created_at::text AS created_at
      FROM partner_documents
      WHERE partner_id = ${partnerId} AND deleted_at IS NULL
      ORDER BY created_at DESC
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      fileName: row.file_name,
      status: row.status,
      reviewNotes: row.review_notes,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  /**
   * Reads a document's bytes for a reviewer, and records that it happened.
   *
   * The audit row is the point as much as the bytes are. Someone opening a
   * stranger's passport scan is exactly the access a later investigation asks
   * about, and "who has viewed this?" has to be answerable from the trail rather
   * than from web-server logs.
   *
   * `restrictToPartnerId` scopes the lookup for a partner reading their own file;
   * staff pass undefined and are gated by the permission on the route instead.
   */
  async read(
    documentId: string,
    actor: AccessTokenClaims | undefined,
    restrictToPartnerId?: string,
  ): Promise<{ body: Buffer; fileName: string; contentType: string }> {
    const rows = await this.db.execute<{
      partner_id: string;
      file_key: string;
      file_name: string;
    }>(sql`
      SELECT partner_id, file_key, file_name FROM partner_documents
      WHERE id = ${documentId} AND deleted_at IS NULL
    `);

    const doc = rows.rows[0];

    // 404 rather than 403 for someone else's document: a 403 confirms it exists.
    if (!doc) throw notFound(ERROR.DOCUMENT_NOT_FOUND);

    if (restrictToPartnerId && doc.partner_id !== restrictToPartnerId) {
      throw notFound(ERROR.DOCUMENT_NOT_FOUND);
    }

    const body = await this.storage.get(doc.file_key);

    if (!body) {
      this.logger.error(`Document ${documentId} has no object at ${doc.file_key}.`);
      throw notFound(ERROR.DOCUMENT_NOT_FOUND);
    }

    await this.audit.record({
      actorUserId: actor?.sub,
      actorRole: actor?.role,
      action: 'partner_document.viewed',
      subjectType: 'partner',
      subjectId: doc.partner_id,
      after: { documentId },
    });

    return {
      body,
      fileName: doc.file_name,
      contentType: contentTypeForKey(doc.file_key),
    };
  }

  /**
   * A reviewer's decision on one document (§8.1, roadmap item 121).
   *
   * Per document rather than per partner, because "your paperwork was rejected" is
   * useless feedback — a partner needs to know that the ownership proof was
   * illegible while the ID was fine.
   */
  async review(
    documentId: string,
    decision: 'approve' | 'reject',
    notes: string | undefined,
    actor: AccessTokenClaims | undefined,
  ): Promise<DocumentRecord> {
    if (decision === 'reject' && !notes?.trim()) {
      throw badRequest(ERROR.DOCUMENT_REJECTION_REASON_REQUIRED);
    }

    // `approved`, not `verified` — the enum is shared with partner and property
    // review, and using the wrong label would fail at the cast rather than silently.
    const status = decision === 'approve' ? 'approved' : 'rejected';

    const updated = await this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        partner_id: string;
        kind: string;
        file_name: string;
        status: string;
        review_notes: string | null;
        created_at: string;
      }>(sql`
        UPDATE partner_documents
        SET status = ${status}::verification_status,
            reviewed_by_user_id = ${actor?.sub ?? null},
            reviewed_at = now(),
            review_notes = ${notes?.trim() ?? null},
            updated_at = now()
        WHERE id = ${documentId} AND deleted_at IS NULL
        RETURNING id, partner_id, kind, file_name, status::text AS status,
                  review_notes, created_at::text AS created_at
      `);

      const row = rows.rows[0];
      if (!row) throw notFound(ERROR.DOCUMENT_NOT_FOUND);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: 'partner_document.reviewed',
          subjectType: 'partner',
          subjectId: row.partner_id,
          after: { documentId, kind: row.kind, status },
          reason: notes?.trim() ?? null,
        },
        tx as unknown as Database,
      );

      return row;
    });

    return {
      id: updated.id,
      kind: updated.kind,
      fileName: updated.file_name,
      status: updated.status,
      reviewNotes: updated.review_notes,
      createdAt: new Date(updated.created_at).toISOString(),
    };
  }

  /**
   * Re-encodes an image, passes a PDF through.
   *
   * `sharp` on an image is doing two jobs: stripping metadata (a photo of an ID
   * carries the GPS coordinates of wherever it was taken) and guaranteeing the
   * output is a real image, because anything that is not decodable does not survive
   * a decode. Quality is high and dimensions are untouched — a reviewer has to be
   * able to read a registration number off it.
   */
  private async normalise(
    buffer: Buffer,
    detected: 'pdf' | 'jpeg' | 'png',
  ): Promise<{ body: Buffer; contentType: string; extension: string }> {
    if (detected === 'pdf') {
      return { body: buffer, contentType: 'application/pdf', extension: 'pdf' };
    }

    try {
      const body = await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer();

      return { body, contentType: 'image/jpeg', extension: 'jpg' };
    } catch {
      // Magic bytes said image, the decoder disagreed. Trust the decoder.
      throw badRequest(ERROR.UPLOAD_IMAGE_UNREADABLE);
    }
  }

  /**
   * Tells staff, ONCE, that a partner's documents are all in (Bashar, 2026-08-21).
   *
   * ## The problem it closes
   *
   * A partner uploading their documents produced no signal a staff member could see. The console's
   * verification queue counts partners `pending`, and a partner is pending from the day their
   * account is made — so the number was identical before and after the upload. The one moment when
   * there is suddenly work to do was the one moment nothing changed.
   *
   * ## Once, on the TRANSITION, not per file
   *
   * A partner sends five documents in a minute. Five emails about one thing to do is how a team
   * learns to filter the sender, and then the sixth email — the one that mattered — is filtered
   * too. So this fires only when the upload just made the set complete: everything settled now,
   * and this kind outstanding a moment ago.
   *
   * That also makes a REPLACEMENT behave correctly in both directions. Re-sending a rejected
   * document completes the set again and sends again, which is right — it is new work. Replacing a
   * document that was already fine changes nothing and stays silent, which is also right.
   *
   * ## Who receives it
   *
   * Every active `super_admin`. Not a configured address, because an address in an env var is one
   * more thing to keep in step with who actually works here, and it survives their leaving. Not
   * every staff role either: `PARTNER_DOCUMENT_REVIEW` is held more widely, and a mailbox that
   * fills with other people's queues is a mailbox nobody reads.
   *
   * ## What it does not do
   *
   * It does not fail the upload, it does not carry a document, and it does not name the staff
   * addresses in the log — the audit of 2026-08-14 found exactly that shape and it is not being
   * reintroduced for a count.
   */
  private async notifyStaffIfComplete(
    partnerId: string,
    wasComplete: boolean,
  ): Promise<void> {
    /* Already complete before this upload, so nothing transitioned. Cheapest check first. */
    if (wasComplete) return;

    const state = await this.db.execute<{
      settled: boolean;
      pending: string;
      reference: string;
      display_name: string;
    }>(sql`
      SELECT
        ${pairsSatisfied(sql`${partnerId}`)} AS settled,
        (SELECT COUNT(*)::text FROM partner_documents
          WHERE partner_id = ${partnerId} AND status = 'pending' AND deleted_at IS NULL)
          AS pending,
        p.reference, p.display_name
      FROM partners p
      WHERE p.id = ${partnerId} AND p.deleted_at IS NULL
    `);

    const row = state.rows[0];

    if (!row) return;
    /*
      §8.1's rule, not "all five kinds" — corrected 2026-08-26.

      This required every kind in `PARTNER_DOCUMENT_KINDS`, including `bank_confirmation`, which
      the SRS does not name as a verification document, and BOTH halves of each «أو» pair. So a
      partner who had satisfied §8.1 — and whom the console would now happily activate — was never
      told they had finished, and staff were never told either. `required-documents.ts` holds the
      one definition both sides read.
    */
    if (!row.settled) return;

    const staff = await this.db.execute<{ email: string; locale: string }>(sql`
      SELECT email, preferred_locale AS locale
      FROM users
      WHERE role = 'super_admin' AND status = 'active' AND deleted_at IS NULL
    `);

    if (staff.rows.length === 0) {
      /* Worth a line: the platform has just decided nobody needs to know something. */
      this.logger.warn(
        `Partner ${partnerId} completed their documents and no active super admin exists to tell.`,
      );

      return;
    }

    const url = `${this.env.ADMIN_URL}/partners/${row.reference}`;

    await Promise.all(
      staff.rows.map((recipient) =>
        this.mail.send(
          partnerDocumentsCompleteMail({
            to: recipient.email,
            reference: row.reference,
            displayName: row.display_name,
            documentCount: Number(row.pending),
            url,
            locale: recipient.locale,
          }),
        ),
      ),
    );

    /* The COUNT of recipients, never their addresses. */
    this.logger.log(
      `Notified ${staff.rows.length} super admin(s) that ${row.reference} completed their documents.`,
    );
  }
}

/**
 * Identifies a file by its leading bytes.
 *
 * The `Content-Type` header is chosen by the client and means nothing — an
 * executable announced as `application/pdf` would pass a header check and fail this
 * one. Only these three formats are accepted; anything else, including formats that
 * merely look harmless, is rejected.
 */
export function detectType(buffer: Buffer): 'pdf' | 'jpeg' | 'png' | null {
  if (buffer.length < 8) return null;

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(png)) return 'png';

  return null;
}

/** The stored content type, derived from OUR key rather than anything remembered. */
function contentTypeForKey(key: string): string {
  return key.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
}

/**
 * Keeps the original filename only as a label for the reviewer.
 *
 * Stripped of directory separators and control characters, and length-capped. It is
 * never used to build a storage key or a filesystem path — it exists so a reviewer
 * sees "commercial-register.pdf" rather than a UUID.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    // Control characters, written as escapes so the intent survives a copy-paste:
    // NUL truncates a C string, and CR/LF would let a filename inject a header line
    // into the Content-Disposition this ends up in.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  return (cleaned.length > 0 ? cleaned : 'document').slice(0, 120);
}
