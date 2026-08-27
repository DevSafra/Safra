import 'server-only';

import { z } from 'zod';

import {
  OUTSIDE_SCOPE_ACCESS,
  SANCTIONS_POLICIES,
  STAFF_SCOPE_KINDS,
} from '@safra/contracts';

import { DEFAULT_PAGE_SIZE } from './search-params';
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
  partner_applications_open: z.number(),
  partner_documents_pending_review: z.number(),
  disputes_open: z.number(),
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

/**
 * A page of the verification queue — what `getPendingPartners` answers since 2026-08-20.
 *
 * `offsetPage` is a hoisted function declaration further down this file, so calling it here is fine
 * and keeps the schema and its type in one place.
 */
const pendingPartnerPageSchema = offsetPage(pendingPartnerSchema);

export type PendingPartnerPage = z.infer<typeof pendingPartnerPageSchema>;

/**
 * The P-002 verification queue, PAGED since 2026-08-20.
 *
 * It returned a bare array and the API defaulted to fifty rows, so with 527 partners awaiting
 * verification the console could reach fifty of them and nothing on the screen said so.
 */
export async function getPendingPartners(params: ListParams) {
  return staffFetch(
    `/admin/partners/pending${listQuery(params)}`,
    pendingPartnerPageSchema,
  );
}

// ── الإيقاف والمخالفات ───────────────────────────────────────────────────────

/**
 * A partner's suspension, as the CONSOLE sees it.
 *
 * `notes` is staff-only and the partner's own payload omits it — not nulls it, omits it. It is the
 * one field in this record with two audiences, and a field with two audiences and one shape is
 * exactly what leaked a super admin's name through `actor_name` this morning. It is declared
 * optional here so that shape stays true: a console that received a payload without it renders the
 * rest rather than failing the parse.
 */
const suspensionSchema = z.object({
  /*
    Written FOR the partner — they can sign in and read it. Nullable because a suspension imposed
    before the column existed has none, not because the API allows one to be raised without a reason.
  */
  reason: z.string().nullable(),
  notes: z.string().nullable().optional(),
  since: z.string(),
  /*
    Already resolved to a NAME by the API, and already pseudonymised: a super admin reads «Admin»,
    through the same `actorName` helper as the audit columns. The console receives a string and
    prints it — no id, nothing to resolve, and no second place deciding who acts under a pseudonym.
  */
  by: z.string().nullable(),
});

export type PartnerSuspension = z.infer<typeof suspensionSchema>;

/**
 * One violation, at whatever stage it has reached.
 *
 * ## `waiver` is one object, present or absent
 *
 * Not four nullable columns. A screen cannot then render half of it — «أُلغيت» with no reason
 * beside it is worse for the partner than no mark at all, and the reason is the part they are owed.
 *
 * `waiver.amount` equals the fine by construction: the API takes the figure from the stored row
 * rather than from a caller, so the pair cannot drift and the display can state that they net to
 * zero without recomputing it.
 */
const violationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  stage: z.string(),
  /* How many times this partner has done this. The progression is per partner, not per booking. */
  occurrenceNumber: z.number(),
  bookingReference: z.string().nullable().optional(),
  warnedAt: z.string().nullable(),
  warningNote: z.string().nullable(),
  /**
   * What happened, and why the fine — the two sentences the forms on this screen ask for.
   *
   * Both were required, both labelled «الوصف (يقرأه الشريك)», and both were written to
   * `audit_log.reason` and nowhere else until 2026-08-24. So an operator reviewing a violation six
   * months later saw a kind and a figure, and had to open سجل التدقيق and match by partner and
   * timestamp to find out what it was about.
   *
   * Nullable rather than defaulted: 7,679 rows predate the columns and there is nothing truthful to
   * put in their place. See the note on `stage` in the portal's schema for why a default here would
   * be the worse choice.
   */
  description: z.string().nullable(),
  fineReason: z.string().nullable(),
  fineAmount: z.string().nullable(),
  fineCurrency: z.string().nullable(),
  customerCompensationAmount: z.string().nullable(),
  waiver: z
    .object({
      at: z.string(),
      reason: z.string(),
      by: z.string().nullable(),
      ledgerGroupId: z.string().nullable().optional(),
      amount: z.string(),
      currency: z.string(),
    })
    .nullable()
    .optional(),
  collectedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type Violation = z.infer<typeof violationSchema>;

/**
 * A page of one partner's violations.
 *
 * Its own screen rather than a panel on the record: a partner with forty violations after two
 * years is ordinary, and an unpaged list on a record is the failure «Tables and pagination» exists
 * to prevent. The record links here.
 */
export async function getPartnerViolations(
  reference: string,
  params: { page?: number | undefined; limit: number },
) {
  return staffFetch(
    `/admin/partners/${encodeURIComponent(reference)}/violations${listQuery(params)}`,
    offsetPage(violationSchema),
  );
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
  /*
    The suspension record, or null when the partner is trading normally.

    Optional as well as nullable, so the record renders against an API that has not been redeployed
    rather than failing the parse and blanking a screen an operator is using to decide whether to
    lift an enforcement action. `notes` inside it is staff-only — see `suspensionSchema`.
  */
  suspension: suspensionSchema.nullable().optional(),
  reference: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string(),
  /*
    §8.1's «الموقع على الخريطة». Nullable, not `.default()`: a partner whose coordinates were never
    captured is a real state a verifier must SEE, and a default would invent a plausible location.
  */
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  /* §8.1's «بيانات التحويل المالي», masked — never the full number. */
  payoutAccounts: z.array(
    z.object({
      method: z.string(),
      accountHolder: z.string(),
      last4: z.string(),
      bankName: z.string().nullable(),
    }),
  ),
  verification: z.string(),
  verifiedAt: timestamp,
  sanctionsScreenedAt: timestamp,
  /** Provider payload, shape varies by provider — rendered as-is for the record. */
  sanctionsScreeningResult: z.unknown().nullable(),
  /*
    No `suspendedAt` / `suspendedReason` here. They were flat columns until 2026-08-24 and the API
    now destructures them INTO `suspension` above, so a screen cannot render a reason without the
    date and the author beside it — «موقوف» with nothing a reader can act on was the failure that
    change prevents.

    Declaring them as well would not be harmless: a required key the API no longer sends fails the
    parse, `staffFetch` answers 'failed', and the record 404s. That is exactly what happened here
    for ten minutes, with the API returning 200 the whole time.
  */
  createdAt: timestamp,
  /*
    Whether the partner has enrolled a second factor — a boolean, deliberately. Mandatory for
    partners since 2026-08-07, so this is what tells a reviewer whether the reset control has
    anything to reset. Defaulted rather than required so a console built against an older API
    still renders the screen instead of failing the whole parse, which is the failure mode that
    kept the listing review queue permanently empty (see §8 of the gap report).
  */
  twoFactorEnabled: z.boolean().default(false),
  /*
    Whether the partner has redeemed their invitation and can therefore SIGN IN
    (Bashar, 2026-08-23).

    Derived from the account's ROLE, which only redemption sets — not from the presence of a
    password, because an onboarded partner may be an adopted customer account that already had
    one. That password signs them into the customer site, not the partner portal, and mistaking
    the two is the defect this field exists to make visible.

    Defaulted for the same reason `twoFactorEnabled` is, and defaulted to the state that asks a
    human to look: false reads as "cannot sign in", which is safe to show wrongly for a moment.
    Defaulting true would hide a locked-out partner behind a console that had not been redeployed.
  */
  accountActivated: z.boolean().default(false),
  /** Whether a live, unexpired invitation is still outstanding — decides which remedy to offer. */
  invitationPending: z.boolean().default(false),
  city: z.object({
    slug: z.string(),
    nameAr: z.string(),
    nameEn: z.string().nullable(),
  }),
  partnerType: z.object({
    code: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
  }),
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

/** The listing half of the same queue, paged for the same reason. */
export async function getPendingProperties(params: ListParams) {
  return staffFetch(
    `/admin/properties/pending${listQuery(params)}`,
    offsetPage(pendingPropertySchema),
  );
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
      /* Which variants were actually rendered — `mediaUrl` picks from these, never guesses. */
      variantWidths: z.array(z.number()),
      width: z.number().nullable(),
      height: z.number().nullable(),
      isCover: z.boolean(),
    }),
  ),
  units: z.array(
    z.object({
      nameAr: z.string(),
      nameEn: z.string(),
      maxGuests: z.number(),
      basePrice: z.string(),
      /*
        The currency the rate is IN. Not optional and not defaulted: a nightly rate with no
        currency is «95 / الليلة», which is four orders of magnitude of ambiguity on a platform
        that prices in five currencies and settles in SYP.
      */
      currency: z.object({ code: z.string() }),
      minNights: z.number(),
    }),
  ),
});

export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

/** §8.2's accommodation types, retired ones included — this is the management view. */
const propertyTypeSchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
  hasMultipleUnits: z.boolean(),
  isActive: z.boolean(),
  /* How many listings would be affected by retiring it — shown before anybody does. */
  inUse: z.number(),
});

export type PropertyType = z.infer<typeof propertyTypeSchema>;

/** A bounded section of a customer's record: the most recent rows, and the true total. */
const recent = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ total: z.number(), items: z.array(item) });

const customerDetailSchema = z.object({
  reference: z.string(),
  fullName: z.string(),
  /* Shown because §9.4's booking screen has always shown them — see the service's note. */
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isGuest: z.boolean(),
  createdAt: z.string(),
  accountStatus: z.string().nullable(),
  locale: z.string().nullable(),
  /* `null` when there is no wallet at all — a different fact from a zero balance. */
  wallet: z.object({ balance: z.string(), currency: z.string().nullable() }).nullable(),
  bookings: recent(
    z.object({
      reference: z.string(),
      status: z.string(),
      checkIn: z.string(),
      amount: z.string(),
      currency: z.string(),
      property: z.string().nullable(),
    }),
  ),
  wallets: recent(
    z.object({
      direction: z.string(),
      reason: z.string(),
      amount: z.string(),
      currency: z.string(),
      at: z.string(),
    }),
  ),
  reviews: recent(
    z.object({
      rating: z.number(),
      status: z.string(),
      property: z.string().nullable(),
      at: z.string(),
    }),
  ),
  disputes: recent(
    z.object({
      reference: z.string(),
      kind: z.string(),
      status: z.string(),
      bookingReference: z.string().nullable(),
      at: z.string(),
    }),
  ),
  notifications: recent(
    z.object({
      templateKey: z.string(),
      channel: z.string(),
      status: z.string(),
      at: z.string(),
    }),
  ),
});

export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export async function getCustomer(reference: string) {
  return staffFetch(
    `/admin/customers/${encodeURIComponent(reference)}`,
    customerDetailSchema,
  );
}

export async function getPropertyTypes() {
  return staffFetch('/admin/property-types', z.array(propertyTypeSchema));
}

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
  /** A development fixture is present. Never true in production — the API refuses the import. */
  fixtureLoaded: z.boolean(),
  /** How hard screening bites. Parsed, not defaulted: the panel renders three different screens. */
  policy: z.enum(SANCTIONS_POLICIES),
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
  /*
    The role's NAME as it was at the time of the action (Bashar, 2026-08-23).

    Written into `audit_log` when the row is created and never resolved through a catalogue,
    because staff roles are now rows a super admin can rename or retire — and a trail that a later
    edit can re-label is not a trail. `actorRole` stays for the four seeded roles and for every row
    written before this column existed.

    Optional so the console renders against an API that has not been redeployed, rather than
    failing the whole parse and blanking سجل التدقيق.
  */
  actorRoleName: z.string().nullable().optional(),
  /*
    The actor's NAME, where the account has one (2026-08-24).

    Optional and nullable both: 165 accounts predate `users.full_name`, and a console rendering
    against an API that has not been redeployed must fall back to the address rather than failing
    the parse and blanking سجل التدقيق.
  */
  actorName: z.string().nullable().optional(),
  /*
    WHAT the entry happened to, resolved server-side (Bashar, 2026-08-24: "write the partner name
    (details) so me as a super admin can really know everything in details. Set that as a rule for
    the future also").

    «الموافقة على الشريك» beside a uuid is not an answer to "what happened". The API resolves the
    subject once per batch — twenty-two subject types, six of which have a console screen to open —
    so the console does not fetch per row and does not become a second answer to what a record is
    called.

    NULL is a real value and must render honestly: a raw type and id, never a hidden row. A trail
    that quietly omits what it cannot explain is worse than one that admits it.
  */
  subject: z
    .object({
      type: z.string(),
      reference: z.string().nullable(),
      label: z.string().nullable(),
      href: z.string().nullable(),
    })
    .nullable()
    .optional(),
  before: z.unknown(),
  after: z.unknown(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
});

export type AuditEntry = z.infer<typeof auditEntrySchema>;

const auditPageSchema = offsetPage(auditEntrySchema);

/**
 * آخر نشاط الموظفين — the same rows as سجل التدقيق, narrowed to what STAFF did.
 *
 * Two screens, one list, one shape. The API builds both from a single `pageOf(conditions, query)`
 * so the projection, ordering and count cap are decided once; the console reuses `auditEntrySchema`
 * for the same reason, because two schemas over one payload drift into rendering the same event
 * differently on two screens.
 *
 * `q` matches a full name OR an email, as a substring. It is passed through untouched: this is a
 * search term, not an identifier, and the API resolves it against `users` before it ever reaches
 * the audit table.
 */
export async function getStaffActivity(params: {
  page?: number | undefined;
  limit: number;
  q?: string | undefined;
}) {
  const query = new URLSearchParams();

  if (params.page !== undefined) query.set('page', String(params.page));
  query.set('limit', String(params.limit));
  if (params.q) query.set('q', params.q);

  return staffFetch(`/admin/staff/activity?${query.toString()}`, auditPageSchema);
}

/**
 * One activity entry, for its own screen.
 *
 * Answers 404 for an id that names nothing AND for one that names a customer's or a partner's
 * action — this screen is reached with `staff.manage`, and reading the whole trail is
 * `audit_log.read`, a different capability. "Not yours" and "not there" answer the same way.
 */
export async function getStaffActivityEntry(id: string) {
  return staffFetch(`/admin/staff/activity/${encodeURIComponent(id)}`, auditEntrySchema);
}

export async function getAuditLog(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }

  return staffFetch(`/admin/audit-log?${query.toString()}`, auditPageSchema);
}

/**
 * One audit entry, for its own screen — `GET /admin/audit-log/:id`.
 *
 * Separate from `getStaffActivityEntry` because the CAPABILITY is different: this one is reached
 * with `audit_log.read`, which opens the whole trail, and that one with `staff.manage`, which opens
 * only what staff did. Same row, same rendering, two doors with two keys — collapsing them would
 * hand every staff manager the platform-wide trail.
 */
export async function getAuditEntry(id: string) {
  return staffFetch(`/admin/audit-log/${encodeURIComponent(id)}`, auditEntrySchema);
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
    city: z.string(),
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
  /*
    What a staff actor may do to this booking, decided by the API's own state machine.

    REQUIRED, not `.default({…})`. A default here would invent a plausible value for something the
    API never sent — every control would quietly disappear and the screen would look like a
    booking that simply has no actions available, which is indistinguishable from the truth. A
    missing field is a console built against an API that does not have this yet, and that should
    fail loudly rather than render a lie.
  */
  actions: z.object({
    cancel: z.boolean(),
    confirm: z.boolean(),
    checkIn: z.boolean(),
    undoCheckIn: z.boolean(),
    complete: z.boolean(),
    capturePayment: z.boolean(),
    openDispute: z.boolean(),
    refund: z.boolean(),
    compensate: z.boolean(),
  }),
  /** How much there is on each screen this booking links out to, so a link can say. */
  related: z.object({
    disputes: z.number(),
    conversations: z.number(),
    notifications: z.number(),
  }),
  timeline: z.array(
    z.object({
      eventType: z.string(),
      actorType: z.string(),
      actorEmail: z.string().nullable(),
      payload: z.unknown(),
      createdAt: z.string(),
    }),
  ),
  /**
   * Present only for callers holding BOOKING_ADD_INTERNAL_NOTE — absent, not redacted.
   *
   * `.optional()` and NOT `.nullable().default(…)`: absent and empty are different facts here.
   * Absent means this reader may not see notes; `[]` means there are none. The screen says
   * different things for each, so the schema has to keep them apart.
   */
  notes: z
    .array(
      z.object({
        note: z.string(),
        author: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .optional(),
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
  /*
    The person's name, and it is NULLABLE for a reason that will not go away quickly.

    Bashar asked for it (2026-08-23) after reading صفحة الموظف and finding a colleague identified as
    `staff12@safra.test`. `staffInviteSchema` requires it, so nothing created from here on is
    nameless — but 165 accounts already exist with nothing true to backfill them with, and inventing
    a name for a real person is worse than showing their address. Every surface falls back to the
    email; `PATCH /admin/staff/:userId` is how those accounts stop being nameless.
  */
  fullName: z.string().nullable().default(null),
  /*
    The ENUM value, kept even though the screen no longer prints it.

    It is what `isScopable` keys off and what decides console admission, so نطاق العمل needs it
    without a second lookup. What a reader SEES is `staffRoleName`.
  */
  role: z.string(),
  /*
    The named role, and its display name (Bashar, 2026-08-23).

    Both nullable and both defaulted: accounts seeded before named roles existed have no
    `staff_role_id`, and the join is LEFT so they still render. A console built against an API
    that predates the columns shows the enum label rather than blanking الموظفون.
  */
  staffRoleId: z.string().nullable().default(null),
  staffRoleName: z.string().nullable().default(null),
  status: z.string(),
  twoFactorEnabled: z.boolean(),
  invitationPending: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export type StaffMember = z.infer<typeof staffMemberSchema>;

/**
 * A page of staff accounts.
 *
 * `/admin/staff` returned every row until 2026-08-05. The response keeps `staff` as an alias for
 * `items` so both names work; this reads `items` because that is the numbered-page shape every other
 * registry uses, and one shape means `TablePagination` needs no special case.
 */
export async function getStaff(params: { page?: number | undefined; limit: number }) {
  return staffFetch(`/admin/staff${listQuery(params)}`, offsetPage(staffMemberSchema));
}

/**
 * One staff member's whole record, for صفحة الموظف.
 *
 * Extends the row rather than restating it, so a field added to the list cannot go missing here.
 *
 * ## `permissions` comes from the server, and that is the point
 *
 * The console could compute it — it already fetches the roles list, and each role carries its
 * capabilities — but then this screen would be a SECOND answer to "what can this role do", and the
 * first is `PermissionsGuard`. A second answer is one that can disagree, and the direction it fails
 * in is the dangerous one: a screen telling somebody a colleague cannot reach payouts while the
 * server lets them. It is resolved by the same path the guard uses.
 */
const staffMemberDetailSchema = staffMemberSchema.extend({
  permissions: z.array(z.string()).default([]),
  /*
    The cities this member may work in, by SLUG and name.

    The slug rather than an id because `setStaffScopeSchema.citySlugs` is what the write accepts — a
    read that hands back an identifier its own write refuses cannot be a round trip, and this screen
    has an editor on it.
  */
  scopeCities: z.array(z.object({ slug: z.string(), name: z.string() })).default([]),
  /*
    Carried, NOT derived from `scopeCities.length`, and the difference is not cosmetic.

    An empty list has two meanings: `all_cities` — no restriction — and `cities` with none chosen
    yet, which `setStaffScopeSchema` accepts deliberately because it is how somebody starts building
    a scope. Deriving the kind from the length collapses them, and the collapse is silent: the editor
    would open with «كل المدن» selected for an account restricted to nothing, and the next save would
    widen that person's access to the whole platform.

    `scopeKind`/`outsideScopeAccess` here, `kind`/`outside` on the write. Two names for one idea is
    what we spent today removing, so this one is deliberate: `kind` alone is ambiguous in a payload
    about a PERSON, while the write's whole object IS a scope.
  */
  scopeKind: z.enum(STAFF_SCOPE_KINDS).default('all_cities'),
  /*
    Read so the editor can send it back unchanged.

    The write is a whole-object `PUT`, so a form that did not know the current value would reset it
    to whatever it defaulted to — quietly granting or removing read access outside somebody's cities
    as a side effect of editing their city list.
  */
  outsideScopeAccess: z.enum(OUTSIDE_SCOPE_ACCESS).default('none'),
  invitationSentAt: z.string().nullable().default(null),
  invitationExpiresAt: z.string().nullable().default(null),
});

export type StaffMemberDetail = z.infer<typeof staffMemberDetailSchema>;

/**
 * `GET /admin/staff/:userId`.
 *
 * The id is a path segment, so it is encoded rather than interpolated raw — it arrives from a route
 * parameter, which is caller-controlled however ordinary it looks.
 */
export async function getStaffMember(userId: string) {
  return staffFetch(
    `/admin/staff/${encodeURIComponent(userId)}`,
    staffMemberDetailSchema,
  );
}

/**
 * The §9.2 dashboard payload.
 *
 * `openDisputes` counts the disputes still waiting on SAFRA — `open` and `investigating`, the
 * same predicate the queue and the sidebar badge use.
 *
 * The NULLABLE type is kept although the count has been real since the disputes table landed on
 * 2026-08-04: `null` means «cannot be determined», which is a different statement from zero and is
 * rendered differently. The note here used to say the feature did not exist, which stopped being
 * true and went on being read.
 */
const dashboardSchema = z.object({
  counters: z.object({
    bookings_today: z.number(),
    bookings_yesterday: z.number(),
    pending_confirmation: z.number(),
    sla_expiring_soon: z.number(),
    /** EC-011 — arrived by the calendar and nobody recorded it. */
    arrivals_not_checked_in: z.number(),
    /** EC-004 — answered by the partner and never moved. Should be zero; see the counter. */
    confirmed_not_recorded: z.number(),
    /* §6.4 — a paid booking SAFRA cancelled with no refund on its way. */
    refunds_owed: z.number(),
    cancelled_today: z.number(),
    cancelled_today_with_fine: z.number(),
    partners_pending_verification: z.number(),
    properties_pending_review: z.number(),
    partner_applications_open: z.number(),
    partner_documents_pending_review: z.number(),
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
  /* Disputes nobody has taken — the sidebar badge. See the dashboard service's note. */
  unacknowledgedDisputes: z.number(),
});

export type DashboardOverview = z.infer<typeof dashboardSchema>;

export async function getDashboard() {
  return staffFetch('/admin/dashboard', dashboardSchema);
}

// ─── §8 registries, finance and operations ────────────────────────────────────

/**
 * A numbered page, as every registry endpoint returns it.
 *
 * `total` and `pages` are what the bar under the table prints, and they come from the server for
 * the same reason the rows do: the console cannot count what it has not fetched, and a total
 * inferred from "the page was full" is a guess that reads as a fact.
 */
function offsetPage<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int(),
    /** True when the server stopped counting at its cap — printed as "more than". */
    capped: z.boolean(),
    page: z.number().int(),
    pages: z.number().int(),
  });
}

/** Query builder for the list endpoints. Omits empty values rather than sending blanks. */
function listQuery(params: {
  q?: string | undefined;
  page?: number | undefined;
  status?: string | undefined;
  limit?: number | undefined;
  expiring?: boolean | undefined;
  attention?: string | undefined;
}): string {
  const search = new URLSearchParams();

  if (params.q) search.set('q', params.q);
  if (params.status) search.set('status', params.status);
  /* Only sent when it is on: the API's schema coerces, and `expiring=false` would coerce to TRUE. */
  if (params.expiring) search.set('expiring', '1');
  /* EC-004 / EC-011. The API's enum refuses anything it does not know, so nothing is coerced. */
  if (params.attention) search.set('attention', params.attention);
  search.set('page', String(params.page ?? 1));
  search.set('limit', String(params.limit ?? DEFAULT_PAGE_SIZE));

  return `?${search.toString()}`;
}

export interface ListParams {
  readonly q?: string | undefined;
  /** 1-based, as the reader types it. */
  readonly page?: number | undefined;
  /** Page size, defaulting to 25. The API caps it at 100 regardless of what is asked for. */
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

const bookingListSchema = offsetPage(bookingListItemSchema).extend({
  /*
    `capped` travels with the numbers, not beside them.

    Each per-status figure stops at `COUNT_CAP`, so their sum is a floor rather than a total and must
    be rendered as «أكثر من…». A boolean in a sibling field would be one more thing to remember to
    read; inside the object the type makes it awkward to ignore.
  */
  counts: z.object({
    byStatus: z.record(z.string(), z.number()),
    capped: z.boolean(),
  }),
});

export type BookingListItem = z.infer<typeof bookingListItemSchema>;
export type BookingList = z.infer<typeof bookingListSchema>;

export async function getBookings(
  params: ListParams & {
    status?: string | undefined;
    expiring?: boolean | undefined;
    /** EC-004 / EC-011 — which dashboard alert this view answers. */
    attention?: string | undefined;
  },
) {
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
    offsetPage(partnerListItemSchema),
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
    offsetPage(propertyListItemSchema),
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
    offsetPage(customerListItemSchema),
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

const financeSchema = offsetPage(financeItemSchema).extend({
  counters: z.object({
    captured_today: z.string(),
    refunded_today: z.string(),
    fines_collected_month: z.string(),
    /* §9.3 — advertising settled this month, beside the booking commission. */
    ad_revenue_month: z.string(),
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
  /* Required, not `.default(true)`: a field the API stops sending must fail the parse loudly. */
  customerActive: z.boolean(),
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
    offsetPage(walletItemSchema),
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
  /* Required, never `.default(null)`: a field the API stops sending must fail the parse loudly. */
  buyerReference: z.string().nullable(),
  buyerActive: z.boolean(),
});

export type GiftCardItem = z.infer<typeof giftCardItemSchema>;

export async function getGiftCards(params: ListParams) {
  return staffFetch(
    `/admin/gift-cards${listQuery(params)}`,
    offsetPage(giftCardItemSchema),
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
  return staffFetch(`/admin/coupons${listQuery(params)}`, offsetPage(couponItemSchema));
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
        'ad_revenue',
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
  /*
    No `matrix`. مصفوفة الصلاحيات was removed from الموظفون on 2026-08-23 — Bashar asked for it by
    name, because أدوار الموظفين is where a role's capabilities are read now and a matrix beside it
    was a second rendering of one fact.

    Dropped from the SCHEMA first, deliberately, while the API still sends it: zod ignores an extra
    key, so this parses today and keeps parsing after the API stops sending it. The other order
    breaks the screen silently — a schema demanding a field the API no longer returns fails the
    parse, `staffFetch` answers 'failed', and الموظفون renders with its counters and its history
    gone and nothing anywhere saying why.
  */
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

// ─── §8.1 partnership requests — «طلبات الشراكة» ──────────────────────────────

/**
 * One row of the join queue.
 *
 * Every field the console shows, and none it does not. `submittedByUserId` is deliberately absent
 * from the API's own view too: whether the applicant happened to be signed in is an audit fact,
 * not something a reviewer decides on.
 */
const partnerApplicationSchema = z.object({
  reference: z.string(),
  status: z.string(),
  contactName: z.string(),
  email: z.string(),
  phone: z.string(),
  legalName: z.string(),
  displayName: z.string(),
  partnerType: z.string(),
  partnerTypeAr: z.string(),
  city: z.string(),
  cityAr: z.string(),
  address: z.string(),
  propertyCount: z.number().nullable(),
  website: z.string().nullable(),
  message: z.string().nullable(),
  preferredLocale: z.string(),
  /**
   * The MOST RECENT call, derived from the call log rather than stored.
   *
   * There is no `contactNotes` beside it any more: a request is telephoned as many times as it
   * takes, and one note field could only hold the last of them — which is what it did, silently,
   * until 2026-08-20. The notes live in `contacts` on the detail response.
   */
  contactedAt: z.string().nullable(),
  contactedByEmail: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByEmail: z.string().nullable(),
  decisionNotes: z.string().nullable(),
  /** Set once the request has been accepted — this is what it became. */
  partnerReference: z.string().nullable(),
  partnerVerification: z.string().nullable(),
  createdAt: z.string(),
});

const partnerApplicationsSchema = offsetPage(partnerApplicationSchema);

/**
 * One telephone call, and the detail response carries every one of them.
 *
 * Only the detail: a registry row shows a single «تم الاتصال» date, so fetching a history per row
 * would be work nobody reads. That is why this extends the shared schema rather than joining it.
 */
const applicationContactSchema = z.object({
  at: z.string(),
  byEmail: z.string().nullable(),
  notes: z.string(),
});

const partnerApplicationDetailSchema = partnerApplicationSchema.extend({
  contacts: z.array(applicationContactSchema),
});

export type PartnerApplicationRow = z.infer<typeof partnerApplicationSchema>;
export type PartnerApplicationDetail = z.infer<typeof partnerApplicationDetailSchema>;
export type PartnerApplicationContact = z.infer<typeof applicationContactSchema>;

export async function getPartnerApplications(
  params: ListParams & { status?: string | undefined },
) {
  return staffFetch(
    `/admin/partner-applications${listQuery(params)}`,
    partnerApplicationsSchema,
  );
}

export async function getPartnerApplication(reference: string) {
  return staffFetch(
    `/admin/partner-applications/${encodeURIComponent(reference)}`,
    partnerApplicationDetailSchema,
  );
}

// ─── أدوار الموظفين ───────────────────────────────────────────────────────────

const staffRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  /*
    `employeeCount`, matching the partner-side roles API exactly.

    It was `memberCount` here for an hour, on the reasoning that SAFRA's people are staff rather
    than employees. Bashar calls both populations employees — "his own employees", "the partner
    employees" — so one idea gets one word across both APIs. Two names for one field is how a
    third consumer picks the wrong one.
  */
  employeeCount: z.number(),
  /** A seeded role. Neither editable nor removable, but still assignable to a person. */
  isSystem: z.boolean(),
  createdAt: z.string(),
});

export type StaffRole = z.infer<typeof staffRoleSchema>;

export async function getStaffRoles() {
  return staffFetch('/admin/staff-roles', z.object({ roles: z.array(staffRoleSchema) }));
}

/**
 * What a staff role MAY carry, fetched rather than hard-coded.
 *
 * The endpoint serves the same constant the API validates against, and it REJECTS anything
 * outside it rather than filtering — so a hand-written list here would offer capabilities the
 * server refuses. Notably absent: `staff_role.manage` itself, so no role can grant itself the
 * power to rewrite roles.
 */
export async function getAssignableStaffPermissions() {
  return staffFetch(
    '/admin/staff-roles/assignable',
    z.object({ permissions: z.array(z.string()) }),
  );
}

// ─── تسجيل شريك جديد — the in-person onboarding form's choices ────────────────

/**
 * The business kinds the onboarding form offers.
 *
 * Read from the PUBLIC `/partner-types` route rather than a console-only one, deliberately: it is
 * the same list «انضم كشريك» offers, and a second endpoint would be a second answer to "which
 * kinds exist" that could disagree with the form the public fills in. `staffFetch` attaches a
 * token the route does not require, which costs nothing.
 *
 * The `id` is absent by design at the source — the form sends a CODE and the server resolves it.
 */
const partnerTypeSchema = z.object({
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  nameDe: z.string(),
});

export type PartnerType = z.infer<typeof partnerTypeSchema>;

export async function getPartnerTypes() {
  return staffFetch('/partner-types', z.array(partnerTypeSchema));
}

// ─── §8 disputes, conversations, comms and advertising ────────────────────────

const disputeItemSchema = z.object({
  reference: z.string(),
  kind: z.string(),
  status: z.string(),
  title: z.string(),
  description: z.string().nullable(),
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

const disputesSchema = offsetPage(disputeItemSchema).extend({
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
    offsetPage(conversationItemSchema),
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

const notificationsSchema = offsetPage(notificationItemSchema).extend({
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

/** One requested CSV, as `GET /admin/exports` returns it. */
const exportItemSchema = z.object({
  reference: z.string(),
  kind: z.string(),
  status: z.string(),
  rowCount: z.number().nullable(),
  filters: z.record(z.string(), z.string().nullable()),
  failureCode: z.string().nullable(),
  requestedByEmail: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});

const exportsSchema = offsetPage(exportItemSchema);

export type ExportItem = z.infer<typeof exportItemSchema>;

export async function getExports(params: ListParams) {
  return staffFetch(`/admin/exports${listQuery(params)}`, exportsSchema);
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
  /* The creative, so «تعديل الإعلان» shows what it is about to change. */
  headlineAr: z.string(),
  headlineEn: z.string(),
  headlineDe: z.string(),
  targetUrl: z.string(),
  /*
    The creative. `.nullable()`, never `.default(null)` — a `.default()` would invent «no image» for
    a field the API stopped sending, and a campaign whose picture silently vanished from the console
    is exactly the failure that shape produces.
  */
  imageUrl: z.string().nullable(),
  imageStatus: z.string().nullable(),
});

const campaignsSchema = offsetPage(campaignItemSchema).extend({
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

/**
 * What advertisers owe — one row per billing period of a campaign.
 *
 * `amount` and `currency` are BOTH required rather than nullable, because an invoice exists only
 * where a campaign named a price: «no amount without its currency» is enforced at the boundary
 * where a missing one would otherwise arrive as a bare figure on the screen.
 */
const adInvoiceItemSchema = z.object({
  reference: z.string(),
  campaign: z.string(),
  advertiser: z.string(),
  city: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  amount: z.string(),
  currency: z.string(),
  status: z.string(),
  paidAt: z.string().nullable(),
});

const adInvoicesSchema = offsetPage(adInvoiceItemSchema);

export type AdInvoiceItem = z.infer<typeof adInvoiceItemSchema>;

export async function getAdInvoices(params: ListParams) {
  return staffFetch(`/admin/ad-invoices${listQuery(params)}`, adInvoicesSchema);
}

/**
 * One copy either side sent, newest first — the same three fields the partner portal shows.
 *
 * Bashar asked for the same list on both screens (2026-08-23), so this deliberately does NOT carry
 * more than the partner's does. "Which staff member uploaded this" is a question سجل التدقيق
 * answers, with the actor, the time and the payload; duplicating a thinner version of it beside the
 * upload form would be a second source for the same fact.
 */
const contractHistorySchema = z.object({
  party: z.string(),
  at: z.string(),
  superseded: z.boolean(),
});

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
  /* Defaulted so an API that has not been redeployed renders a panel without a history rather
     than failing the whole partner screen. */
  history: z.array(contractHistorySchema).default([]),
});

export type ContractHistoryEntry = z.infer<typeof contractHistorySchema>;

export type ContractItem = z.infer<typeof contractSchema>;

export async function getContracts(partner?: string) {
  const search = partner ? `?partner=${encodeURIComponent(partner)}` : '';

  return staffFetch(
    `/admin/partner-contracts${search}`,
    z.object({ contracts: z.array(contractSchema) }),
  );
}

// ─── The signed-in staff member's own preferences ─────────────────────────────

const preferencesSchema = z.object({
  tablePageSizes: z.record(z.string(), z.number()),
});

/**
 * The caller's saved page sizes.
 *
 * Read on every registry render, BEFORE the list itself, because the size is an input to the list
 * query. That is a sequential round trip rather than a parallel one — a primary-key lookup on
 * `users` against a local API, which is the cheapest read in the codebase, and the alternative
 * (caching it in the session cookie) drifts the moment the same person changes it on a second
 * device.
 *
 * A failure is not an error here: a console that refused to render a table because it could not
 * read a display preference would be worse than one that shows ten rows. The caller falls back to
 * the default.
 */
export async function getPreferences() {
  return staffFetch('/admin/me/preferences', preferencesSchema);
}

/**
 * A payout row as the staff registry returns it (§9.3).
 *
 * Amounts are strings, as everywhere else in this client: they are `numeric` in PostgreSQL and
 * parsing them into a JS number here would round money for display purposes, which is the one
 * place rounding must not happen silently.
 */
const payoutSchema = z.object({
  reference: z.string(),
  partnerName: z.string().nullable(),
  currencyCode: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  grossAmount: z.string(),
  fineAmount: z.string(),
  netAmount: z.string(),
  status: z.string(),
  scheduledFor: z.string().nullable(),
  releasedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  paidReference: z.string().nullable(),
  holdReason: z.string().nullable(),
  bookingCount: z.number(),
});

export type PayoutItem = z.infer<typeof payoutSchema>;

export async function getPayoutRegistry(
  params: ListParams & { status?: string | undefined },
) {
  /* `listQuery` already carries `status` — it is one of the filters every registry shares. */
  return staffFetch(`/admin/payouts${listQuery(params)}`, offsetPage(payoutSchema));
}

/**
 * One payout with everything needed to answer for it.
 *
 * Four collections travel together because each is useless alone when somebody asks why a partner
 * was sent an amount: what it covers, who decided it, and the ledger movement it discharged.
 * `ledger` being empty on a paid payout is a reconciliation failure the screen must be able to
 * show — so it is parsed as a possibly-empty array rather than assumed present.
 */
const payoutDetailSchema = payoutSchema.extend({
  id: z.string(),
  entryGroupId: z.string().nullable(),
  bookings: z.array(
    z.object({
      bookingReference: z.string(),
      amount: z.string(),
      checkIn: z.string(),
      checkOut: z.string(),
      property: z.string().nullable(),
    }),
  ),
  trail: z.array(
    z.object({
      action: z.string(),
      actorEmail: z.string().nullable(),
      actorRole: z.string().nullable(),
      after: z.unknown(),
      createdAt: z.string(),
    }),
  ),
  ledger: z.array(
    z.object({
      account: z.string(),
      direction: z.string(),
      amount: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export type PayoutDetail = z.infer<typeof payoutDetailSchema>;

export async function getPayout(reference: string) {
  return staffFetch(
    `/admin/payouts/${encodeURIComponent(reference)}`,
    payoutDetailSchema,
  );
}

/**
 * A reported review awaiting a staff decision (§7.3, P-006).
 *
 * Carries the guest's name and the review body because a moderator has to read what was actually
 * written to decide — but nothing else about the guest, for the same reason the partner's own
 * screen shows nothing else.
 */
const reportedReviewSchema = z.object({
  reference: z.string(),
  guestName: z.string(),
  propertyName: z.string().nullable(),
  unitName: z.string().nullable(),
  rating: z.number(),
  body: z.string(),
  status: z.string(),
  partnerReply: z.string().nullable(),
  partnerRepliedAt: z.string().nullable(),
  reportStatus: z.string(),
  reportReason: z.string().nullable(),
  moderationNote: z.string().nullable(),
  createdAt: z.string(),
});

export type ReportedReview = z.infer<typeof reportedReviewSchema>;

export async function getReportedReviews(params: ListParams) {
  return staffFetch(
    `/admin/reviews/reported${listQuery(params)}`,
    offsetPage(reportedReviewSchema),
  );
}

/**
 * When each scheduled job last ran (§14's background work, until a queue lands).
 *
 * `detail` is `unknown` because each job reports its own counts; the payout screen reads
 * `attached` and anything else is somebody else's business. Parsed permissively for the same
 * reason — a new job reporting a new shape must not break a screen that only cares about one.
 */
const jobRunSchema = z.object({
  job: z.string(),
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.string().nullable(),
  detail: z.unknown(),
  error: z.string().nullable(),
});

export type JobRun = z.infer<typeof jobRunSchema>;

export async function getJobRuns() {
  return staffFetch('/admin/jobs', z.array(jobRunSchema));
}
