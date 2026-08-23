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
   * Onboarding a partner IN PERSON — creating the record and the account outright, with no
   * request behind it (Bashar, 2026-08-23).
   *
   * Its own permission, and the super admin's alone, because it is the only action in the platform
   * that NAMES an email address and attaches a partner record to whatever account holds it.
   * `PARTNER_APPLICATION_MANAGE` cannot stand in for it: accepting a request acts on an account
   * that proved it holds the mailbox by signing in and applying, and this one acts on an address
   * somebody typed. Same outcome, an entirely different thing being trusted.
   *
   * What it is NOT is a way in. The account it touches gets no password and no session, and its
   * role stays `customer` until the invitation is redeemed from the mailbox itself — so holding
   * this grants the power to create a partner, never the power to become one.
   */
  PARTNER_ONBOARD: 'partner.onboard',
  /**
   * Defining and naming the roles SAFRA gives its OWN employees (Bashar, 2026-08-23).
   *
   * ## It does not touch partners, and that correction is the point
   *
   * This permission was invented for a model where the super admin defined the roles a PARTNER's
   * employees could hold. Bashar corrected it: *"The super admin has nothing to do with the
   * partner role definitions / employees. The partner should be able to invite his own employees
   * and also define their roles himself."* So partner employee roles are the partner's, governed
   * by `PARTNER_EMPLOYEE_MANAGE` and held by the partner — and this permission now governs SAFRA's
   * own staff roles, which is the only population a super admin administers.
   *
   * Its own permission rather than folded into `STAFF_MANAGE`, because they are different powers:
   * one adds a person to a role, the other decides what any role can do. A staff role that could
   * be granted this could grant itself everything, which is why it is excluded from what any
   * custom role may carry.
   */
  STAFF_ROLE_MANAGE: 'staff_role.manage',
  /**
   * A partner managing its OWN staff: inviting them, changing their role, suspending them.
   *
   * Held by the partner account, not by SAFRA staff. A hotel decides who its receptionists are;
   * the platform decides only what a receptionist is allowed to be.
   */
  PARTNER_EMPLOYEE_MANAGE: 'partner_employee.manage',
  /**
   * A partner signing and reading THEIR OWN partnership agreement (2026-08-23).
   *
   * ## Why this had to be invented rather than reused
   *
   * The partner-side contract routes were guarded by `PROPERTY_MANAGE_OWN`, which is "may edit my
   * listings" — and which employees hold, because managing listings is the job. So a receptionist
   * could upload a counter-signed copy of their employer's agreement with SAFRA, setting it
   * `active` with a `signed_at`. A member of staff at a hotel could bind the hotel.
   *
   * `PARTNER_CONTRACT_READ` could not be used instead: it is a STAFF permission held by
   * `operations_manager` and `support_agent`, and NOT by `partner`. Guarding a partner-side route
   * with it would lock the owner out of their own contract. That is also why withholding it from
   * employees withheld nothing — the exclusion read as a control and never was one.
   */
  PARTNER_CONTRACT_SIGN_OWN: 'partner_contract.sign_own',
  /**
   * A partner filing and reading THEIR OWN verification documents.
   *
   * Same failure, worse data. `PROPERTY_MANAGE_OWN` guarded these too, so an employee could file
   * documents in the owner's name — the papers SAFRA approves the business on — and download the
   * owner's IDENTITY documents, which is §14 personal data and about the most sensitive thing this
   * platform stores.
   *
   * There was no partner-side document permission at all, which is how `PROPERTY_MANAGE_OWN`
   * quietly became "is a partner": one permission doing duty as both "may edit listings" and "may
   * handle the owner's private papers". Harmless while those were the same person; not harmless
   * from the moment employees existed.
   */
  PARTNER_DOCUMENT_MANAGE_OWN: 'partner_document.manage_own',
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
  /*
    The owner's own papers: the partnership agreement, and the documents SAFRA verifies the
    business on. Held by the partner, absent from `PARTNER_EMPLOYEE_PERMISSIONS` — a receptionist
    does not sign the hotel's contract or handle the owner's identity documents.
  */
  P.PARTNER_CONTRACT_SIGN_OWN,
  P.PARTNER_DOCUMENT_MANAGE_OWN,
  /*
    Managing its own employees — and deliberately NOT in `PARTNER_EMPLOYEE_PERMISSIONS`.

    A receptionist must not be able to hire, promote or suspend another receptionist: that is the
    owner's authority, and an employee who can grant roles can grant themselves one. The two lists
    diverging here is the point, not an oversight.
  */
  P.PARTNER_EMPLOYEE_MANAGE,
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

/**
 * A partner's employee gets NOTHING from this map (Bashar, 2026-08-23).
 *
 * Every other role's authority is static and lives here. An employee's comes from the role a super
 * admin named for them — a database row — intersected with `PARTNER_EMPLOYEE_PERMISSIONS`.
 *
 * The entry is empty rather than absent, and empty rather than a sensible default, for one reason:
 * if the per-request lookup is ever skipped, forgotten, or fails, the employee ends up with no
 * authority at all instead of a partner's. A default of "what a receptionist usually needs" would
 * make a missed lookup invisible — the screen would work, and the permission check would be
 * answering from the wrong source.
 */
const PARTNER_EMPLOYEE: Permission[] = [];

export const ROLE_PERMISSIONS = {
  customer: CUSTOMER,
  partner: PARTNER,
  partner_employee: PARTNER_EMPLOYEE,
  support_agent: SUPPORT_AGENT,
  finance_officer: FINANCE_OFFICER,
  operations_manager: OPERATIONS_MANAGER,
  super_admin: SUPER_ADMIN,
} as const satisfies Record<string, readonly Permission[]>;

export type Role = keyof typeof ROLE_PERMISSIONS;

export const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

/**
 * The only roles allowed into `apps/partner`. Admission to the portal, nothing else.
 *
 * ## Why this exists rather than three `=== 'partner'` checks
 *
 * It was three: the sign-in route, the middleware, and the server-side session reader. Employees
 * were added to the platform and every one of them still said `'partner'`, so an employee could be
 * invited, activated, told «تم تفعيل الحساب. سجّل الدخول للمتابعة» — and then refused at the door
 * with a 403. The whole feature was unreachable, and each layer was individually defensible.
 *
 * Three checks that must never disagree is how the fourth one gets forgotten. `STAFF_ROLES` exists
 * for exactly this question on the console side; this is its counterpart, and adding a role to the
 * portal is now one edit rather than a search.
 *
 * ## Admission is not authority
 *
 * Being on this list gets an account through the door and nothing more. What an employee may DO is
 * their assigned role's permission set, intersected with `PARTNER_EMPLOYEE_PERMISSIONS` — and an
 * employee with no live employment resolves to none of it, so admission without authority is a
 * portal that renders empty rather than a portal that leaks.
 */
export const PARTNER_APP_ROLES: Role[] = ['partner', 'partner_employee'];

/** True when a role may sign in to the partner portal at all. */
export function isPartnerAppRole(role: string): boolean {
  return (PARTNER_APP_ROLES as string[]).includes(role);
}

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
 *
 * ## Employees are included, and it is `PARTNER_APP_ROLES` rather than two literals (Bashar, 2026-08-23)
 *
 * Asked whether a partner's employee should need a second factor, Bashar said: "same as partner
 * login. Just send a code per email." So an employee proves a factor at every sign-in exactly as
 * their employer does — and because `AUTHENTICATOR_ROLES` stays staff-only, there is nothing to
 * enrol first. A receptionist can be invited and working the same day.
 *
 * The reasoning it answers: an employee reads the same guest list with names, writes to guests as
 * the business, and admits people to rooms. They are also the WEAKER accounts by construction —
 * more of them, higher turnover, invited by a partner rather than vetted by SAFRA. A password
 * alone on the account that holds the guest list, while the owner needs two, is the wrong way round.
 *
 * Spread from `PARTNER_APP_ROLES` rather than written as `'partner', 'partner_employee'` so that a
 * role admitted to the portal cannot be admitted WITHOUT a second factor. Two literal lists that
 * must agree is how the next portal role gets one and not the other — which is the mistake that
 * left employees unable to sign in at all a few hours ago.
 */
export const TWO_FACTOR_ROLES: Role[] = [...STAFF_ROLES, ...PARTNER_APP_ROLES];

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
