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
  REQUEST_CURSOR_INVALID: 'request.cursor_invalid',
  REQUEST_NOT_FOUND: 'request.not_found',
  REQUEST_UPSTREAM_UNREACHABLE: 'request.upstream_unreachable',
  REQUEST_UNKNOWN: 'request.unknown',
  AUTH_REQUIRED: 'auth.required',
  AUTH_CREDENTIALS_INVALID: 'auth.credentials_invalid',
  AUTH_PASSWORD_INCORRECT: 'auth.password_incorrect',
  AUTH_LOCKED: 'auth.locked',
  AUTH_TOO_MANY_ATTEMPTS: 'auth.too_many_attempts',
  AUTH_CODE_REQUIRED: 'auth.code_required',
  AUTH_CODE_INVALID: 'auth.code_invalid',
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
  AUTH_NOT_STAFF: 'auth.not_staff',
  PERMISSION_DENIED: 'permission.denied',
  SCOPE_OUTSIDE: 'scope.outside',
  STAFF_NOT_FOUND: 'staff.not_found',
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
  IMAGE_NOT_FOUND: 'image.not_found',
  /** A reorder that does not name exactly the property's live images. */
  IMAGE_ORDER_MISMATCH: 'image.order_mismatch',
  /** Archiving the only image would leave a listing with no cover at all. */
  IMAGE_LAST_ONE: 'image.last_one',
  CONTRACT_NOT_FOUND: 'contract.not_found',
  CONTRACT_PDF_REQUIRED: 'contract.pdf_required',
  CONTRACT_NOT_AWAITING_SIGNATURE: 'contract.not_awaiting_signature',
  DISPUTE_NOT_FOUND: 'dispute.not_found',
  DISPUTE_ALREADY_CLOSED: 'dispute.already_closed',
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
  BOOKING_NO_CAPTURED_PAYMENT: 'booking.no_captured_payment',
  BOOKING_NOT_PAYABLE_IN_STATUS: 'booking.not_payable_in_status',
  PAYMENT_REFUND_UNAVAILABLE: 'payment.refund_unavailable',
  PRICING_UNAVAILABLE: 'pricing.unavailable',
  WALLET_WRONG_ACCOUNT: 'wallet.wrong_account',
  WALLET_BALANCE_CHANGED: 'wallet.balance_changed',
  PARTNER_NOT_VERIFIED: 'partner.not_verified',
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
} as const;

export type ErrorCode = (typeof ERROR)[keyof typeof ERROR];

/** Whether a value is one of our codes — used at client boundaries before translating. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(ERROR) as readonly string[]).includes(value)
  );
}
