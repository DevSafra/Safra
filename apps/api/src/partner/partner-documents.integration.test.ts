import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import {
  PartnerDocumentsService,
  detectType,
  safeFileName,
} from './partner-documents.service.js';
import { StorageService, type StoredObject } from '../storage/storage.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Partner verification documents (§8.1, item 82).
 *
 * These hold passport scans and commercial register extracts, so the tests are
 * mostly about refusals: what must not be accepted, what must not be readable by
 * the wrong partner, and what must always leave an audit row.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** In-memory storage: what matters is WHICH key was written, not where it landed. */
class MemoryStorage extends StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve({ key, contentType, size: body.byteLength });
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key)?.body ?? null);
  }

  publicUrl(key: string): string {
    throw new Error(`publicUrl must never be used for a document (${key}).`);
  }
}

const STAFF = {
  sub: '99993333-0000-0000-0000-0000000000c1',
  role: 'operations_manager',
} as unknown as AccessTokenClaims;

describeIfDb('partner verification documents', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  let db: Database;
  let storage: MemoryStorage;
  let documents: PartnerDocumentsService;
  let partnerId: string;
  let otherPartnerId: string;

  let pdf: Buffer;
  let png: Buffer;

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;
    storage = new MemoryStorage();
    documents = new PartnerDocumentsService(db, storage, new AuditService(db));

    // A minimal but genuine PDF, and a real PNG that sharp can decode.
    pdf = Buffer.from(
      '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
      'latin1',
    );
    png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#888' },
    })
      .png()
      .toBuffer();

    /**
     * The reviewer has to be a real row: `audit_log.actor_user_id` is a foreign key,
     * which is exactly the guarantee that makes the trail worth reading — an audit
     * entry attributed to nobody is not an audit entry.
     */
    await db.execute(sql`
      INSERT INTO users (id, email, role)
      VALUES (${STAFF.sub}::uuid, 'doc-reviewer@safra.test', 'operations_manager')
      ON CONFLICT DO NOTHING`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    // Cleared per test: several cases assert that NOTHING was stored, which only
    // means anything against an empty bucket.
    storage.objects.clear();

    partnerId = await createPartner(db);
    otherPartnerId = await createPartner(db);
  });

  function upload(buffer: Buffer, name = 'register.pdf') {
    return documents.upload(
      partnerId,
      'commercial_register',
      { buffer, originalname: name, mimetype: 'application/pdf' },
      STAFF,
    );
  }

  // ── What is accepted ────────────────────────────────────────────────────────

  it('stores a PDF verbatim', async () => {
    const record = await upload(pdf);

    expect(record.status).toBe('pending');

    const stored = [...storage.objects.entries()].find(([k]) => k.endsWith('.pdf'));

    expect(stored?.[1].contentType).toBe('application/pdf');
    // A PDF cannot be re-encoded the way an image can, so it must round-trip exactly.
    expect(stored?.[1].body.equals(pdf)).toBe(true);
  });

  /**
   * A phone photo of an ID carries the GPS coordinates of wherever it was taken.
   * Re-encoding strips that, and destroys anything hidden in the container.
   */
  it('re-encodes an image to JPEG, dropping its metadata', async () => {
    await documents.upload(
      partnerId,
      'identity',
      { buffer: png, originalname: 'id.png', mimetype: 'image/png' },
      STAFF,
    );

    const stored = [...storage.objects.values()][0];

    expect(stored?.contentType).toBe('image/jpeg');
    expect(detectType(stored?.body ?? Buffer.alloc(0))).toBe('jpeg');
  });

  // ── What is refused ─────────────────────────────────────────────────────────

  /**
   * The header is chosen by the client. An executable announced as a PDF passes a
   * header check and must fail this one.
   */
  it('rejects a file whose bytes are not a document, whatever it claims to be', async () => {
    const disguised = Buffer.from('MZ\x90\x00executable payload', 'latin1');

    await expect(
      documents.upload(
        partnerId,
        'identity',
        { buffer: disguised, originalname: 'id.pdf', mimetype: 'application/pdf' },
        STAFF,
      ),
    ).rejects.toThrow(/only pdf, jpeg and png/i);

    expect(storage.objects.size).toBe(0);
  });

  it('rejects an empty upload', async () => {
    await expect(upload(Buffer.alloc(0))).rejects.toThrow(/no file/i);
  });

  it('rejects a file over the size limit', async () => {
    const huge = Buffer.concat([pdf, Buffer.alloc(9 * 1024 * 1024)]);

    await expect(upload(huge)).rejects.toThrow(/larger than 8 MB/i);
    expect(storage.objects.size).toBe(0);
  });

  /** Nothing is stored when the row cannot be written, and vice versa. */
  it('does not record a document when validation fails', async () => {
    await expect(upload(Buffer.from('not a document'))).rejects.toThrow();

    expect(await documents.list(partnerId)).toHaveLength(0);
  });

  // ── Who can read it ─────────────────────────────────────────────────────────

  /**
   * 404 rather than 403: a 403 would confirm the document exists, which for a
   * sequential-feeling id is the difference between "no" and "keep guessing".
   */
  it('hides another partner’s document behind a 404', async () => {
    const record = await upload(pdf);

    await expect(documents.read(record.id, STAFF, otherPartnerId)).rejects.toThrow(
      /not found/i,
    );
  });

  it('lets the owning partner read their own', async () => {
    const record = await upload(pdf);
    const read = await documents.read(record.id, STAFF, partnerId);

    expect(read.body.equals(pdf)).toBe(true);
    expect(read.contentType).toBe('application/pdf');
  });

  it('reports a missing object as 404 rather than failing', async () => {
    const record = await upload(pdf);
    storage.objects.clear();

    await expect(documents.read(record.id, STAFF)).rejects.toThrow(/not found/i);
  });

  /**
   * The audit row is as much the point as the bytes. "Who opened this passport
   * scan?" has to be answerable from the trail, not from web-server logs.
   */
  it('records every view', async () => {
    const record = await upload(pdf);
    await documents.read(record.id, STAFF);

    const rows = await db.execute<{ after: unknown; actor: string | null }>(sql`
      SELECT after, actor_user_id AS actor FROM audit_log
      WHERE action = 'partner_document.viewed'
      ORDER BY created_at DESC LIMIT 1`);

    expect((rows.rows[0]?.after as { documentId?: string }).documentId).toBe(record.id);
    expect(rows.rows[0]?.actor).toBe(STAFF.sub);
  });

  // ── Review (item 121) ───────────────────────────────────────────────────────

  it('approves a document', async () => {
    const record = await upload(pdf);
    const reviewed = await documents.review(record.id, 'approve', undefined, STAFF);

    expect(reviewed.status).toBe('approved');
  });

  it('rejects with a reason the partner can act on', async () => {
    const record = await upload(pdf);
    const reviewed = await documents.review(
      record.id,
      'reject',
      'The register extract is older than three months.',
      STAFF,
    );

    expect(reviewed.status).toBe('rejected');
    expect(reviewed.reviewNotes).toMatch(/three months/);
  });

  /** "Rejected" with no reason makes the partner guess and re-upload blind. */
  it('refuses a rejection with no notes', async () => {
    const record = await upload(pdf);

    await expect(documents.review(record.id, 'reject', '   ', STAFF)).rejects.toThrow(
      /requires a reason/i,
    );
  });

  it('records the review decision in the audit trail', async () => {
    const record = await upload(pdf);
    await documents.review(record.id, 'approve', undefined, STAFF);

    const rows = await db.execute<{ after: unknown }>(sql`
      SELECT after FROM audit_log WHERE action = 'partner_document.reviewed'
      ORDER BY created_at DESC LIMIT 1`);

    expect((rows.rows[0]?.after as { status?: string }).status).toBe('approved');
  });
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('detectType', () => {
  it('identifies the three accepted formats by their leading bytes', () => {
    expect(detectType(Buffer.from('%PDF-1.4 rest', 'latin1'))).toBe('pdf');
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(
      detectType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('png');
  });

  it('rejects everything else', () => {
    expect(detectType(Buffer.from('PK\x03\x04 a zip', 'latin1'))).toBeNull();
    expect(detectType(Buffer.from('<html>', 'latin1'))).toBeNull();
    expect(detectType(Buffer.from('GIF89a', 'latin1'))).toBeNull();
    expect(detectType(Buffer.alloc(0))).toBeNull();
    expect(detectType(Buffer.from('%PDF', 'latin1'))).toBeNull();
  });

  /**
   * A PDF preceded by anything is not a PDF as far as this is concerned. Leading
   * junk is the classic way a polyglot slips past a "contains %PDF" check.
   */
  it('requires the signature at the very start', () => {
    expect(detectType(Buffer.from('   %PDF-1.4', 'latin1'))).toBeNull();
    expect(detectType(Buffer.from('<html>%PDF-1.4', 'latin1'))).toBeNull();
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary name', () => {
    expect(safeFileName('commercial-register.pdf')).toBe('commercial-register.pdf');
  });

  it('neutralises path separators', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('a\\b.pdf')).toBe('a_b.pdf');
  });

  /** CR/LF in a filename would inject a header line into Content-Disposition. */
  it('strips control characters', () => {
    expect(safeFileName('id\r\nX-Injected: yes.pdf')).toBe('idX-Injected: yes.pdf');
    expect(safeFileName('id .pdf')).toBe('id.pdf');
  });

  it('falls back rather than returning an empty name', () => {
    expect(safeFileName('   ')).toBe('document');
    expect(safeFileName(' ')).toBe('document');
  });

  it('caps the length', () => {
    expect(safeFileName('x'.repeat(500))).toHaveLength(120);
  });
});

/** A partner row with the minimum a document needs to hang off. */
async function createPartner(db: Database): Promise<string> {
  const id = randomUUID();
  const userId = randomUUID();
  const email = `doc-test-${id.slice(0, 8)}@safra.test`;

  await db.execute(sql`
    INSERT INTO users (id, email, role) VALUES (${userId}::uuid, ${email}, 'partner')`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name,
                          city_id, address, phone, email)
    SELECT ${id}::uuid, ${userId}::uuid, pt.id, 'Doc Test LLC', 'Doc Test', c.id,
           'Addr', '+963900000020', ${email}
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus' LIMIT 1`);

  return id;
}
