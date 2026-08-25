/**
 * The error codes the API returns — a machine contract, never text.
 *
 * ## Why a code and not a sentence
 *
 * The API used to answer with English prose: `'Invalid email or password.'`. Three
 * consequences, all of which were live:
 *
 * 1. An Arabic customer read English. `auth-form.tsx` mapped the API's `message` straight
 *    into the field error under the input, so the one screen where wording matters most was
 *    the one screen that ignored the locale.
 * 2. The staff console translated by REGEX-matching that prose (`/invalid email or
 *    password/i`). Rewording the API silently broke the Arabic, and nothing failed.
 * 3. The wording could not be improved without asking who was pattern-matching on it.
 *
 * A code fixes all three. It is stable, it is not a language, and it can be translated by
 * whoever is displaying it — which is the only place that knows what language the reader
 * speaks. The English text still travels alongside it for logs and for any client that has
 * not been taught the codes.
 *
 * ## These are a contract
 *
 * Renaming a code is a breaking change for every client. Add a new one and leave the old one
 * in place instead. The `errors-complete` test asserts every code here has a translation in
 * every locale, so adding one without translating it fails the build rather than reaching a
 * user as a raw `booking.not_found`.
 */
export const ERROR = {
  REQUEST_MALFORMED_BODY: 'request.malformed_body',
  REQUEST_VALIDATION_FAILED: 'request.validation_failed',
  REQUEST_BODY_TOO_LARGE: 'request.body_too_large',
  REQUEST_CURSOR_INVALID: 'request.cursor_invalid',
  REQUEST_NOT_FOUND: 'request.not_found',
  REQUEST_UPSTREAM_UNREACHABLE: 'request.upstream_unreachable',
  REQUEST_UNKNOWN: 'request.unknown',
  /**
   * The rate limiter's refusal.
   *
   * `@nestjs/throttler` answers a 429 with `{statusCode, message: 'ThrottlerException: Too
   * Many Requests'}` — no code, an English sentence, and the framework's class name in a
   * client-facing body. `CodedThrottlerGuard` replaces it with this. Namespaced `request.`
   * rather than `auth.` because the global throttler covers every route, not only sign-in.
   */
  REQUEST_TOO_MANY: 'request.too_many',
  /**
   * The platform is at capacity — not broken, and worth retrying.
   *
   * Answers a 503 with `Retry-After` where the request never reached the database because no
   * connection could be acquired within `connectionTimeoutMillis`. Measured on 2026-08-20: 1,680
   * of 12,231 requests under scenario 2's deliberate lock concentration answered a bare 500, which
   * is the wrong answer twice over — a client is told not to retry something that would have
   * worked a second later, and the 5xx alert in `docs/alerting.md` pages somebody for load.
   *
   * Distinct from `request.upstream_unreachable`, which is a THIRD party we could not reach, and
   * from every other 503 in this catalogue, which name a specific dependency that is down. This
   * one says the work never started, so retrying it is safe even for a write. See
   * `AppExceptionFilter` for the exact set of conditions that qualify.
   */
  REQUEST_CAPACITY: 'request.capacity',
  AUTH_REQUIRED: 'auth.required',
  AUTH_CREDENTIALS_INVALID: 'auth.credentials_invalid',
  AUTH_PASSWORD_INCORRECT: 'auth.password_incorrect',
  AUTH_LOCKED: 'auth.locked',
  AUTH_TOO_MANY_ATTEMPTS: 'auth.too_many_attempts',
  AUTH_CODE_REQUIRED: 'auth.code_required',
  AUTH_CODE_INVALID: 'auth.code_invalid',
  /**
   * The password was right and a code has been EMAILED — the partner's second factor since
   * 2026-08-20 (Bashar).
   *
   * Distinct from `auth.code_required`, which asks for an authenticator app, because the two send
   * the reader somewhere completely different: one to their phone, one to their inbox. A single
   * code would make the sign-in form guess, and it would guess wrong for whichever partner is not
   * the majority.
   */
  AUTH_EMAIL_CODE_SENT: 'auth.email_code_sent',
  /** Wrong, already used, or past its ten minutes — deliberately not distinguished to the caller. */
  AUTH_EMAIL_CODE_INVALID: 'auth.email_code_invalid',
  /** Too many codes asked for in too short a time. Separate so the form can say to wait. */
  AUTH_EMAIL_CODE_TOO_MANY: 'auth.email_code_too_many',
  AUTH_CODE_MALFORMED: 'auth.code_malformed',
  AUTH_RECOVERY_CODE_INVALID: 'auth.recovery_code_invalid',
  AUTH_NO_AUTHENTICATOR: 'auth.no_authenticator',
  AUTH_TWO_FACTOR_ALREADY_ENABLED: 'auth.two_factor_already_enabled',
  AUTH_TWO_FACTOR_NOT_ENABLED: 'auth.two_factor_not_enabled',
  AUTH_EMAIL_TAKEN: 'auth.email_taken',
  AUTH_CONFIRMATION_LINK_INVALID: 'auth.confirmation_link_invalid',
  AUTH_RESET_LINK_INVALID: 'auth.reset_link_invalid',
  AUTH_TOKEN_INVALID: 'auth.token_invalid',
  AUTH_SESSION_EXPIRED: 'auth.session_expired',
  AUTH_SESSION_MISSING: 'auth.session_missing',
  /**
   * The console: these credentials are good, but the account is not a STAFF account.
   *
   * Three sign-in routes rejected a wrong-audience login with this one code until 2026-08-23, and
   * the single message could only be right for one of them. The console and the partner portal
   * were both telling people «هذا حساب موظف، سجّل الدخول إلى مركز القيادة» — which was false about
   * their account AND pointed at the app they were already standing in. Each route's own comment
   * argues for being SPECIFIC here, because somebody who has just proved they hold the credentials
   * learns nothing from the answer; specific and wrong is the failure that argument invites.
   */
  AUTH_NOT_STAFF: 'auth.not_staff',
  /** The partner portal: good credentials, but the account is not a partner account (yet). */
  AUTH_NOT_PARTNER: 'auth.not_partner',
  /** The customer site: good credentials, but this IS a staff account — the console is elsewhere. */
  AUTH_STAFF_ACCOUNT: 'auth.staff_account',
  PERMISSION_DENIED: 'permission.denied',
  SCOPE_OUTSIDE: 'scope.outside',
  STAFF_NOT_FOUND: 'staff.not_found',
  /* ── Enforcement (Bashar, 2026-08-24) ── */
  /**
   * The refusal a SUSPENDED partner meets on a write, and it needs its own code.
   *
   * Distinct from `PARTNER_ALREADY_SUSPENDED`, which is a staff-side conflict — "you tried to
   * suspend an account that already is". This one is what the partner's own portal receives, and it
   * exists because a 403 that cannot be told from a 401 sends a suspended partner to sign in again
   * over a state that signing in cannot change. `partnerFetch` collapses both into
   * `'unauthenticated'`, so without a code to look for, the portal says «انتهت الجلسة» to somebody
   * whose session is perfectly good.
   */
  PARTNER_SUSPENDED: 'partner.suspended',
  /** Held, not cancelled — the money is owed and releases when the suspension is lifted. */
  PAYOUT_FROZEN_BY_SUSPENSION: 'payout.frozen_by_suspension',
  PARTNER_ALREADY_SUSPENDED: 'partner.already_suspended',
  PARTNER_NOT_SUSPENDED: 'partner.not_suspended',
  VIOLATION_NOT_FOUND: 'violation.not_found',
  /** The progression only moves forward: `recorded → warned → fined → suspension`. */
  VIOLATION_STAGE_INVALID: 'violation.stage_invalid',
  VIOLATION_NOT_FINED: 'violation.not_fined',
  VIOLATION_ALREADY_WAIVED: 'violation.already_waived',

  AUDIT_ENTRY_NOT_FOUND: 'audit_entry.not_found',
  STAFF_ROLE_INVALID: 'staff.role_invalid',
  STAFF_CANNOT_SUSPEND_SELF: 'staff.cannot_suspend_self',
  STAFF_CANNOT_CHANGE_OWN_SCOPE: 'staff.cannot_change_own_scope',
  STAFF_ROLE_NOT_SCOPABLE: 'staff.role_not_scopable',
  STAFF_CITIES_UNRECOGNISED: 'staff.cities_unrecognised',
  BOOKING_NOT_FOUND: 'booking.not_found',
  BOOKING_NOT_PAYABLE: 'booking.not_payable',
  BOOKING_STAY_TOO_LONG: 'booking.stay_too_long',
  BOOKING_NO_REFUNDABLE_AMOUNT: 'booking.no_refundable_amount',
  BOOKING_DRAFT_NOT_REFUNDABLE: 'booking.draft_not_refundable',
  /**
   * Lost the race for the last room (EC-005).
   *
   * Distinct from `unit.unavailable_on`, which is the calendar saying no BEFORE the attempt.
   * This is the exclusion constraint saying no during it: the dates were free when the
   * customer asked and somebody else committed first, so there is no single date to name.
   */
  BOOKING_DATES_JUST_TAKEN: 'booking.dates_just_taken',
  PAYMENT_UNAVAILABLE: 'payment.unavailable',
  PARTNER_NOT_FOUND: 'partner.not_found',

  // ── Partner payouts (design handoff §7.1) ──────────────────────────────────
  PAYOUT_NOT_FOUND: 'payout.not_found',
  PAYOUT_NOT_ACCRUING: 'payout.not_accruing',
  PAYOUT_NOT_RELEASABLE: 'payout.not_releasable',
  PAYOUT_NOT_SCHEDULED: 'payout.not_scheduled',
  PAYOUT_NOT_HELD: 'payout.not_held',
  PAYOUT_ALREADY_PAID: 'payout.already_paid',
  PAYOUT_ALREADY_FINAL: 'payout.already_final',
  PAYOUT_NOTHING_TO_PAY: 'payout.nothing_to_pay',
  /** A dispute that is open or investigating freezes the partner's entitlement. */
  PAYOUT_FROZEN_BY_DISPUTE: 'payout.frozen_by_dispute',
  PAYOUT_PARTNER_NOT_SCREENED: 'payout.partner_not_screened',
  PARTNER_ALREADY_VERIFIED: 'partner.already_verified',
  PARTNER_PROFILE_MISSING: 'partner.profile_missing',
  PARTNER_TYPE_UNKNOWN: 'partner.type_unknown',
  PROPERTY_NOT_FOUND: 'property.not_found',
  PROPERTY_TYPE_UNKNOWN: 'property.type_unknown',
  PROPERTY_AMENITIES_UNKNOWN: 'property.amenities_unknown',
  PROPERTY_SLUG_NOT_DERIVABLE: 'property.slug_not_derivable',
  UNIT_NOT_FOUND: 'unit.not_found',
  UNIT_NOT_FOUND_OR_RANGE_EMPTY: 'unit.not_found_or_range_empty',
  DOCUMENT_NOT_FOUND: 'document.not_found',
  DOCUMENT_REJECTION_REASON_REQUIRED: 'document.rejection_reason_required',
  UPLOAD_FILE_MISSING: 'upload.file_missing',
  UPLOAD_FILE_EMPTY: 'upload.file_empty',
  UPLOAD_FILE_TOO_LARGE: 'upload.file_too_large',
  UPLOAD_NOT_AN_IMAGE: 'upload.not_an_image',
  UPLOAD_IMAGE_UNREADABLE: 'upload.image_unreadable',
  UPLOAD_IMAGE_TOO_LARGE: 'upload.image_too_large',
  /**
   * The variants could not be produced, after the upload itself was accepted.
   *
   * Distinct from every code above it, which are all refusals the UPLOADER sees in the response.
   * This one is discovered later, by a worker, and is stored on the row so the partner can be told
   * in their own language why a photograph they successfully sent is not on their listing.
   */
  UPLOAD_IMAGE_PROCESSING_FAILED: 'upload.image_processing_failed',
  /**
   * The four states a requested export can be in that are not "here is your file".
   *
   * `EXPORT_NOT_FOUND` also covers somebody else's export, deliberately — the two must be
   * indistinguishable, or the endpoint becomes a way to discover which references exist.
   */
  EXPORT_NOT_FOUND: 'export.not_found',
  EXPORT_NOT_READY: 'export.not_ready',
  EXPORT_FAILED: 'export.failed',
  EXPORT_EXPIRED: 'export.expired',
  IMAGE_NOT_FOUND: 'image.not_found',
  /** A reorder that does not name exactly the property's live images. */
  IMAGE_ORDER_MISMATCH: 'image.order_mismatch',
  /** Archiving the only image would leave a listing with no cover at all. */
  IMAGE_LAST_ONE: 'image.last_one',
  CONTRACT_NOT_FOUND: 'contract.not_found',
  CONTRACT_PDF_REQUIRED: 'contract.pdf_required',
  CONTRACT_NOT_SIGNABLE: 'contract.not_signable',
  CONTRACT_NOT_REOPENABLE: 'contract.not_reopenable',
  /**
   * A joint upload was attempted for a partner who is no longer being ADDED.
   *
   * One scan carrying both signatures is the in-person onboarding path (Bashar, 2026-08-23). Once
   * a partner is approved — or rejected — their agreement changes hands the ordinary way, where
   * each signature is something the signer's own account did. `canFileJointContract` is the rule.
   */
  CONTRACT_JOINT_NOT_ALLOWED: 'contract.joint_not_allowed',

  /* ── Partner employees and their roles (Bashar, 2026-08-23) ── */
  /** Two live roles cannot share a name: the partner assigning them could not tell which is which. */
  EMPLOYEE_ROLE_NAME_TAKEN: 'employee_role.name_taken',
  EMPLOYEE_ROLE_NOT_FOUND: 'employee_role.not_found',
  /**
   * Refused rather than cascaded. An employee whose role vanished resolves to NO permissions — an
   * account that still signs in and can do nothing, for a reason no screen explains. Moving those
   * people is a decision, and it belongs to whoever is deleting the role.
   */
  EMPLOYEE_ROLE_IN_USE: 'employee_role.in_use',
  EMPLOYEE_NOT_FOUND: 'employee.not_found',
  /** The address already belongs to somebody who works for a partner — including this one. */
  EMPLOYEE_ALREADY_EMPLOYED: 'employee.already_employed',
  /** The address belongs to a STAFF account. A SAFRA employee is not a partner's employee. */
  EMPLOYEE_EMAIL_IS_STAFF: 'employee.email_is_staff',
  /** The address belongs to the partner's OWN account. An owner is not their own employee. */
  EMPLOYEE_EMAIL_IS_OWNER: 'employee.email_is_owner',
  /**
   * One code for every way an employee invitation can fail — expired, spent, never existed, or the
   * employment withdrawn since it was sent. Distinguishing them tells somebody probing links which
   * guesses were close.
   */
  EMPLOYEE_INVITATION_INVALID: 'employee.invitation_invalid',

  /* ── SAFRA's own staff roles (Bashar, 2026-08-23) ── */
  STAFF_ROLE_NAME_TAKEN: 'staff_role.name_taken',
  STAFF_ROLE_NOT_FOUND: 'staff_role.not_found',
  /**
   * `super_admin` cannot be edited, renamed, reduced or retired.
   *
   * Without it, a super admin edits their own role, drops `staff.manage`, and nobody is left who
   * can put it back — an irreversible lockout performed through a form that looks like an ordinary
   * save.
   */
  STAFF_ROLE_SYSTEM: 'staff_role.system',
  /** Refused rather than cascaded: a member whose role vanished can sign in and do nothing. */
  STAFF_ROLE_IN_USE: 'staff_role.in_use',
  /**
   * The last active super admin cannot be moved off that role.
   *
   * Distinct from `STAFF_ROLE_SYSTEM` on purpose: that one says a role cannot be EDITED, this one
   * says a PERSON cannot be moved, and the remedy differs — promote somebody else first. It also
   * replaces an English sentence thrown from `staff.service.ts`, which was a plain violation of the
   * rule that the API answers with codes.
   */
  STAFF_LAST_SUPER_ADMIN: 'staff.last_super_admin',
  CONTRACT_NOT_AWAITING_SIGNATURE: 'contract.not_awaiting_signature',
  DISPUTE_NOT_FOUND: 'dispute.not_found',
  DISPUTE_ALREADY_CLOSED: 'dispute.already_closed',
  /** A booking nobody has paid for has nothing at stake, so there is nothing to dispute. */
  DISPUTE_BOOKING_NOT_DISPUTABLE: 'dispute.booking_not_disputable',
  /** One open dispute per booking per reason. A second would freeze the payout twice over. */
  DISPUTE_ALREADY_OPEN: 'dispute.already_open',
  CONVERSATION_NOT_FOUND_OR_CLOSED: 'conversation.not_found_or_closed',
  CAMPAIGN_NOT_FOUND: 'campaign.not_found',
  WALLET_NOT_FOUND: 'wallet.not_found',
  WALLET_AMOUNT_NOT_POSITIVE: 'wallet.amount_not_positive',
  CUSTOMER_PROFILE_MISSING: 'customer.profile_missing',
  CUSTOMER_NOT_FOUND: 'customer.not_found',
  GEO_CITY_UNKNOWN: 'geo.city_unknown',
  GEO_CITY_NOT_FOUND: 'geo.city_not_found',
  GEO_CURRENCY_UNKNOWN: 'geo.currency_unknown',
  SETTING_VALUE_FLAT_OR_PERCENT: 'setting.value_flat_or_percent',
  SETTING_VALUE_SANCTIONS_POLICY: 'setting.value_sanctions_policy',
  SETTING_VALUE_PERCENT_RANGE: 'setting.value_percent_range',
  SETTING_VALUE_POSITIVE_INT: 'setting.value_positive_int',
  SETTING_VALUE_HOUR_OF_DAY: 'setting.value_hour_of_day',
  SETTING_VALUE_BOOLEAN: 'setting.value_boolean',
  SETTING_NO_UPDATABLE_FIELDS: 'setting.no_updatable_fields',
  EMERGENCY_ACTIVATION_FAILED: 'emergency.activation_failed',
  INTERNAL_ACTOR_REQUIRED: 'internal.actor_required',
  VALIDATION_EMAIL_INVALID: 'validation.email_invalid',
  VALIDATION_REQUIRED: 'validation.required',
  VALIDATION_PASSWORD_TOO_SHORT: 'validation.password_too_short',
  /**
   * The three ways a password long enough can still be weak (2026-08-14).
   *
   * Length was the only rule, so `aaaaaaaaaaaa` and `123456789012` were accepted on a platform
   * holding wallet balances. These are the blocklist half of NIST SP 800-63B, which the policy had
   * adopted only the first half of — and each is a distinct thing to tell somebody, because "pick a
   * different one" and "stop using your own email" are different instructions.
   */
  /** The visible checklist beside the field, as a refusal for anything not rendering it. */
  VALIDATION_PASSWORD_COMPOSITION: 'validation.password_composition',
  VALIDATION_PASSWORD_COMMON: 'validation.password_common',
  VALIDATION_PASSWORD_PREDICTABLE: 'validation.password_predictable',
  VALIDATION_PASSWORD_CONTAINS_IDENTITY: 'validation.password_contains_identity',
  VALIDATION_CODE_SIX_DIGITS: 'validation.code_six_digits',
  VALIDATION_DATE_FORMAT: 'validation.date_format',
  VALIDATION_DATE_UNREAL: 'validation.date_unreal',
  VALIDATION_DEPARTURE_AFTER_ARRIVAL: 'validation.departure_after_arrival',
  VALIDATION_END_BEFORE_START: 'validation.end_before_start',
  VALIDATION_RANGE_TOO_LONG: 'validation.range_too_long',
  VALIDATION_AMOUNT_POSITIVE: 'validation.amount_positive',
  VALIDATION_REASON_REQUIRED: 'validation.reason_required',
  VALIDATION_REJECTION_REASON_REQUIRED: 'validation.rejection_reason_required',
  VALIDATION_LATITUDE_RANGE: 'validation.latitude_range',
  VALIDATION_LATITUDE_FORMAT: 'validation.latitude_format',
  VALIDATION_LONGITUDE_RANGE: 'validation.longitude_range',
  VALIDATION_LONGITUDE_FORMAT: 'validation.longitude_format',
  VALIDATION_NIGHTS_MIN_MAX: 'validation.nights_min_max',
  VALIDATION_BOOKING_REFERENCE: 'validation.booking_reference',
  VALIDATION_URL_INVALID: 'validation.url_invalid',
  VALIDATION_TOKEN_MALFORMED: 'validation.token_malformed',
  VALIDATION_ACCESS_TOKEN_MALFORMED: 'validation.access_token_malformed',
  VALIDATION_SCOPE_ALL_CITIES_CONFLICT: 'validation.scope_all_cities_conflict',
  REQUEST_IN_PROGRESS: 'request.in_progress',
  REQUEST_STILL_PROCESSING: 'request.still_processing',
  AUTH_UNAVAILABLE: 'auth.unavailable',
  AUTH_CODE_INVALID_CHECK_APP: 'auth.code_invalid_check_app',
  AUTH_TWO_FACTOR_SETUP_REQUIRED: 'auth.two_factor_setup_required',
  AUTH_TWO_FACTOR_ALREADY_ENABLED_REENROL: 'auth.two_factor_already_enabled_reenrol',
  AUTH_TWO_FACTOR_ROLE_INELIGIBLE: 'auth.two_factor_role_ineligible',
  /**
   * The reset endpoint was pointed at an account that is not a partner.
   *
   * This is the escalation guard, so it has its own code rather than a generic 404: a staff
   * member who can reset a partner's second factor must never be able to reset a colleague's or a
   * super admin's, and the refusal should be legible in the logs when someone tries.
   */
  PARTNER_TWO_FACTOR_TARGET_NOT_PARTNER: 'partner.two_factor_target_not_partner',
  /** The partner record exists but has no user account behind it, so there is nothing to reset. */
  PARTNER_TWO_FACTOR_NO_ACCOUNT: 'partner.two_factor_no_account',
  REVIEW_NOT_FOUND: 'review.not_found',
  /** A review may only be written about a stay that actually finished. */
  REVIEW_STAY_NOT_COMPLETED: 'review.stay_not_completed',
  /** One review per booking — the rule that makes a rating mean anything. */
  REVIEW_ALREADY_WRITTEN: 'review.already_written',
  /** The booking belongs to somebody else. */
  REVIEW_NOT_YOUR_BOOKING: 'review.not_your_booking',
  /** A partner may reply once; changing a published answer is a different feature. */
  REVIEW_ALREADY_REPLIED: 'review.already_replied',
  /** Reporting a review that is already reported, or already decided. */
  REVIEW_ALREADY_REPORTED: 'review.already_reported',
  /** Moderating a review nobody reported. */
  REVIEW_NOT_REPORTED: 'review.not_reported',
  STAFF_ROLE_INVALID_CONSOLE: 'staff.role_invalid_console',
  STAFF_EMAIL_TAKEN: 'staff.email_taken',
  STAFF_ALREADY_ACTIVATED: 'staff.already_activated',
  STAFF_INVITATION_INVALID: 'staff.invitation_invalid',
  STAFF_CANNOT_CHANGE_OWN_ROLE: 'staff.cannot_change_own_role',
  BOOKING_DEPARTURE_AFTER_ARRIVAL: 'booking.departure_after_arrival',
  BOOKING_ARRIVAL_MINIMUM_NIGHTS: 'booking.arrival_minimum_nights',
  /**
   * The same-day cutoff has passed for this city (§5.3), and the arrival date is behind us.
   *
   * Both carry `{date}` — the first date that CAN be booked — because a refusal that does not
   * say what would work leaves the customer guessing. They were two English sentences chosen by
   * a ternary until 2026-08-20.
   */
  BOOKING_SAME_DAY_CLOSED: 'booking.same_day_closed',
  BOOKING_ARRIVAL_IN_PAST: 'booking.arrival_in_past',
  BOOKING_NO_CAPTURED_PAYMENT: 'booking.no_captured_payment',
  BOOKING_NOT_PAYABLE_IN_STATUS: 'booking.not_payable_in_status',
  PAYMENT_REFUND_UNAVAILABLE: 'payment.refund_unavailable',
  PRICING_UNAVAILABLE: 'pricing.unavailable',
  WALLET_WRONG_ACCOUNT: 'wallet.wrong_account',
  WALLET_BALANCE_CHANGED: 'wallet.balance_changed',
  PARTNER_NOT_VERIFIED: 'partner.not_verified',

  /* ── Applying to become a partner (§8.1, Bashar 2026-08-19) ── */
  PARTNER_APPLICATION_NOT_FOUND: 'partner_application.not_found',
  /** One open request per address. A rejected applicant may apply again. */
  PARTNER_APPLICATION_ALREADY_OPEN: 'partner_application.already_open',
  /** Accepting or rejecting something already accepted or rejected. */
  PARTNER_APPLICATION_ALREADY_DECIDED: 'partner_application.already_decided',
  /**
   * The address belongs to a STAFF account.
   *
   * Refused rather than converted: accepting an application would otherwise demote an
   * operations manager to a partner, through a screen whose audit entry reads «قُبل الطلب».
   */
  /**
   * The request has no account behind it.
   *
   * Unreachable for anything filed since applying required a session (2026-08-19), and kept
   * because rows written before that exist and must fail loudly rather than pick an account.
   */
  PARTNER_APPLICATION_NO_ACCOUNT: 'partner_application.no_account',
  PARTNER_APPLICATION_EMAIL_IS_STAFF: 'partner_application.email_is_staff',
  /** The address is already a partner. Nothing to accept; find them in الشركاء. */
  PARTNER_APPLICATION_EMAIL_IS_PARTNER: 'partner_application.email_is_partner',
  /* ── Onboarding a partner in person (Bashar, 2026-08-23) ── */
  /**
   * The address belongs to a STAFF account.
   *
   * The same refusal «انضم كشريك» makes, for the same reason, and it matters more here: there the
   * account was proven by a session, and here it is an address the operator typed. Onboarding must
   * not be a way to demote an operations manager by mistyping a colleague's address.
   */
  PARTNER_ONBOARDING_EMAIL_IS_STAFF: 'partner_onboarding.email_is_staff',
  /** The address is already a partner. Nothing to create; find them in الشركاء. */
  PARTNER_ONBOARDING_EMAIL_IS_PARTNER: 'partner_onboarding.email_is_partner',
  /**
   * There is an open «انضم كشريك» request from this address.
   *
   * Refused rather than merged. Onboarding around it would leave a request nobody ever answers
   * sitting in the queue against a partner who already exists, and the reviewer working that queue
   * would telephone somebody who has been onboarded for a week.
   */
  PARTNER_ONBOARDING_APPLICATION_OPEN: 'partner_onboarding.application_open',
  /**
   * The partner has already redeemed their invitation, so there is nothing to re-send.
   *
   * A conflict rather than a silent success: issuing a second link would mail a live credential
   * for an account whose owner has already chosen a password. Somebody who has LOST that password
   * wants a reset, which is a different door.
   */
  PARTNER_ONBOARDING_ALREADY_ACTIVATED: 'partner_onboarding.already_activated',
  /** The invitation link is expired, spent, or was never issued. Deliberately one code. */
  PARTNER_INVITATION_INVALID: 'partner.invitation_invalid',
  PARTNER_SANCTIONS_SCREENING_REQUIRED: 'partner.sanctions_screening_required',
  PROPERTY_UNIT_REQUIRED: 'property.unit_required',
  PROPERTY_NOT_STRUCTURALLY_EDITABLE: 'property.not_structurally_editable',
  PROPERTY_NOT_SUBMITTABLE: 'property.not_submittable',
  PROPERTY_NOT_REVIEWABLE: 'property.not_reviewable',
  PROPERTY_IMAGE_LIMIT: 'property.image_limit',
  PROPERTY_CANCELLATION_POLICY_UNKNOWN: 'property.cancellation_policy_unknown',
  GEO_CITY_IMAGE_LIMIT: 'geo.city_image_limit',
  UNIT_UNAVAILABLE_ON: 'unit.unavailable_on',
  UNIT_GUEST_LIMIT: 'unit.guest_limit',
  UNIT_MAX_NIGHTS: 'unit.max_nights',
  UNIT_MIN_NIGHTS: 'unit.min_nights',
  DOCUMENT_LIMIT_REACHED: 'document.limit_reached',
  DOCUMENT_TYPE_UNSUPPORTED: 'document.type_unsupported',
  UPLOAD_IMAGE_TYPE_UNSUPPORTED: 'upload.image_type_unsupported',
  UPLOAD_IMAGE_TOO_SMALL: 'upload.image_too_small',
  SETTING_UNKNOWN: 'setting.unknown',
  SETTING_VALUE_RATE: 'setting.value_rate',
  CAMPAIGN_EXPIRED: 'campaign.expired',
  VALIDATION_PASSWORD_TOO_LONG: 'validation.password_too_long',
  VALIDATION_PHONE_FORMAT: 'validation.phone_format',
  /** Right SHAPE, not a real number — an unallocated range, or the wrong length for its country. */
  VALIDATION_PHONE_INVALID: 'validation.phone_invalid',
  VALIDATION_RECOVERY_CODE_FORMAT: 'validation.recovery_code_format',
  VALIDATION_REVIEW_RATING_RANGE: 'validation.review_rating_range',
  VALIDATION_DECIMAL_STRING: 'validation.decimal_string',
  VALIDATION_CURRENCY_CODE: 'validation.currency_code',
  VALIDATION_RATE_POSITIVE: 'validation.rate_positive',
  VALIDATION_RATE_SYP_FIXED: 'validation.rate_syp_fixed',
  VALIDATION_PRICE_RANGE: 'validation.price_range',
  VALIDATION_ONE_FIELD_REQUIRED: 'validation.one_field_required',
  VALIDATION_PASSWORD_UNCHANGED: 'validation.password_unchanged',
  VALIDATION_REJECTION_NOTES_REQUIRED: 'validation.rejection_notes_required',
  VALIDATION_SANCTIONS_BODY_TOO_SMALL: 'validation.sanctions_body_too_small',
  VALIDATION_SANCTIONS_SOURCE: 'validation.sanctions_source',
  VALIDATION_DOCUMENT_REJECTION_NOTES_REQUIRED:
    'validation.document_rejection_notes_required',
  BOOKING_TRANSITION_INVALID: 'booking.transition_invalid',
  REQUEST_IDEMPOTENCY_KEY_REUSED: 'request.idempotency_key_reused',
  /*
    بطاقات الهدايا. `GIFT_CARD_CODE_INVALID` deliberately covers both "no such code" and "malformed":
    a code is a bearer instrument, so the answer to a guess must not confirm that a string is a real
    code somebody else holds. `ALREADY_USED` and `EXPIRED` are distinct on purpose — the person asking
    is holding a card they own, and "invalid" would send them to support over a card that simply ran
    out.
  */
  GIFT_CARD_CODE_INVALID: 'gift_card.code_invalid',
  GIFT_CARD_ALREADY_USED: 'gift_card.already_used',
  GIFT_CARD_EXPIRED: 'gift_card.expired',
  GIFT_CARD_CANCELLED: 'gift_card.cancelled',
  GIFT_CARD_AMOUNT_INVALID: 'gift_card.amount_invalid',
  GIFT_CARD_CASH_ONLY: 'gift_card.cash_only',
  WALLET_INSUFFICIENT_BALANCE: 'wallet.insufficient_balance',
  VALIDATION_TOO_LONG: 'validation.too_long',
  /*
    الدعم. A too-short message gets its own code rather than the generic one: "say a bit more" is
    actionable, where "invalid" on a free-text box tells somebody nothing about what to change.
  */
  SUPPORT_MESSAGE_TOO_SHORT: 'support.message_too_short',
  SUPPORT_TICKET_NOT_FOUND: 'support.ticket_not_found',
  SUPPORT_TICKET_CLOSED: 'support.ticket_closed',

  /*
    `O-api-2`, closed 2026-08-25 — the last refusals that answered a hand-written English sentence.

    Each replaces prose passed to an `HttpException` constructor, which `safra/no-hardcoded-text`
    cannot see because the string is a function argument rather than JSX. Five codes, and the two
    that carry NUMBERS carry them in `params` rather than in the sentence: a translator must be able
    to put the figure where their grammar wants it.
  */

  /**
   * A wallet debit larger than the balance, WITH the figures.
   *
   * Distinct from `wallet.insufficient_balance`, which the gift-card paths raise without any: this
   * one states the shortfall, because "insufficient balance" with no numbers is the error that
   * opens a support ticket instead of closing one. The generic code keeps its generic message.
   */
  WALLET_BALANCE_BELOW_AMOUNT: 'wallet.balance_below_amount',
  /**
   * The second factor is not enrolled yet, on an otherwise valid session.
   *
   * NOT `auth.two_factor_setup_required`, which means "you called enable before setup". This one
   * means "enrol before using anything", and the two reach different screens.
   */
  AUTH_TWO_FACTOR_ENROLMENT_REQUIRED: 'auth.two_factor_enrolment_required',
  /** A money setting given something that is not a positive amount. Carries the setting KEY. */
  SETTING_VALUE_NOT_POSITIVE_MONEY: 'setting.value_not_positive_money',
  /** A setting whose schema the generic editor cannot validate. Carries the key and the schema. */
  SETTING_SCHEMA_NOT_EDITABLE: 'setting.schema_not_editable',
  /**
   * Screening cannot run: no list imported, or the one there is too old to be called current.
   *
   * ONE code for both reasons, deliberately. The distinction between `missing` and `stale` is
   * already drawn for staff by `GET /admin/sanctions/status`, which is where the console reads it;
   * splitting it here would put the platform's screening posture in a body a direct caller can read.
   */
  SANCTIONS_LIST_UNAVAILABLE: 'sanctions.list_unavailable',
} as const;

export type ErrorCode = (typeof ERROR)[keyof typeof ERROR];

/** Whether a value is one of our codes — used at client boundaries before translating. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(ERROR) as readonly string[]).includes(value)
  );
}

/**
 * The values a message needs, read off the Zod issue that produced it.
 *
 * ## Why this lives in contracts rather than beside a validator
 *
 * A schema writes `.min(12, ERROR.VALIDATION_PASSWORD_TOO_SHORT)` and the catalogue entry for that
 * code says "at least {min} characters" — the number lives in the schema, the sentence lives in the
 * catalogue, and something has to join them. Zod puts the bound on the issue, so the join is
 * derivation rather than a hand-written map of code to parameters.
 *
 * It is HERE because more than one place validates the same schema. The API's `ZodValidationPipe`
 * does, and so do the customer app's `/api/auth/*` proxy routes, which parse locally and refuse
 * before calling the API at all. That second path is what shipped the bug: the API was fixed to
 * forward `{ min: 12 }` and the registration form still printed «يجب أن تكون كلمة المرور {min} أحرف
 * على الأقل.», because for a short password the request never reached the API (Bashar, 2026-08-14).
 *
 * Four copies of this function would have been four chances for one to be forgotten. One copy, in
 * the package that owns both the codes and the schemas, is the only arrangement where fixing it
 * once fixes it everywhere.
 */
export function errorParamsOf(issue: {
  readonly code?: string;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
}): Record<string, string | number> | undefined {
  if (issue.code === 'too_small' && typeof issue.minimum === 'number') {
    return { min: issue.minimum };
  }

  if (issue.code === 'too_big' && typeof issue.maximum === 'number') {
    return { max: issue.maximum };
  }

  return undefined;
}
