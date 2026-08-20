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
  /**
   * A partner reading their OWN payouts (design handoff §7.1).
   *
   * Separate from `PAYOUT_READ`, which is the finance view across every partner. Sharing one
   * permission would mean granting a partner the staff-wide read, and the difference between
   * "my transfers" and "everybody's transfers" is exactly the kind of thing a permission name
   * should make impossible to confuse.
   */
  PAYOUT_READ_OWN: 'payout.read_own',
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

  /** Reading the «طلبات الشراكة» queue — who has asked to join. */
  PARTNER_APPLICATION_READ: 'partner_application.read',
  /**
   * Acting on a request: recording the call, accepting it, rejecting it.
   *
   * Separate from reading, and granted to the super admin alone, because ACCEPTING creates an
   * account and invites somebody into the platform (Bashar, 2026-08-19). Operations can see the
   * queue — they inherit the partner the moment it exists — but who joins is one person's call.
   */
  PARTNER_APPLICATION_MANAGE: 'partner_application.manage',
  /**
   * The COMMERCIAL contract between SAFRA and a partner — distinct from the documents the
   * partner submits for verification.
   *
   * Split read from manage because the commission a contract sets is finance's business to see
   * and operations' business to negotiate, and uploading one changes what SAFRA is owed.
   */
  PARTNER_CONTRACT_READ: 'partner_contract.read',
  PARTNER_CONTRACT_MANAGE: 'partner_contract.manage',
  /**
   * Clearing a partner's second factor so they can enrol again — the lost-phone path.
   *
   * Its own permission rather than folded into `PARTNER_SUSPEND`, because it is the one partner
   * action that REMOVES an authentication factor. Anyone holding it can turn a 2FA-protected
   * account back into a password-only one for the length of a sign-in, so who holds it is a
   * decision worth making explicitly rather than inheriting from "can manage partners".
   *
   * The endpoint additionally refuses any target that is not a partner, so this can never be
   * turned on a staff or super-admin account. See `PartnerTwoFactorService`.
   */
  PARTNER_TWO_FACTOR_RESET: 'partner.two_factor_reset',
  /**
   * Guest reviews (§7.3, P-006).
   *
   * Four permissions rather than one, because they are four different powers with four different
   * blast radii. Notably there is no `review.delete` and there never will be: P-006 forbids it,
   * and the database refuses it, so a permission naming it would be a promise the system cannot
   * keep. `review.moderate` is what staff hold instead — it HIDES, with an actor and a reason.
   */
  REVIEW_CREATE: 'review.create',
  REVIEW_READ_OWN: 'review.read_own',
  REVIEW_RESPOND_OWN: 'review.respond_own',
  REVIEW_MODERATE: 'review.moderate',
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
  /**
   * Reading the WhatsApp/email delivery log.
   *
   * Separate from `MESSAGE_READ`: a delivery log says WHAT template went out and whether it
   * arrived, while a conversation is the customer's own words. Finance legitimately needs to
   * confirm an invoice email was delivered without being able to read the thread.
   */
  NOTIFICATION_READ: 'notification.read',

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
  P.REVIEW_CREATE,
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
  P.PAYOUT_READ_OWN,
  P.REVIEW_READ_OWN,
  /* الرد and إبلاغ — the two remedies P-006 allows. Hiding is not among them. */
  P.REVIEW_RESPOND_OWN,
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
  /*
    A reported review is a support ticket in everything but name — a partner saying "this is
    unfair" about something a guest wrote. It lands with the people who already answer for the
    relationship between the two.
  */
  P.REVIEW_MODERATE,
  P.NOTIFICATION_READ,
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
  /* The commission terms are in the contract; reading them is finance's job. */
  P.PARTNER_CONTRACT_READ,
  P.VIOLATION_READ,
  /* Confirming an invoice email was delivered — without reading the conversation. */
  P.NOTIFICATION_READ,
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
  /* The queue is visible to the team that inherits the partner; accepting is not theirs. */
  P.PARTNER_APPLICATION_READ,
  /*
    Operations, not support. A partner who has lost their authenticator phones the people who
    already verify partner identity for a living; routing every lost phone through a super admin
    would make the queue depend on one person, which is the same reasoning as the contract
    permission below.
  */
  P.PARTNER_TWO_FACTOR_RESET,
  P.PROPERTY_READ,
  P.PROPERTY_APPROVE,
  P.VIOLATION_READ,
  P.VIOLATION_MANAGE,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
  P.DISPUTE_READ,
  P.DISPUTE_MANAGE,
  /* Reports from partners land in the same queue operations already works. */
  P.REVIEW_MODERATE,
  P.NOTIFICATION_READ,
  P.PARTNER_CONTRACT_READ,
  /**
   * The design marks "رفع وتعديل عقود الشراكة" as ○ for operations — allowed WITH manager
   * approval. There is no approval tier in the model, so this is a binary decision, and it is
   * granted: an operations manager who has verified a partner is the person who then files the
   * signed contract, and routing that through a super admin would make the queue depend on one
   * person. Every upload is audit-logged with who did it, which is the accountability the ○ was
   * reaching for. Recorded in docs/design-gap-report.md §6.
   */
  P.PARTNER_CONTRACT_MANAGE,
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

/** The only roles allowed into `apps/admin`. Admission to the console, nothing else. */
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
 * Roles that must hold a second factor — staff AND partners (Bashar, 2026-08-07: mandatory,
 * not optional).
 *
 * Separate from `STAFF_ROLES` on purpose, and the separation is the point. The two lists answered
 * the same question until partner 2FA existed, and collapsing them would have meant one of two
 * wrong outcomes: either partners become staff for admission purposes and can open the console, or
 * 2FA stays keyed to console admission and partners never get it. They are different questions —
 * "may this person see the staff tooling" and "must this person prove a second factor" — so they
 * are different lists.
 *
 * Customers are deliberately absent. §4 specifies guest checkout, and a second factor on a
 * customer account would contradict it.
 */
export const TWO_FACTOR_ROLES: Role[] = [...STAFF_ROLES, 'partner'];

export function requiresTwoFactor(role: Role): boolean {
  return TWO_FACTOR_ROLES.includes(role);
}

/**
 * Roles that must ENROL AN AUTHENTICATOR — staff only since 2026-08-20 (Bashar).
 *
 * A third list, and the third question. The two above ask "may this person open the staff tooling"
 * and "must this person prove a second factor"; this one asks "must that factor be a TOTP app".
 *
 * They separated when partners stopped being made to enrol one. A partner still proves a second
 * factor at every sign-in — `requiresTwoFactor` is unchanged and still includes them — but the
 * factor is a code emailed to them, so there is nothing to enrol and nothing to set up before they
 * can work. Partners MAY still enrol an authenticator, and one who does is asked for that instead;
 * it is an upgrade they choose, not a gate they pass.
 *
 * Staff are not offered the choice. The console holds every registry, the ledger, payouts and
 * emergency mode, it is used by a handful of people who can be asked to install an app, and a
 * mailbox is a weaker thing to stand between an attacker and all of that.
 */
export const AUTHENTICATOR_ROLES: Role[] = [...STAFF_ROLES];

export function requiresAuthenticator(role: Role): boolean {
  return AUTHENTICATOR_ROLES.includes(role);
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
