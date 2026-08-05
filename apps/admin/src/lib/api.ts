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

/**
 * §9.2's listing queue.
 *
 * No `status`. The endpoint filters on `status = 'pending_review'` and does not select the
 * column, because every row in this queue is by definition pending — an earlier version of
 * this schema required it, so `safeParse` failed on every response and the queue rendered
 * "could not load this list" permanently. Nothing errored anywhere: the parse guard turned a
 * field that was never sent into a generic failure message.
 *
 * The lesson is the schema has to be written against a real response, not against the
 * columns one would expect. `pendingPropertyFixture` in the test beside this file is a
 * verbatim capture of one, so the next mismatch fails a test instead of a page.
 */
const pendingPropertySchema = z.object({
  reference: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  address: z.string(),
  reviewNotes: z.string().nullable(),
  createdAt: z.union([z.string(), z.date()]).transform((v) => new Date(v).toISOString()),
  partner: z.object({
    reference: z.string(),
    displayName: z.string(),
    verification: z.string(),
  }),
  city: z.object({ slug: z.string(), nameAr: z.string() }),
});

export type PendingProperty = z.infer<typeof pendingPropertySchema>;

/** Exported for the schema test, which asserts against a captured response. */
export const pendingPropertyContract = pendingPropertySchema;

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

/**
 * The §9.2 dashboard payload.
 *
 * `openDisputes` is nullable because disputes are not implemented — the API returns
 * `null` rather than `0` so the console can show a dash and say why, instead of a
 * confident zero for a feature that does not exist.
 */
const dashboardSchema = z.object({
  counters: z.object({
    bookings_today: z.number(),
    bookings_yesterday: z.number(),
    pending_confirmation: z.number(),
    sla_expiring_soon: z.number(),
    cancelled_today: z.number(),
    cancelled_today_with_fine: z.number(),
    partners_pending_verification: z.number(),
    properties_pending_review: z.number(),
    revenue_today_usd: z.string(),
    revenue_today_syp: z.string(),
  }),
  revenue: z.array(z.object({ day: z.string(), amount: z.string() })),
  recentBookings: z.array(
    z.object({
      reference: z.string(),
      property: z.string(),
      customer: z.string(),
      amount: z.string(),
      currency: z.string(),
      status: z.string(),
    }),
  ),
  recentAudit: z.array(
    z.object({
      action: z.string(),
      actor: z.string().nullable(),
      at: z.string(),
      subject_type: z.string(),
    }),
  ),
  openDisputes: z.number().nullable(),
});

export type DashboardOverview = z.infer<typeof dashboardSchema>;

export async function getDashboard() {
  return staffFetch('/admin/dashboard', dashboardSchema);
}

// ─── §8 registries, finance and operations ────────────────────────────────────

/**
 * A cursor page, as every registry endpoint returns it.
 *
 * `nextCursor` is opaque and is passed back verbatim; the console never builds one. Parsing it
 * as a plain string rather than validating its shape is deliberate — the encoding is the
 * server's business and a client that understood it would be a client that could forge it.
 */
function cursorPage<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

/** Query builder for the list endpoints. Omits empty values rather than sending blanks. */
function listQuery(params: {
  q?: string | undefined;
  cursor?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
}): string {
  const search = new URLSearchParams();

  if (params.q) search.set('q', params.q);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.status) search.set('status', params.status);
  search.set('limit', String(params.limit ?? 25));

  return `?${search.toString()}`;
}

export interface ListParams {
  readonly q?: string | undefined;
  readonly cursor?: string | undefined;
  /**
   * Page size, defaulting to 25.
   *
   * Only the CSV export passes it, and only to walk the cursor in larger strides. Screens leave it
   * alone: a page size chosen per screen is a page size that drifts, and the API caps it at 100
   * regardless.
   */
  readonly limit?: number | undefined;
}

// ── الحجوزات ─────────────────────────────────────────────────────────────────

const bookingListItemSchema = z.object({
  reference: z.string(),
  property: z.string(),
  customer: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
});

const bookingListSchema = cursorPage(bookingListItemSchema).extend({
  counts: z.record(z.string(), z.number()),
});

export type BookingListItem = z.infer<typeof bookingListItemSchema>;
export type BookingList = z.infer<typeof bookingListSchema>;

export async function getBookings(params: ListParams & { status?: string | undefined }) {
  return staffFetch(`/admin/bookings${listQuery(params)}`, bookingListSchema);
}

// ── الشركاء ──────────────────────────────────────────────────────────────────

const partnerListItemSchema = z.object({
  reference: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  partnerType: z.string(),
  city: z.string(),
  score: z.number(),
  tier: z.string(),
  verification: z.string(),
  suspended: z.boolean(),
  avgResponseMinutes: z.number().nullable(),
  cancellationCount: z.number(),
  complaintCount: z.number(),
});

export type PartnerListItem = z.infer<typeof partnerListItemSchema>;

export async function getPartnerRegistry(params: ListParams) {
  return staffFetch(
    `/admin/partners${listQuery(params)}`,
    cursorPage(partnerListItemSchema),
  );
}

// ── العقارات ─────────────────────────────────────────────────────────────────

const propertyListItemSchema = z.object({
  reference: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  propertyType: z.string(),
  city: z.string(),
  partner: z.string(),
  partnerReference: z.string().nullable(),
  status: z.string(),
});

export type PropertyListItem = z.infer<typeof propertyListItemSchema>;

export async function getPropertyRegistry(params: ListParams) {
  return staffFetch(
    `/admin/properties${listQuery(params)}`,
    cursorPage(propertyListItemSchema),
  );
}

// ── العملاء ──────────────────────────────────────────────────────────────────

const customerListItemSchema = z.object({
  reference: z.string(),
  fullName: z.string(),
  isGuest: z.boolean(),
  bookings: z.number(),
  walletBalance: z.string().nullable(),
  walletCurrency: z.string().nullable(),
  lastActivity: z.string(),
});

export type CustomerListItem = z.infer<typeof customerListItemSchema>;

export async function getCustomers(params: ListParams) {
  return staffFetch(
    `/admin/customers${listQuery(params)}`,
    cursorPage(customerListItemSchema),
  );
}

// ── الدفع والفواتير ──────────────────────────────────────────────────────────

const financeItemSchema = z.object({
  reference: z.string(),
  linkedTo: z.string().nullable(),
  method: z.string(),
  kind: z.enum(['payment', 'refund', 'fine']),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  at: z.string(),
});

const financeSchema = cursorPage(financeItemSchema).extend({
  counters: z.object({
    captured_today: z.string(),
    refunded_today: z.string(),
    fines_collected_month: z.string(),
    partner_payable_outstanding: z.string(),
    currency: z.string(),
  }),
});

export type FinanceItem = z.infer<typeof financeItemSchema>;
export type Finance = z.infer<typeof financeSchema>;

export async function getFinance(params: ListParams) {
  return staffFetch(`/admin/finance${listQuery(params)}`, financeSchema);
}

// ── المحفظة ──────────────────────────────────────────────────────────────────

const walletItemSchema = z.object({
  customer: z.string(),
  customerReference: z.string().nullable(),
  direction: z.string(),
  reason: z.string(),
  amount: z.string(),
  currency: z.string(),
  balanceAfter: z.string(),
  note: z.string().nullable(),
  bookingReference: z.string().nullable(),
  at: z.string(),
});

export type WalletItem = z.infer<typeof walletItemSchema>;

export async function getWalletTransactions(params: ListParams) {
  return staffFetch(
    `/admin/wallet-transactions${listQuery(params)}`,
    cursorPage(walletItemSchema),
  );
}

// ── بطاقات الهدايا ───────────────────────────────────────────────────────────

const giftCardItemSchema = z.object({
  reference: z.string(),
  codeLast4: z.string(),
  originalAmount: z.string(),
  remainingAmount: z.string(),
  currency: z.string(),
  status: z.string(),
  expiresAt: z.string().nullable(),
  buyer: z.string().nullable(),
});

export type GiftCardItem = z.infer<typeof giftCardItemSchema>;

export async function getGiftCards(params: ListParams) {
  return staffFetch(
    `/admin/gift-cards${listQuery(params)}`,
    cursorPage(giftCardItemSchema),
  );
}

// ── الكوبونات ────────────────────────────────────────────────────────────────

const couponItemSchema = z.object({
  code: z.string(),
  type: z.string(),
  valueKind: z.string(),
  value: z.string(),
  currency: z.string().nullable(),
  minBookingAmount: z.string().nullable(),
  redemptionsCount: z.number(),
  maxRedemptions: z.number().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  isActive: z.boolean(),
  expired: z.boolean(),
  scope: z.string().nullable(),
});

export type CouponItem = z.infer<typeof couponItemSchema>;

export async function getCoupons(params: ListParams) {
  return staffFetch(`/admin/coupons${listQuery(params)}`, cursorPage(couponItemSchema));
}

// ── المدن والدول والعملات ────────────────────────────────────────────────────

const geoSchema = z.object({
  countries: z.array(
    z.object({
      code: z.string(),
      nameAr: z.string(),
      currencyCode: z.string().nullable(),
      activeCities: z.number(),
      isActive: z.boolean(),
    }),
  ),
  currencies: z.array(
    z.object({
      code: z.string(),
      nameAr: z.string(),
      symbol: z.string(),
      isAccounting: z.boolean(),
      rateToSyp: z.string().nullable(),
      rateSetAt: z.string().nullable(),
    }),
  ),
  cities: z.array(
    z.object({
      slug: z.string(),
      nameAr: z.string(),
      country: z.string(),
      category: z.string(),
      properties: z.number(),
      isActive: z.boolean(),
    }),
  ),
});

export type Geography = z.infer<typeof geoSchema>;

export async function getGeography(q?: string) {
  const search = q ? `?q=${encodeURIComponent(q)}` : '';

  return staffFetch(`/admin/geo${search}`, geoSchema);
}

// ── التقارير ─────────────────────────────────────────────────────────────────

const reportsSchema = z.object({
  cards: z.array(
    z.object({
      key: z.enum([
        'commission_revenue',
        'occupancy',
        'cancellations',
        'partner_response',
      ]),
      value: z.string(),
      previous: z.string().nullable(),
      series: z.array(z.object({ bucket: z.string(), value: z.string() })),
    }),
  ),
});

export type Reports = z.infer<typeof reportsSchema>;
export type ReportCard = Reports['cards'][number];

export async function getReports() {
  return staffFetch('/admin/reports', reportsSchema);
}

// ── الموظفون (overview) ──────────────────────────────────────────────────────

const staffOverviewSchema = z.object({
  counters: z.object({
    total: z.number(),
    active: z.number(),
    suspended: z.number(),
    invited: z.number(),
    signedInToday: z.number(),
    rolesDefined: z.number(),
    twoFactorMissing: z.number(),
  }),
  matrix: z.object({
    roles: z.array(z.string()),
    rows: z.array(z.object({ permission: z.string(), granted: z.array(z.boolean()) })),
  }),
  activity: z.array(
    z.object({
      actor: z.string().nullable(),
      action: z.string(),
      subjectType: z.string(),
      at: z.string(),
    }),
  ),
});

export type StaffOverview = z.infer<typeof staffOverviewSchema>;

const staffScopeSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.string(),
  kind: z.string(),
  outside: z.string(),
  cities: z.array(z.object({ slug: z.string(), nameAr: z.string() })),
});

export type StaffScopeRow = z.infer<typeof staffScopeSchema>;

/**
 * Every staff member's geographic scope (§8.2 النطاق).
 *
 * A separate call from `getStaffOverview` because it needs `STAFF_MANAGE` and the overview already
 * has it — but the two are rendered by different components, and merging them would make the
 * permission boundary less obvious than it should be for a map of who can see what.
 */
export async function getStaffScopes() {
  return staffFetch(
    '/admin/staff/scopes',
    z.object({ scopes: z.array(staffScopeSchema) }),
  );
}

export async function getStaffOverview() {
  return staffFetch('/admin/staff/overview', staffOverviewSchema);
}

// ── Emergency Mode ───────────────────────────────────────────────────────────

const emergencyModeSchema = z.object({
  id: z.string(),
  scope: z.string(),
  scopeName: z.string(),
  flags: z.object({
    stopBookings: z.boolean(),
    waiveFines: z.boolean(),
    broadcast: z.boolean(),
    suspendSla: z.boolean(),
  }),
  reason: z.string().nullable(),
  activatedBy: z.string().nullable(),
  activatedAt: z.string(),
  deactivatedAt: z.string().nullable(),
  deactivatedBy: z.string().nullable(),
});

const emergencySchema = z.object({
  active: z.array(emergencyModeSchema),
  history: z.array(emergencyModeSchema),
  scopes: z.object({
    cities: z.array(z.object({ ref: z.string(), name: z.string() })),
    countries: z.array(z.object({ ref: z.string(), name: z.string() })),
  }),
});

export type EmergencyState = z.infer<typeof emergencySchema>;
export type EmergencyMode = z.infer<typeof emergencyModeSchema>;

export async function getEmergency() {
  return staffFetch('/admin/emergency', emergencySchema);
}

// ─── §8 disputes, conversations, comms and advertising ────────────────────────

const disputeItemSchema = z.object({
  reference: z.string(),
  kind: z.string(),
  status: z.string(),
  title: z.string(),
  bookingReference: z.string().nullable(),
  partner: z.string().nullable(),
  customer: z.string().nullable(),
  evidenceCount: z.number(),
  compensationAmount: z.string().nullable(),
  compensationCurrency: z.string().nullable(),
  resolution: z.string().nullable(),
  ageHours: z.number(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  freezesPayout: z.boolean(),
});

const disputesSchema = cursorPage(disputeItemSchema).extend({
  counters: z.object({
    open: z.number(),
    investigating: z.number(),
    resolvedThisMonth: z.number(),
    oldestOpenHours: z.number().nullable(),
    frozenPayouts: z.number(),
  }),
});

export type DisputeItem = z.infer<typeof disputeItemSchema>;
export type Disputes = z.infer<typeof disputesSchema>;

export async function getDisputes(params: ListParams & { status?: string | undefined }) {
  return staffFetch(`/admin/disputes${listQuery(params)}`, disputesSchema);
}

const conversationItemSchema = z.object({
  reference: z.string(),
  subjectKind: z.string(),
  subjectReference: z.string().nullable(),
  customer: z.string().nullable(),
  partner: z.string().nullable(),
  lastMessage: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  unreadForStaff: z.number(),
  messageCount: z.number(),
  closed: z.boolean(),
});

export type ConversationItem = z.infer<typeof conversationItemSchema>;

export async function getConversations(params: ListParams) {
  return staffFetch(
    `/admin/conversations${listQuery(params)}`,
    cursorPage(conversationItemSchema),
  );
}

const messageSchema = z.object({
  senderKind: z.string(),
  senderEmail: z.string().nullable(),
  body: z.string(),
  redactedCount: z.number(),
  internal: z.boolean(),
  at: z.string(),
});

export type ThreadMessage = z.infer<typeof messageSchema>;

export async function getThread(reference: string) {
  return staffFetch(
    `/admin/conversations/${encodeURIComponent(reference)}`,
    z.object({ messages: z.array(messageSchema) }),
  );
}

const notificationItemSchema = z.object({
  channel: z.string(),
  templateKey: z.string(),
  locale: z.string(),
  status: z.string(),
  attempts: z.number(),
  failureReason: z.string().nullable(),
  subjectReference: z.string().nullable(),
  at: z.string(),
});

const notificationsSchema = cursorPage(notificationItemSchema).extend({
  counters: z.object({
    windowDays: z.number(),
    byChannel: z.record(z.string(), z.record(z.string(), z.number())),
  }),
  templates: z.array(
    z.object({
      key: z.string(),
      channels: z.array(z.string()),
      locales: z.array(z.string()),
      implemented: z.boolean(),
    }),
  ),
});

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;

export async function getNotifications(
  params: ListParams & { status?: string | undefined },
) {
  return staffFetch(`/admin/notifications${listQuery(params)}`, notificationsSchema);
}

const campaignItemSchema = z.object({
  reference: z.string(),
  advertiser: z.string(),
  advertiserKind: z.string(),
  city: z.string(),
  status: z.string(),
  billingPeriod: z.string(),
  priceAmount: z.string().nullable(),
  priceCurrency: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  daysRemaining: z.number(),
});

const campaignsSchema = cursorPage(campaignItemSchema).extend({
  counters: z.object({
    active: z.number(),
    paused: z.number(),
    endingWithinWeek: z.number(),
    impressions30d: z.number(),
    clicks30d: z.number(),
  }),
});

export type CampaignItem = z.infer<typeof campaignItemSchema>;
export type Campaigns = z.infer<typeof campaignsSchema>;

export async function getCampaigns(params: ListParams) {
  return staffFetch(`/admin/ad-campaigns${listQuery(params)}`, campaignsSchema);
}

const contractSchema = z.object({
  id: z.string(),
  partnerReference: z.string(),
  partnerName: z.string(),
  kind: z.string(),
  status: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  uploadedBy: z.string().nullable(),
  uploadedAt: z.string(),
  signedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  daysToExpiry: z.number().nullable(),
});

export type ContractItem = z.infer<typeof contractSchema>;

export async function getContracts(partner?: string) {
  const search = partner ? `?partner=${encodeURIComponent(partner)}` : '';

  return staffFetch(
    `/admin/partner-contracts${search}`,
    z.object({ contracts: z.array(contractSchema) }),
  );
}
