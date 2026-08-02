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

// ─── Audit log (§15, item 65) ─────────────────────────────────────────────────

const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  actorRole: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});

export async function getAuditLog(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  return staffFetch(`/admin/audit-log?${query.toString()}`, auditPageSchema);
}

export async function getAuditActions() {
  return staffFetch(
    '/admin/audit-log/actions',
    z.object({ actions: z.array(z.string()) }),
  );
}

// ─── Settings (§9.3, P-005) ───────────────────────────────────────────────────

const settingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  valueSchema: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  updatedAt: z.string().nullable(),
  updatedByEmail: z.string().nullable(),
});

export type EditableSetting = z.infer<typeof settingSchema>;

export async function getSettings() {
  return staffFetch('/admin/settings', z.object({ settings: z.array(settingSchema) }));
}

// ─── Booking detail (§9.4) ────────────────────────────────────────────────────

const bookingDetailSchema = z.object({
  reference: z.string(),
  status: z.string(),
  stay: z.object({
    checkIn: z.string(),
    checkOut: z.string(),
    nights: z.number(),
    adults: z.number(),
    children: z.number(),
    infants: z.number(),
  }),
  customer: z.object({
    reference: z.string(),
    name: z.string(),
    email: z.string(),
    phone: z.string(),
    isGuest: z.boolean(),
  }),
  partner: z.object({
    reference: z.string(),
    name: z.string(),
    phone: z.string(),
  }),
  property: z.object({
    reference: z.string(),
    name: z.string(),
    unit: z.string(),
    citySlug: z.string(),
  }),
  money: z.object({
    currencyCode: z.string(),
    baseAmount: z.string(),
    customerFeeAmount: z.string(),
    walletAmount: z.string(),
    totalAmount: z.string(),
    partnerCommissionAmount: z.string(),
    partnerPayableAmount: z.string(),
    totalSyp: z.string(),
    fxRateToSyp: z.string(),
  }),
  dates: z.object({
    createdAt: z.string(),
    paidAt: z.string().nullable(),
    confirmationDeadlineAt: z.string().nullable(),
    confirmedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
  }),
  cancellationReason: z.string().nullable(),
  timeline: z.array(
    z.object({
      eventType: z.string(),
      actorType: z.string(),
      actorEmail: z.string().nullable(),
      payload: z.unknown(),
      createdAt: z.string(),
    }),
  ),
  /** Present only for callers holding PAYMENT_READ — absent, not redacted (§4). */
  payments: z
    .object({
      attempts: z.array(
        z.object({
          reference: z.string(),
          method: z.string(),
          provider: z.string(),
          amount: z.string(),
          status: z.string(),
          capturedAt: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
      refunds: z.array(
        z.object({
          amount: z.string(),
          walletAmount: z.string(),
          status: z.string(),
          reason: z.string(),
          createdAt: z.string(),
        }),
      ),
    })
    .optional(),
});

export type BookingDetail = z.infer<typeof bookingDetailSchema>;

export async function getBooking(reference: string) {
  return staffFetch(
    `/admin/bookings/${encodeURIComponent(reference)}`,
    bookingDetailSchema,
  );
}

/**
 * A staff account as the console lists it (M-5).
 *
 * `invitationPending` is surfaced because an unopened invitation looks identical to
 * an active account in a plain list, and "why can't they log in" is the support
 * ticket that follows.
 */
const staffMemberSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  twoFactorEnabled: z.boolean(),
  invitationPending: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

export async function getStaff() {
  return staffFetch('/admin/staff', z.object({ staff: z.array(staffMemberSchema) }));
}
