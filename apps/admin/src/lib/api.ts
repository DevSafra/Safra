import 'server-only';

import { z } from 'zod';

import { getStaffSession } from './session-server';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

export type ApiResult<T> = T | 'unauthenticated' | 'failed';

/**
 * The staff API client.
 *
 * Nothing here is EVER cached. A cached verification queue is one reviewer's view
 * served to another, and a cached partner detail is a stale approval decision — both
 * worse than a slow page. `cache: 'no-store'` is not an option callers can change.
 */
export async function staffFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const session = await getStaffSession();
  if (!session) return 'unauthenticated';

  let response: Response;

  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  } catch {
    return 'failed';
  }

  /**
   * 403 is reported as `unauthenticated` alongside 401, deliberately.
   *
   * From a page's point of view they call for the same rendering — "you cannot see
   * this, sign in again" — and distinguishing them would tempt a screen into
   * explaining which permission is missing, which is a map of the authorization
   * model handed to whoever is looking.
   */
  if (response.status === 401 || response.status === 403) return 'unauthenticated';

  if (!response.ok) return 'failed';

  const parsed = schema.safeParse(await response.json().catch(() => null));

  return parsed.success ? parsed.data : 'failed';
}

// ─── §9.2 attention counters ──────────────────────────────────────────────────

/**
 * Snake_case, matching what the endpoint actually returns.
 *
 * Parsed rather than cast, which is why this was caught at all: the first version of
 * this schema guessed camelCase and the page rendered "could not load" instead of
 * silently showing zeros for every counter. A cast would have shown an empty
 * dashboard that looked like a quiet day.
 */
const attentionSchema = z.object({
  properties_pending_review: z.number(),
  partners_pending_verification: z.number(),
  partners_unscreened: z.number(),
  bookings_awaiting_confirmation: z.number(),
  bookings_sla_expiring_within_30m: z.number(),
});

export type Attention = z.infer<typeof attentionSchema>;

export async function getAttention() {
  return staffFetch('/admin/attention', attentionSchema);
}

// ─── Verification queues (§8.1, §9.2) ─────────────────────────────────────────

const pendingPartnerSchema = z.object({
  /**
   * No `id`. The queue deliberately does not return internal uuids — every admin
   * route keys on the §13.2 reference, which is also what staff quote to each other.
   */
  reference: z.string(),
  legalName: z.string(),
  email: z.string(),
  phone: z.string(),
  verification: z.string(),
  sanctionsScreenedAt: z.union([z.string(), z.date(), z.null()]).nullable(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
  documents: z.array(
    z.object({ kind: z.string(), status: z.string(), fileName: z.string() }),
  ),
  city: z.object({ slug: z.string(), nameAr: z.string() }),
});

export type PendingPartner = z.infer<typeof pendingPartnerSchema>;

export async function getPendingPartners() {
  return staffFetch('/admin/partners/pending', z.array(pendingPartnerSchema));
}

// ─── Partner detail (§8.1) ────────────────────────────────────────────────────

/** Postgres timestamps arrive as strings or Dates depending on the driver path. */
const timestamp = z
  .union([z.string(), z.date()])
  .nullable()
  .transform((v) => (v === null ? null : new Date(v).toISOString()));

const partnerDocumentSchema = z.object({
  id: z.string(),
  kind: z.string(),
  fileName: z.string(),
  status: z.string(),
  reviewNotes: z.string().nullable(),
  reviewedAt: timestamp,
  createdAt: timestamp,
});

export type PartnerDocument = z.infer<typeof partnerDocumentSchema>;

const partnerDetailSchema = z.object({
  reference: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  verification: z.string(),
  verifiedAt: timestamp,
  sanctionsScreenedAt: timestamp,
  /** Provider payload, shape varies by provider — rendered as-is for the record. */
  sanctionsScreeningResult: z.unknown().nullable(),
  suspendedAt: timestamp,
  suspendedReason: z.string().nullable(),
  createdAt: timestamp,
  city: z.object({
    slug: z.string(),
    nameAr: z.string(),
    nameEn: z.string().nullable(),
  }),
  partnerType: z.object({ code: z.string() }),
  documents: z.array(partnerDocumentSchema),
  properties: z.array(
    z.object({
      reference: z.string(),
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      status: z.string(),
    }),
  ),
});

export type PartnerDetail = z.infer<typeof partnerDetailSchema>;

export async function getPartner(reference: string) {
  return staffFetch(
    `/admin/partners/${encodeURIComponent(reference)}`,
    partnerDetailSchema,
  );
}

const pendingPropertySchema = z.object({
  reference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: z.string(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
});

export async function getPendingProperties() {
  return staffFetch('/admin/properties/pending', z.array(pendingPropertySchema));
}

// ─── Property detail (§8.1, P-002) ────────────────────────────────────────────

const propertyDetailSchema = z.object({
  reference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  address: z.string(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  status: z.string(),
  reviewNotes: z.string().nullable(),
  attributes: z.array(z.string()).nullable(),
  createdAt: timestamp,
  partner: z.object({
    reference: z.string(),
    displayName: z.string(),
    legalName: z.string(),
    verification: z.string(),
  }),
  city: z.object({ slug: z.string(), nameAr: z.string(), nameEn: z.string().nullable() }),
  propertyType: z.object({ code: z.string() }),
  images: z.array(
    z.object({
      fileKey: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      isCover: z.boolean(),
    }),
  ),
  units: z.array(
    z.object({
      nameEn: z.string(),
      maxGuests: z.number(),
      basePrice: z.string(),
      minNights: z.number(),
    }),
  ),
});

export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

export async function getProperty(reference: string) {
  return staffFetch(
    `/admin/properties/${encodeURIComponent(reference)}`,
    propertyDetailSchema,
  );
}

// ─── Sanctions list health (ADR 0002) ─────────────────────────────────────────

const sanctionsStatusSchema = z.object({
  imported: z.boolean(),
  stale: z.boolean(),
  entryCount: z.number(),
  fetchedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  ageDays: z.number().nullable(),
});

export type SanctionsStatus = z.infer<typeof sanctionsStatusSchema>;

export async function getSanctionsStatus() {
  return staffFetch('/admin/sanctions/status', sanctionsStatusSchema);
}
