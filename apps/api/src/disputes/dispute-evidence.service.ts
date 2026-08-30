import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ImageService } from '../storage/image.service.js';
import { StorageService } from '../storage/storage.service.js';
import { MEDIA_JOB, evidenceJobId, type MediaJobData } from '../queue/media.job.js';
import { JOB_OPTIONS, QUEUE } from '../queue/queue.definitions.js';
import { MEDIA_QUEUE } from '../queue/queue.tokens.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { scopeFilter, assertCanWrite } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** What a photograph on a dispute looks like to whoever is allowed to see it. */
export interface DisputeEvidence {
  readonly id: string;
  /**
   * Whether the worker has produced anything to look at yet.
   *
   * Deliberately NOT a URL. The bytes are private and are served by an authorised route — see
   * `readFile` — so the address is the same for every piece of evidence and there is nothing to
   * hand out. What a caller needs to know is whether the picture exists yet.
   */
  readonly rendered: boolean;
  readonly fileName: string;
  readonly at: string;
  /** `true` when a staff member filed it rather than the customer. */
  readonly byStaff: boolean;
}

/** The width evidence is shown at — a photograph read on a screen, not zoomed into. */
export const EVIDENCE_WIDTH = 800;

/**
 * Which rendered object to serve — the widest variant that ACTUALLY EXISTS at or below the target.
 *
 * The pipeline never upscales, so a 640px photograph produces 400 and 640 and NO 800: asking for a
 * fixed width addresses an object that was never written, which is a 404 behind a picture the row
 * says is fine. That shipped once on ad creatives (2026-08-27); `creativeUrl` and
 * `apps/web/src/lib/property.ts` are the same three lines for the same reason.
 *
 * `null` while the worker has not run.
 */
export function evidenceVariant(variantWidths: readonly number[] | null): number | null {
  if (variantWidths === null || variantWidths.length === 0) return null;

  const available = [...variantWidths].sort((a, b) => a - b);

  return (
    available.filter((width) => width <= EVIDENCE_WIDTH).pop() ??
    available[0] ??
    EVIDENCE_WIDTH
  );
}

/**
 * Photographs attached to a dispute — EC-007's, above all.
 *
 * ## The gap this closes
 *
 * `dispute_evidence` has existed since the first migration, the console has rendered a COUNT of it
 * since النزاعات was built, and nothing anywhere could write a row: zero, platform-wide, on
 * 2026-08-27. So «الغرفة لا تطابق الصور المنشورة» — a claim that is settled by looking at a
 * photograph — was decided without one, while a screen offered to tell an operator how many there
 * were. Reported in that day's review and closed on Bashar's instruction the next.
 *
 * ## The same pipeline, for the same reason as the ad creative
 *
 * Because the security lives in the pipeline, not in the caller. `ImageService.inspect` refuses
 * anything whose magic bytes are not a supported photograph, the worker DECODES and RE-ENCODES
 * every byte — destroying polyglots, stripping EXIF including the GPS coordinates of somebody's
 * home — and nothing the uploader sent is ever served. A second implementation would be a second
 * place for one of those to be forgotten.
 *
 * EXIF matters more here than anywhere else on the platform: this is a photograph taken inside a
 * room, by a person, on their own phone, and it is filed in anger.
 *
 * ## Append-only, deliberately
 *
 * The table has `created_at` and no `updated_at` or `deleted_at`, and this service adds nothing
 * that changes that. «Evidence that can be edited or removed after the fact is not evidence» —
 * the schema's own words, and the reason there is no delete here for either actor.
 */
@Injectable()
export class DisputeEvidenceService {
  private readonly logger = new Logger(DisputeEvidenceService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly images: ImageService,
    private readonly storage: StorageService,
    @Inject(MEDIA_QUEUE) private readonly media: Queue<MediaJobData>,
  ) {}

  /**
   * A photograph filed by the CUSTOMER on their own dispute.
   *
   * The dispute is resolved by reference WITHIN the caller's own profile, in one query — the same
   * shape `DisputeRequestService` uses and for the same reason: a branch that fetches and then
   * compares answers differently for «exists and is not yours» than for «does not exist», and a
   * `DSP-` is sequential enough to walk.
   */
  async addAsCustomer(
    claims: AccessTokenClaims | undefined,
    reference: string,
    file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<DisputeEvidence> {
    const found = await this.db.execute<{ id: string; status: string }>(sql`
      SELECT d.id, d.status::text AS status
      FROM disputes d
      JOIN customer_profiles c ON c.id = d.customer_profile_id
      WHERE d.reference = ${reference} AND d.deleted_at IS NULL
        AND c.user_id = ${claims?.sub}::uuid
      LIMIT 1
    `);

    return this.add(found.rows[0], reference, file, claims, null);
  }

  /**
   * A photograph filed by a STAFF member — a complaint taken over the telephone with a picture
   * sent afterwards, which is the ordinary way one arrives.
   *
   * Scoped like every other write on a dispute: the predicate so an out-of-scope reference answers
   * exactly as one that does not exist, then `assertCanWrite` so a `read_only` member who may read
   * the queue cannot add to a file they are only permitted to look at.
   */
  async addAsStaff(
    claims: AccessTokenClaims | undefined,
    reference: string,
    file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<DisputeEvidence> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      city_id: string | null;
    }>(sql`
      SELECT d.id, d.status::text AS status, b.city_id
      FROM disputes d
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE d.reference = ${reference} AND d.deleted_at IS NULL
        AND ${scopeFilter(claims, 'b.city_id')}
      LIMIT 1
    `);

    const dispute = found.rows[0];

    if (dispute) assertCanWrite(claims, dispute.city_id);

    return this.add(dispute, reference, file, claims, claims?.sub ?? null);
  }

  /**
   * Everything both routes share, once the dispute has been resolved and authorised.
   *
   * ## A closed dispute takes no more evidence
   *
   * The file is the record of a decision that has been made. Adding to it afterwards would leave
   * a resolution that cannot be read against what was in front of the person who wrote it — and if
   * there is genuinely something new, §10's answer is to raise the dispute again, which is what the
   * rejection email tells the customer to do.
   */
  private async add(
    dispute: { id: string; status: string } | undefined,
    reference: string,
    file: { buffer: Buffer; originalname: string } | undefined,
    claims: AccessTokenClaims | undefined,
    uploadedBy: string | null,
  ): Promise<DisputeEvidence> {
    if (!dispute) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw badRequest(ERROR.DISPUTE_ALREADY_CLOSED);
    }

    if (!file?.buffer) throw badRequest(ERROR.UPLOAD_FILE_MISSING);

    /* Cheap, and it throws — a file that is not a usable photograph never reaches storage. */
    const inspected = await this.images.inspect(file.buffer);

    const fileKey = this.images.keyFor({ kind: 'disputes', owner: reference });
    const originalKey = this.images.incomingKeyFor(fileKey);

    /*
      Stored BEFORE the row points at it, so the row is never a promise the storage cannot keep —
      the same ordering, and the same reasoning, as every other upload here.
    */
    await this.storage.put(originalKey, file.buffer, 'application/octet-stream');

    const made = await this.db.transaction(async (tx) => {
      const inserted = await tx.execute<{ id: string; at: string }>(sql`
        INSERT INTO dispute_evidence
          (dispute_id, kind, file_name, storage_key, content_type, size_bytes,
           uploaded_by_user_id)
        VALUES (${dispute.id}::uuid, 'photo', ${file.originalname}, ${fileKey},
                ${`image/${inspected.format}`}, ${file.buffer.length},
                ${uploadedBy}::uuid)
        RETURNING id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'dispute.evidence_added',
          subjectType: 'dispute',
          subjectId: dispute.id,
          after: {
            fileKey,
            /* Recorded for support, never used as a key. */
            uploadedAs: file.originalname,
            byStaff: uploadedBy !== null,
          },
        },
        tx as unknown as Database,
      );

      return inserted.rows[0];
    });

    /*
      After the commit, and its failure is swallowed — an enqueue that throws must not undo an
      upload the person has been told succeeded. The row is the durable record and points at the
      original, which is what a re-drive needs.
    */
    try {
      await this.media.add(
        MEDIA_JOB,
        { imageId: made?.id ?? '', originalKey, fileKey, subject: 'dispute_evidence' },
        { ...JOB_OPTIONS.media, jobId: evidenceJobId(fileKey) },
      );
    } catch (error) {
      this.logger.error(
        `Could not enqueue rendering for evidence on ${reference}: ${describeError(error)}. ` +
          `The row is stored and recoverable by re-drive on the ${QUEUE.media} queue.`,
      );
    }

    return {
      id: made?.id ?? '',
      /* Nothing is rendered yet; the reader is shown a placeholder until the worker has run. */
      rendered: false,
      fileName: file.originalname,
      at: made?.at ?? '',
      byStaff: uploadedBy !== null,
    };
  }

  /**
   * Retiring one photograph — «حذف».
   *
   * ## Why a table built append-only now has a removal
   *
   * Its own note said «evidence that can be edited or removed after the fact is not evidence»,
   * which is right about the RECORD and wrong about the frame. A photograph gets filed by mistake,
   * twice, or with somebody else's face and address in it, and a file that can never be corrected
   * is its own integrity problem — and a compliance one where the frame holds personal data
   * nobody consented to. Bashar asked for it on 2026-08-30.
   *
   * ## So nothing is destroyed
   *
   * `deleted_at`, never a DELETE, with `dispute.evidence_removed` beside it: the row stays, who
   * removed it and when is answerable from the audit log, and the picture stops counting and stops
   * being served. «Replace» on the console is this followed by an upload — two audited events —
   * rather than new bytes under an old id, because a row whose bytes changed would make the
   * resolution unreadable against what the decision was actually made from.
   *
   * ## A closed dispute takes no removals
   *
   * The same rule, and the same sentence, as `add`: the file is the record of a decision that has
   * been made, and emptying it afterwards leaves a resolution nobody can check.
   *
   * ## Staff only, scoped, and idempotent
   *
   * The customer's route does not reach here. A second press finds a row already retired and
   * answers «nothing changed» rather than an error, because the card can be double-clicked.
   */
  async remove(
    claims: AccessTokenClaims | undefined,
    evidenceId: string,
  ): Promise<{ removed: boolean }> {
    const found = await this.db.execute<{
      id: string;
      dispute_id: string;
      status: string;
      city_id: string | null;
      file_name: string;
      already: boolean;
    }>(sql`
      SELECT e.id, e.dispute_id, d.status::text AS status, b.city_id, e.file_name,
             (e.deleted_at IS NOT NULL) AS already
      FROM dispute_evidence e
      JOIN disputes d      ON d.id = e.dispute_id AND d.deleted_at IS NULL
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE e.id = ${evidenceId}::uuid
        AND ${scopeFilter(claims, 'b.city_id')}
      LIMIT 1
    `);

    const evidence = found.rows[0];

    /* An id outside this reader's cities answers exactly as one that does not exist. */
    if (!evidence) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    assertCanWrite(claims, evidence.city_id);

    if (evidence.status === 'resolved' || evidence.status === 'rejected') {
      throw badRequest(ERROR.DISPUTE_ALREADY_CLOSED);
    }

    /* Already retired: nothing changes, and no audit row for an event that did not happen. */
    if (evidence.already) return { removed: false };

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE dispute_evidence SET deleted_at = now()
        WHERE id = ${evidence.id}::uuid AND deleted_at IS NULL
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'dispute.evidence_removed',
          subjectType: 'dispute',
          subjectId: evidence.dispute_id,
          /* The name it was filed under, so the log says WHICH photograph went. */
          before: { uploadedAs: evidence.file_name },
        },
        tx as unknown as Database,
      );
    });

    return { removed: true };
  }

  /**
   * The photographs on one dispute, oldest first.
   *
   * No scope check of its own: both callers have already resolved the dispute under their own
   * authorisation — the customer within their profile, staff within their cities — and pass the id
   * they were given. Taking a reference here instead would be a second place for that check to be
   * forgotten.
   */
  async forDispute(disputeId: string): Promise<DisputeEvidence[]> {
    const rows = await this.db.execute<{
      id: string;
      storage_key: string;
      file_name: string;
      variant_widths: number[] | null;
      at: string;
      by_staff: boolean;
    }>(sql`
      SELECT id, storage_key, file_name, variant_widths,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
             (uploaded_by_user_id IS NOT NULL) AS by_staff
      FROM dispute_evidence
      WHERE dispute_id = ${disputeId}::uuid AND deleted_at IS NULL
      ORDER BY created_at, id
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      rendered: evidenceVariant(row.variant_widths) !== null,
      fileName: row.file_name,
      at: row.at,
      byStaff: row.by_staff,
    }));
  }

  /**
   * The BYTES of one photograph, for somebody entitled to look at it.
   *
   * ## Why this is not a public URL
   *
   * Because it is a photograph of the inside of somebody's home, filed in a complaint. Listing
   * photographs and ad creatives are published on purpose and their prefixes are anonymously
   * readable; evidence is not, and the schema said so from the first migration — «no file is served
   * without an authorization check per request». Making it public would have been one line in the
   * bucket policy and a privacy failure nobody would have noticed until it mattered.
   *
   * ## Who may look
   *
   * The customer whose dispute it is, and staff within their cities holding `dispute.manage`. The
   * check is the same query that authorises writing, so there is no second definition of «yours» to
   * drift — and an id that is not yours answers exactly as one that does not exist.
   */
  async readFile(
    evidenceId: string,
    claims: AccessTokenClaims | undefined,
    as: 'customer' | 'staff',
  ): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
    const found = await this.db.execute<{
      storage_key: string;
      file_name: string;
      variant_widths: number[] | null;
      city_id: string | null;
    }>(
      as === 'customer'
        ? sql`
            SELECT e.storage_key, e.file_name, e.variant_widths, b.city_id
            FROM dispute_evidence e
            JOIN disputes d           ON d.id = e.dispute_id AND d.deleted_at IS NULL
            JOIN customer_profiles c  ON c.id = d.customer_profile_id
            LEFT JOIN bookings b      ON b.id = d.booking_id
            WHERE e.id = ${evidenceId}::uuid AND e.deleted_at IS NULL
              AND c.user_id = ${claims?.sub}::uuid
            LIMIT 1
          `
        : sql`
            SELECT e.storage_key, e.file_name, e.variant_widths, b.city_id
            FROM dispute_evidence e
            JOIN disputes d      ON d.id = e.dispute_id AND d.deleted_at IS NULL
            LEFT JOIN bookings b ON b.id = d.booking_id
            WHERE e.id = ${evidenceId}::uuid AND e.deleted_at IS NULL
              AND ${scopeFilter(claims, 'b.city_id')}
            LIMIT 1
          `,
    );

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    const width = evidenceVariant(row.variant_widths);

    /* Not rendered yet: nothing to serve, and «not there» is the honest answer. */
    if (width === null) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    /*
      The RE-ENCODED variant, never the original. The original sits under the private `incoming/`
      prefix and is the bytes somebody uploaded; what we serve is what our own renderer produced,
      which is the whole reason the pipeline exists.
    */
    const bytes = await this.storage.get(`${row.storage_key}-${width}.avif`);

    if (!bytes) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    return { bytes, contentType: 'image/avif', fileName: row.file_name };
  }
}
