/**
 * SRS §4 / §4.1 — Role-Based Access Control.
 *
 * Permissions are `resource.action` strings. Roles are composed from them here, in
 * ONE place, so "what can a support agent do?" is answerable by reading a list
 * rather than grepping for `if (role === ...)` across the codebase.
 *
 * The spec's negative requirements are what this file exists to enforce:
 *   §4  support agents "do not edit prices or financial settings"
 *   §4  finance officers "do not see unnecessary conversation details"
 *   §4.1 "staff see only the data their role requires"
 *   §4.1 "no user can permanently delete data"  → there is no `.delete` permission
 *   §4.1 "sensitive payment data is never shown to any partner"
 *
 * Absence is the security control. A permission that does not appear in a role's
 * list cannot be granted by mistake, because there is nothing to grant.
 */

export const PERMISSIONS = {
  // ── Bookings ──────────────────────────────────────────────────────────────
  BOOKING_READ_OWN: 'booking.read_own',
  BOOKING_READ_ALL: 'booking.read_all',
  BOOKING_CREATE: 'booking.create',
  /** Changing a booking state is restricted — SRS §9.4 "specific permissions only". */
  BOOKING_UPDATE_STATUS: 'booking.update_status',
  BOOKING_CANCEL: 'booking.cancel',
  BOOKING_ADD_INTERNAL_NOTE: 'booking.add_internal_note',
  /** Partner-side accept/reject within the 2-hour SLA (§8.3). */
  BOOKING_RESPOND_AS_PARTNER: 'booking.respond_as_partner',
  BOOKING_CHECK_IN: 'booking.check_in',

  // ── Money ─────────────────────────────────────────────────────────────────
  PAYMENT_READ: 'payment.read',
  REFUND_READ: 'refund.read',
  REFUND_CREATE: 'refund.create',
  LEDGER_READ: 'ledger.read',
  PAYOUT_READ: 'payout.read',
  PAYOUT_EXECUTE: 'payout.execute',
  /** Reading a partner's bank details — finance only. */
  PAYOUT_ACCOUNT_READ: 'payout_account.read',
  WALLET_READ: 'wallet.read',
  /** Manually crediting a wallet moves real money; audited without exception. */
  WALLET_ADJUST: 'wallet.adjust',
  GIFT_CARD_READ: 'gift_card.read',
  /** §11.2: gift cards may only be created or edited with specific admin rights. */
  GIFT_CARD_MANAGE: 'gift_card.manage',
  COUPON_READ: 'coupon.read',
  COUPON_MANAGE: 'coupon.manage',

  // ── Partners & inventory ──────────────────────────────────────────────────
  PARTNER_READ: 'partner.read',
  PARTNER_APPROVE: 'partner.approve',
  PARTNER_SUSPEND: 'partner.suspend',
  PARTNER_DOCUMENT_REVIEW: 'partner.document_review',
  PROPERTY_READ: 'property.read',
  PROPERTY_MANAGE_OWN: 'property.manage_own',
  PROPERTY_APPROVE: 'property.approve',
  /** Editing nightly prices. Explicitly denied to support agents (§4). */
  PRICE_UPDATE: 'price.update',
  CALENDAR_MANAGE_OWN: 'calendar.manage_own',
  VIOLATION_READ: 'violation.read',
  VIOLATION_MANAGE: 'violation.manage',
  /** Waiving a fine has a financial effect, so it is separated from managing one. */
  VIOLATION_WAIVE: 'violation.waive',

  // ── Customers & support ───────────────────────────────────────────────────
  CUSTOMER_READ: 'customer.read',
  MESSAGE_READ: 'message.read',
  MESSAGE_SEND: 'message.send',
  DISPUTE_READ: 'dispute.read',
  DISPUTE_MANAGE: 'dispute.manage',

  // ── Platform ──────────────────────────────────────────────────────────────
  /** §3 P-005: commissions, SLA windows and fines are configuration, not code. */
  SETTINGS_READ: 'settings.read',
  SETTINGS_UPDATE: 'settings.update',
  GEO_MANAGE: 'geo.manage',
  FX_RATE_MANAGE: 'fx_rate.manage',
  AD_READ: 'ad.read',
  AD_MANAGE: 'ad.manage',
  REPORT_READ: 'report.read',
  AUDIT_LOG_READ: 'audit_log.read',
  /** §16 EC-009: halt bookings or waive fines during force majeure. */
  EMERGENCY_MODE_ACTIVATE: 'emergency_mode.activate',
  STAFF_MANAGE: 'staff.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

/** A registered or guest customer, acting only on their own records. */
const CUSTOMER: Permission[] = [
  P.BOOKING_READ_OWN,
  P.BOOKING_CREATE,
  P.WALLET_READ,
  P.GIFT_CARD_READ,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
  P.DISPUTE_READ,
];

/**
 * SRS §8.3. A partner manages their own inventory and answers booking requests.
 * Notably absent: PAYMENT_READ. §7.2 forbids showing a partner any customer
 * payment data, so the permission simply does not exist for this role.
 */
const PARTNER: Permission[] = [
  P.BOOKING_READ_OWN,
  P.BOOKING_RESPOND_AS_PARTNER,
  P.BOOKING_CHECK_IN,
  P.PROPERTY_MANAGE_OWN,
  P.CALENDAR_MANAGE_OWN,
  P.PRICE_UPDATE,
  P.VIOLATION_READ,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
];

/**
 * SRS §4: "sees bookings, messages and disputes, communicates with customer and
 * partner, and does NOT edit prices or financial settings."
 *
 * Hence no PRICE_UPDATE, no SETTINGS_UPDATE, no REFUND_CREATE, no WALLET_ADJUST.
 * A support agent who needs a refund escalates to finance — that separation is the
 * point.
 */
const SUPPORT_AGENT: Permission[] = [
  P.BOOKING_READ_ALL,
  P.BOOKING_ADD_INTERNAL_NOTE,
  P.CUSTOMER_READ,
  P.PARTNER_READ,
  P.PROPERTY_READ,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
  P.DISPUTE_READ,
  P.DISPUTE_MANAGE,
  P.WALLET_READ,
  P.GIFT_CARD_READ,
];

/**
 * SRS §4: "sees payments, commissions, transfers, invoices and refunds, and does
 * not see unnecessary conversation details."
 *
 * Hence MESSAGE_READ is absent: finance can see the money on a booking without
 * reading the customer's private conversation.
 */
const FINANCE_OFFICER: Permission[] = [
  P.BOOKING_READ_ALL,
  P.PAYMENT_READ,
  P.REFUND_READ,
  P.REFUND_CREATE,
  P.LEDGER_READ,
  P.PAYOUT_READ,
  P.PAYOUT_EXECUTE,
  P.PAYOUT_ACCOUNT_READ,
  P.WALLET_READ,
  P.WALLET_ADJUST,
  P.GIFT_CARD_READ,
  P.GIFT_CARD_MANAGE,
  P.COUPON_READ,
  P.PARTNER_READ,
  P.VIOLATION_READ,
  P.REPORT_READ,
  P.AUDIT_LOG_READ,
];

/** SRS §4: approves partners and properties, handles violations and disputes. */
const OPERATIONS_MANAGER: Permission[] = [
  P.BOOKING_READ_ALL,
  P.BOOKING_UPDATE_STATUS,
  P.BOOKING_CANCEL,
  P.BOOKING_ADD_INTERNAL_NOTE,
  P.CUSTOMER_READ,
  P.PARTNER_READ,
  P.PARTNER_APPROVE,
  P.PARTNER_SUSPEND,
  P.PARTNER_DOCUMENT_REVIEW,
  P.PROPERTY_READ,
  P.PROPERTY_APPROVE,
  P.VIOLATION_READ,
  P.VIOLATION_MANAGE,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
  P.DISPUTE_READ,
  P.DISPUTE_MANAGE,
  P.COUPON_READ,
  P.COUPON_MANAGE,
  P.AD_READ,
  P.AD_MANAGE,
  P.REPORT_READ,
  P.SETTINGS_READ,
];

/** SRS §4: full permissions, system setup, and Emergency Mode. */
const SUPER_ADMIN: Permission[] = Object.values(P);

export const ROLE_PERMISSIONS = {
  customer: CUSTOMER,
  partner: PARTNER,
  support_agent: SUPPORT_AGENT,
  finance_officer: FINANCE_OFFICER,
  operations_manager: OPERATIONS_MANAGER,
  super_admin: SUPER_ADMIN,
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLE_PERMISSIONS;

export const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

/** Staff roles get 2FA enforced and are the only ones allowed into apps/admin. */
export const STAFF_ROLES: Role[] = [
  'support_agent',
  'finance_officer',
  'operations_manager',
  'super_admin',
];

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

/**
 * Grants a role can be given at RUNTIME, without a deploy.
 *
 * Deliberately a tiny, closed list rather than a general "edit any role" facility.
 * The value of `permissions.ts` is that "what can this role do?" is answered by
 * reading one file; a settings table that could grant anything to anyone would
 * destroy exactly that, and quietly.
 *
 * Everything here is therefore off by default, flippable only by `super_admin`
 * (SETTINGS_UPDATE belongs to no other role), and audited like any other setting.
 */
export const TOGGLEABLE_GRANTS = {
  /**
   * Lets finance officers see and set the FX rate their books are denominated in
   * (roadmap 150f). Off by default: rate changes move every SYP figure on the
   * platform, so widening who can make them is a decision, not a default.
   */
  'rbac.finance_can_manage_fx': {
    role: 'finance_officer',
    permission: PERMISSIONS.FX_RATE_MANAGE,
  },
} as const satisfies Record<string, { role: string; permission: Permission }>;

export type ToggleableGrantKey = keyof typeof TOGGLEABLE_GRANTS;

export const TOGGLEABLE_GRANT_KEYS = Object.keys(
  TOGGLEABLE_GRANTS,
) as ToggleableGrantKey[];

/**
 * Resolves a role plus any per-user overrides into a flat permission set.
 * Overrides only ADD; a role's absence of a permission can never be widened by
 * accident, and there is no mechanism to subtract, so a role's list is a floor.
 *
 * `enabledGrants` carries the runtime toggles above. They also only ADD, and only
 * the pairs declared in `TOGGLEABLE_GRANTS` — an unrecognised key grants nothing, so
 * a stale settings row cannot widen a role by accident.
 */
export function resolvePermissions(
  role: Role,
  overrides: string[] = [],
  enabledGrants: string[] = [],
): Permission[] {
  const granted = new Set<Permission>(ROLE_PERMISSIONS[role]);
  const valid = new Set<string>(Object.values(P));

  for (const override of overrides) {
    // Unknown strings are ignored rather than trusted: a stale or hand-edited
    // override must never become an implicit grant.
    if (valid.has(override)) {
      granted.add(override as Permission);
    }
  }

  for (const key of enabledGrants) {
    const grant = TOGGLEABLE_GRANTS[key as ToggleableGrantKey];

    if (grant && grant.role === role) {
      granted.add(grant.permission);
    }
  }

  return [...granted];
}
