/**
 * The English error copy — and the text that travels in every API response.
 *
 * This catalogue does two jobs, which is why it must stay complete: it is what an
 * English-speaking customer reads, AND it is the `message` field the API sends alongside the
 * code, so it lands in server logs and in any client that has not been taught the codes. Keep it
 * plain and free of internal vocabulary.
 */
export const en = {
  'request.malformed_body': 'Malformed request body.',
  'request.validation_failed': 'Validation failed.',
  'request.body_too_large': 'That file is larger than the limit. Choose a smaller one.',
  'request.cursor_invalid': 'Malformed pagination cursor.',
  'request.not_found': 'Not found.',
  'request.upstream_unreachable': 'Could not reach the server. Please try again.',
  'request.unknown': 'Something went wrong. Please try again.',
  'request.too_many': 'Too many requests. Please wait a moment and try again.',
  'request.capacity': 'The service is busy right now. Please try again in a moment.',
  'auth.required': 'Authentication required.',
  'auth.credentials_invalid': 'Invalid email or password.',
  'auth.password_incorrect': 'Password is incorrect.',
  'auth.locked':
    'Account temporarily locked after repeated failed attempts. Try again later.',
  'auth.too_many_attempts': 'Too many attempts. Please wait and try again.',
  'auth.email_code_sent':
    'We have emailed you a six-digit code. Enter it to finish signing in.',
  'auth.email_code_invalid': 'That code is wrong or has expired. Ask for a new one.',
  'auth.email_code_too_many':
    'Too many codes requested in a short time. Please wait and try again.',
  'auth.code_required': 'Authenticator code required.',
  'auth.code_invalid': 'Invalid authenticator code.',
  'auth.code_malformed': 'That code is not valid.',
  'auth.recovery_code_invalid': 'Invalid recovery code.',
  'auth.no_authenticator': 'No authenticator is configured.',
  'auth.two_factor_already_enabled': 'Two-factor authentication is already enabled.',
  'auth.two_factor_not_enabled': 'Two-factor authentication is not enabled.',
  'auth.email_taken': 'An account with this email already exists.',
  'auth.confirmation_link_invalid': 'This confirmation link is invalid or has expired.',
  'auth.reset_link_invalid': 'This reset link is invalid or has expired.',
  'auth.token_invalid': 'Invalid or expired token.',
  'auth.session_expired': 'Session expired. Please sign in again.',
  'auth.session_missing': 'No active session.',
  'auth.not_staff':
    'This is not a staff account, so it cannot be used to sign in to the command centre.',
  'auth.not_partner':
    'This account cannot use the partner dashboard. If you were sent a partnership invitation or an invitation to work for a partner, open its link from your email to activate the account first.',
  'auth.staff_account':
    'This is a staff account. Sign in to the SAFRA command centre instead.',
  'permission.denied': 'You do not have access to this resource.',
  'scope.outside': 'This record is outside your assigned scope.',
  'staff.not_found': 'Staff member not found.',
  'payout.frozen_by_suspension':
    'The payout is frozen while the partner account is suspended.',
  'partner.suspended':
    'The partner account is suspended, so this action cannot be carried out.',
  'partner.already_suspended': 'That account is already suspended.',
  'partner.not_suspended': 'That account is not suspended.',
  'violation.not_found': 'That violation was not found.',
  'violation.stage_invalid': 'The violation cannot move to that stage.',
  'violation.not_fined': 'That violation carries no fine.',
  'violation.already_waived': 'That fine has already been waived.',
  'audit_entry.not_found': 'That activity entry was not found.',
  'staff.role_invalid': 'That is not a staff role.',
  'staff.cannot_suspend_self': 'You cannot suspend your own account.',
  'staff.cannot_change_own_scope': 'You cannot change your own scope.',
  'staff.role_not_scopable': 'This role cannot be scoped.',
  'staff.cities_unrecognised': 'One or more cities were not recognised.',
  'booking.not_found': 'Booking not found.',
  'booking.verification_failed':
    'That verification code is not valid or has expired. Send a new one.',
  'booking.not_payable': 'This booking can no longer be paid.',
  'booking.stay_too_long': 'A stay may not exceed {maxNights} nights.',
  'booking.no_refundable_amount': 'No refundable amount remains on this booking.',
  'booking.draft_not_refundable': 'A draft booking has no payment to refund.',
  'booking.dates_just_taken':
    'Those dates were just taken. Please choose different dates.',
  'booking.same_day_closed':
    "Today's bookings have closed for this city. The first available date is {date}.",
  'booking.arrival_in_past':
    'The arrival date is in the past. The first available date is {date}.',
  'payment.unavailable': 'Payment is temporarily unavailable. Please retry.',
  'partner.not_found': 'Partner not found.',

  // ── Partner payouts (§7.1) ────────────────────────────────────────────────
  'payout.not_found': 'That payout could not be found.',
  'payout.not_accruing': 'That period is not open, so it cannot be closed.',
  'payout.not_releasable': 'This payout cannot be released in its current state.',
  'payout.not_scheduled': 'This payout has not been scheduled yet.',
  'payout.not_held': 'This payout is not on hold.',
  'payout.already_paid':
    'This payout has been paid and cannot be changed. Post a reversing entry instead.',
  'payout.already_final': 'This payout is final and cannot be changed.',
  'payout.nothing_to_pay': 'There is nothing payable in this period.',
  'payout.frozen_by_dispute': 'An open dispute freezes the payout for these bookings.',
  'payout.partner_not_screened':
    'This payout cannot be released before the partner has been screened.',
  'payout.no_verified_account':
    'This payout cannot be released until the partner has an active, verified payout account.',
  'payout.account_unverified_at_payment':
    'The payout account on this transfer is no longer verified. Verify it and try again.',
  'payout_account.not_found': 'Payout account not found.',
  'payout_account.not_pending': 'This payout account has already been reviewed.',
  'payout_account.in_use':
    'A payout account attached to a scheduled transfer cannot be removed.',
  'partner.already_verified': 'Partner is already verified.',
  'partner.profile_missing': 'This account is not linked to a partner profile.',
  'partner.type_unknown': 'Unknown partner type.',
  'property.not_found': 'Property not found.',
  'property.type_unknown': 'Unknown property type.',
  'property.amenities_unknown': 'One or more amenity codes are unknown.',
  'property.slug_not_derivable': 'Could not derive a unique slug; please vary the name.',
  'unit.not_found': 'Unit not found.',
  'unit.not_found_or_range_empty': 'Unit not found, or the date range is empty.',
  'document.not_found': 'Document not found.',
  'upload.file_missing': 'No file was uploaded.',
  'upload.file_empty': 'The uploaded file is empty.',
  'upload.file_too_large': 'That file is larger than {maxMb} MB.',
  'upload.not_an_image': 'The file could not be read as an image.',
  'upload.image_unreadable': 'That image could not be read.',
  'upload.image_too_large': 'Image dimensions are too large.',
  'image.not_found': 'Image not found.',
  'contract.not_found': 'Contract not found.',
  'contract.pdf_required': 'A contract must be a PDF of 10MB or less.',
  'contract.not_signable': 'This contract cannot be signed in its current state.',
  'contract.not_reopenable': 'Only a fully signed contract can be re-opened.',
  'contract.joint_not_allowed':
    'A jointly signed copy can only be filed while a partner is being added. Use the ordinary path: upload SAFRA\u2019s copy, then wait for the partner to sign.',
  'employee_role.name_taken': 'A role with that name already exists. Choose another.',
  'employee_role.not_found': 'That role could not be found.',
  'employee_role.in_use':
    'A role that employees still hold cannot be removed. Move them to another role first.',
  'employee.not_found': 'That employee could not be found.',
  'employee.already_employed': 'That address already works for a partner.',
  'employee.email_is_staff': 'That address belongs to a SAFRA staff account.',
  'employee.email_is_owner': 'That address belongs to the partner account itself.',
  'employee.invitation_invalid':
    'That invitation link is invalid or has expired. Ask the partner to send a new one.',
  'staff_role.name_taken': 'A role with that name already exists. Choose another.',
  'staff_role.not_found': 'That role could not be found.',
  'staff_role.system': 'This is a system role and cannot be changed or removed.',
  'staff_role.in_use':
    'A role that staff still hold cannot be removed. Move them to another role first.',
  'staff.last_super_admin':
    'This is the last active super admin. Promote another one first, or the platform cannot be administered.',
  'contract.not_awaiting_signature': 'Only a contract awaiting signature can be signed.',
  'dispute.not_found': 'Dispute not found.',
  'dispute.already_closed': 'This dispute is already closed.',
  'dispute.booking_not_disputable':
    'This booking cannot be disputed. Only a paid booking can be.',
  'dispute.already_open':
    'You already have an open dispute about this booking for that reason.',
  'conversation.not_found_or_closed': 'Conversation not found or closed.',
  'conversation.recipient_not_found': 'Recipient not found.',
  'campaign.not_found': 'Campaign not found.',
  'gift_card.code_invalid': 'That gift card code is not valid. Check it and try again.',
  'ad.target_url_invalid': 'That link is not valid — it must start with http or https.',
  'ad.window_order': 'The end date must be after the start date.',
  'ad.price_needs_currency': 'A price needs a currency, and a currency needs a price.',
  'advertiser.not_found': 'Advertiser not found.',
  'ad_invoice.not_found': 'Invoice not found.',
  'ad_invoice.not_due': 'That invoice is not due.',
  'coupon.invalid': 'That code is not valid.',
  'coupon.not_started': 'This coupon has not started yet.',
  'coupon.expired': 'This coupon has expired.',
  'coupon.inactive': 'This coupon is not active.',
  'coupon.exhausted': 'This coupon has been fully redeemed.',
  'coupon.customer_limit':
    'You have already used this coupon the maximum number of times.',
  'coupon.minimum_not_met': 'The booking is below the minimum for this coupon.',
  'coupon.not_for_city': 'This coupon does not apply in this city.',
  'coupon.not_for_partner': 'This coupon does not apply to this property.',
  'coupon.first_booking_only': 'This coupon is for a first booking only.',
  'coupon.currency_mismatch': 'The coupon currency differs from the booking currency.',
  'coupon.code_taken': 'That code is already in use.',
  'coupon.already_decided':
    'This coupon has already been decided. Acceptance is final and cannot be reversed.',
  'coupon.not_found': 'Coupon not found.',
  'coupon.window_order': 'The end date must be after the start date.',
  'coupon.percent_range': 'A percentage must be between 1 and 100.',
  'coupon.fixed_needs_currency': 'A fixed-value coupon needs a currency.',
  'gift_card.already_used': 'This gift card has already been redeemed.',
  'gift_card.expired': 'This gift card has expired.',
  'gift_card.cancelled': 'This gift card has been cancelled. Please contact support.',
  'gift_card.not_cancellable':
    'This card cannot be cancelled — it is already used, expired or cancelled.',
  'gift_card.not_found': 'Gift card not found.',
  'gift_card.cash_only':
    'Your current balance is not enough for this card. A gift card can only be bought with your own money — not with gift card balance, and not with credit SAFRA has given you.',
  'gift_card.amount_invalid': 'Choose one of the available gift card amounts.',
  'wallet.insufficient_balance': 'Your wallet balance is not enough for this.',
  'support.message_too_short': 'Please describe the problem in a little more detail.',
  'support.ticket_not_found': 'That support request could not be found.',
  'support.ticket_closed': 'This support request is closed. Please open a new one.',
  'validation.too_long': 'This value is too long.',
  'validation.account_number': 'An account number is 4 to 34 letters or digits.',
  'validation.star_rating': 'Choose a star rating from 1 to 5.',
  'validation.star_rating_required': 'A hotel must have a star rating.',
  'validation.star_rating_not_a_hotel':
    'Star ratings apply to hotels only. This accommodation type does not carry one.',
  'validation.payout_method': 'Unknown transfer method.',
  'validation.swift': 'A SWIFT code is 8 or 11 characters.',
  'validation.out_of_range': 'The value is outside the allowed range.',
  'validation.code_invalid':
    'The identifier must start with a lower-case letter and contain only lower-case letters, digits and underscores.',
  'property_type.code_taken':
    'That identifier is already used by another accommodation type.',
  'property_type.not_found': 'No accommodation type with that identifier.',
  'wallet.not_found': 'This customer has no wallet.',
  'wallet.amount_not_positive': 'A wallet movement must be a positive amount.',
  'customer.profile_missing': 'This account has no customer profile.',
  'customer.not_found': 'No such customer profile.',
  'geo.city_unknown': 'Unknown city.',
  'geo.city_not_found': 'City not found.',
  'geo.country_not_found': 'Country not found.',
  'geo.category_not_found': 'Category not found.',
  'catalogue.not_found': 'No catalogue entry with that code.',
  'catalogue.code_taken': 'That code is already in use. Choose another.',
  'catalogue.in_use':
    '{count} records point at it, so it cannot be deleted — deactivate it instead: it leaves the pickers and everything already using it keeps working.',
  'catalogue.code_format':
    'A code is lowercase Latin letters, digits and hyphens, e.g. ev-charger.',
  'geo.category_in_use':
    'That category is filed against {n} cities — deactivate it instead of removing it.',
  'geo.city_in_use':
    'A city referenced by {n} records (properties, bookings, partners…) cannot be deleted. Deactivate it instead.',
  'geo.country_in_use':
    'A country holding {n} cities cannot be deleted. Delete its cities first, or deactivate it.',
  'geo.currency_in_use':
    'A currency used by {n} records cannot be deleted. Deactivate it instead.',
  'geo.currency_accounting':
    'The accounting currency cannot be deleted — every ledger entry is denominated in it.',
  'geo.code_taken': 'That code is already in use.',
  'geo.slug_taken': 'That slug is already used in this country.',
  'geo.timezone_invalid': 'That is not a valid time zone.',
  'geo.slug_format': 'A slug takes lowercase Latin letters, digits and hyphens only.',
  'geo.country_code_format': 'A country code is two upper-case Latin letters.',
  'geo.currency_unknown': 'Unknown currency.',
  'setting.value_flat_or_percent': '{key} must be "flat" or "percent".',
  'setting.value_sanctions_policy':
    'The value of {key} must be required, advisory or off.',
  'setting.value_percent_range': '{key} must be a number between 0 and 100.',
  'setting.value_positive_int': '{key} must be a whole number of at least 1.',
  'setting.value_hour_of_day': '{key} must be an hour between 0 and 23.',
  'setting.value_boolean': '{key} must be true or false.',
  'setting.no_updatable_fields': 'No updatable fields were provided.',
  'emergency.activation_failed': 'Emergency mode could not be activated.',
  'validation.email_invalid': 'A valid email address is required.',
  'validation.required': 'This field is required.',
  'validation.password_too_short': 'Password must be at least {min} characters.',
  'validation.password_composition':
    'Your password needs an uppercase letter, a lowercase letter, a number, a symbol, and at least 12 characters.',
  'validation.password_common':
    'That password is among the most used and is guessed first. Choose another — four unrelated words works well.',
  'validation.password_predictable':
    'That password is predictable: repeated or sequential characters. Length alone does not help when the pattern is obvious.',
  'validation.password_contains_identity':
    'Do not use your email, your name, or the name of this site inside your password.',
  'validation.code_six_digits': 'Authenticator code must be 6 digits.',
  'validation.date_format': 'Date must be in YYYY-MM-DD format.',
  'validation.date_unreal': 'Date is not a real calendar date.',
  'validation.departure_after_arrival': 'Departure date must be after the arrival date.',
  'validation.end_before_start': 'End date must not be before the start date.',
  'validation.range_too_long': 'A calendar range may not exceed {maxDays} days.',
  'validation.amount_positive': 'Amount must be greater than zero.',
  'validation.reason_required': 'A reason is required — this is the audit record.',
  'validation.rejection_reason_required': 'A rejection must include a reason.',
  'validation.latitude_range': 'Latitude must be between -90 and 90.',
  'validation.latitude_format': 'Latitude must be decimal degrees.',
  'validation.longitude_range': 'Longitude must be between -180 and 180.',
  'validation.longitude_format': 'Longitude must be decimal degrees.',
  'validation.nights_min_max': 'Maximum nights cannot be lower than minimum nights.',
  'validation.booking_reference': 'Malformed booking reference.',
  'validation.url_invalid': 'Enter a valid URL beginning with https://',
  'validation.token_malformed': 'Malformed link token.',
  'validation.access_token_malformed': 'Malformed access token.',
  'validation.scope_all_cities_conflict': 'An all-cities scope cannot carry a city list.',
  'request.in_progress': 'That request is already being processed. Please retry.',
  'request.still_processing':
    'That request is still being processed. Please retry shortly.',
  'auth.unavailable': 'Sign-in is temporarily unavailable. Please contact support.',
  'auth.code_invalid_check_app': 'That code is not valid. Check your authenticator app.',
  'auth.two_factor_setup_required':
    'Start setup before enabling two-factor authentication.',
  'auth.two_factor_already_enabled_reenrol':
    'Two-factor authentication is already enabled. Disable it first to re-enrol.',
  'auth.two_factor_role_ineligible':
    'Two-factor authentication is not available for this account type.',
  'partner.two_factor_target_not_partner':
    'This account is not a partner. Two-factor resets here apply to partner accounts only.',
  'validation.review_rating_range': 'A review score must be between 1 and 5.',
  'image.order_mismatch':
    'The image order must list exactly this property\u2019s current images.',
  'image.last_one':
    'A published listing needs at least one image. Upload a replacement first.',
  'review.not_found': 'Review not found.',
  'review.stay_not_completed': 'A review can only be written after the stay is complete.',
  'review.already_written': 'This booking already has a review.',
  'review.not_your_booking': 'That booking is not yours to review.',
  'review.already_replied': 'You have already replied to this review.',
  'review.already_reported': 'This review has already been reported.',
  'review.not_reported':
    'This review has not been reported, so there is nothing to decide.',
  'partner.two_factor_no_account':
    'This partner has no sign-in account, so there is no second factor to reset.',
  'staff.role_invalid_console':
    'That is not a staff role. This endpoint creates console accounts only.',
  'staff.email_taken':
    'An account with that email already exists. Change its role instead of inviting it.',
  'staff.already_activated':
    'That account has already been activated. Use a password reset instead.',
  'staff.invitation_invalid': 'That invitation link is invalid or has already been used.',
  'staff.cannot_change_own_role':
    'You cannot change your own role. Ask another super admin.',
  'booking.departure_after_arrival':
    'Departure must be at least one night after arrival.',
  'booking.arrival_minimum_nights':
    'Arrivals on {date} require at least {nights} nights.',
  'booking.no_captured_payment':
    'This booking has no captured payment, so there is nothing to refund.',
  'booking.not_payable_in_status': 'This booking cannot be paid in its current state.',
  'payment.refund_unavailable':
    'Refunds through the original payment method are temporarily unavailable.',
  'pricing.unavailable': 'Pricing is temporarily unavailable. Please try again shortly.',
  'wallet.wrong_account':
    'Sign in to the account that holds this booking to use your balance.',
  'wallet.balance_changed':
    'Your balance changed while this payment was being prepared. Please try again.',
  'partner_application.not_found': 'That partnership request was not found.',
  'partner_application.already_open':
    'We already have an open request from this email address. We will be in touch.',
  'partner_application.already_decided': 'This request has already been decided.',
  'partner_application.no_account':
    'This request has no account behind it and cannot be accepted.',
  'partner_application.email_is_staff':
    'That email address belongs to a staff account and cannot be turned into a partner account.',
  'partner_application.email_is_partner': 'That email address is already a partner.',
  'partner_onboarding.email_is_staff':
    'That email address belongs to a staff account and cannot be registered as a partner.',
  'partner_onboarding.email_is_partner':
    'That email address is already a partner. Find them in the partner registry.',
  'partner_onboarding.already_activated':
    'This partner has already accepted their invitation and set a password. Use “forgot password” to reset it.',
  'partner_onboarding.application_open':
    'There is an open partnership request from this email address. Finish it from the requests queue instead of registering a new partner.',
  'partner.invitation_invalid':
    'That invitation link is invalid or has already been used.',
  'partner.not_verified':
    'This partner is not verified yet. Verify the partner before publishing their listings.',
  'partner.sanctions_screening_required':
    'Sanctions screening must be recorded before a partner can be verified.',
  'property.unit_required': 'Add at least one unit before submitting for review.',
  'property.not_structurally_editable':
    'A published listing cannot be edited structurally. Contact SAFRA support to request a change.',
  'property.not_submittable':
    'Only a draft or rejected listing can be submitted for review.',
  'property.not_reviewable': 'Only a listing awaiting review can be reviewed.',
  'property.image_limit': 'A property may have at most {max} images.',
  'property.cancellation_policy_unknown': 'Unknown cancellation policy.',
  'geo.city_image_limit': 'A city may have at most {max} images.',
  'geo.city_image_last_one':
    'A city cannot be left without a photograph. Upload a replacement first, then delete this one.',
  'unit.unavailable_on': 'The unit is not available on {date}.',
  'unit.guest_limit': 'This unit accommodates {max} guests; {requested} were requested.',
  'unit.max_nights': 'This unit allows at most {max} nights.',
  'unit.min_nights': 'This unit requires at least {min} nights.',
  'document.limit_reached':
    'A partner may hold at most {max} documents. Remove one first.',
  'document.type_unsupported':
    'Only PDF, JPEG and PNG files are accepted for verification documents.',
  'upload.image_type_unsupported':
    'Only JPEG, PNG, WebP, AVIF, HEIF or TIFF images are accepted.',
  'upload.image_too_small': 'Images must be at least {min}x{min} pixels.',
  'upload.image_processing_failed':
    'This image could not be processed. Try uploading it again.',
  'export.not_found': 'No export with that reference.',
  'export.not_ready': 'That export is still being prepared. Refresh in a moment.',
  'export.failed': 'That export could not be built. Request it again.',
  'export.expired': 'That file has expired. Request a new export.',
  'setting.unknown':
    'No such setting. Settings are seeded, not created from this screen.',
  'setting.value_rate':
    '{key} is a rate and must be a number between 0 and 1 (7% is 0.07).',
  'campaign.expired':
    'This campaign has expired. Create a new campaign for a new window.',
  'validation.password_too_long': 'Password must be at most {max} characters.',
  'validation.phone_format':
    'Phone must be in international format, for example +963933123456.',
  'validation.phone_invalid':
    'That number is not valid in the country selected. Check it, or choose another country.',
  'validation.recovery_code_format': 'Recovery code format is XXXX-XXXX-XXXX.',
  'validation.decimal_string': 'Enter an amount such as 10.00.',
  'validation.currency_code': 'Must be a three-letter ISO 4217 currency code.',
  'validation.rate_positive': 'Rate must be greater than zero.',
  'validation.rate_syp_fixed': 'The SYP to SYP rate is always 1 and cannot be set.',
  'validation.price_range': 'Minimum price cannot exceed maximum price.',
  'validation.one_field_required': 'Provide at least one field to update.',
  'validation.password_unchanged': 'Your new password must differ from your current one.',
  'validation.rejection_notes_required':
    'A rejection requires notes explaining what must change.',
  'validation.sanctions_body_too_small':
    'That file is too small to be a consolidated sanctions list; the download looks truncated.',
  'validation.sanctions_source': 'Unknown list source. Say which list is being imported.',
  'booking.transition_invalid':
    'A booking cannot move to that state from its current one.',
  'request.idempotency_key_reused':
    'This idempotency key was already used with a different request.',

  /* `O-api-2`, 2026-08-25 — the last refusals that answered a bare English sentence. */
  'wallet.balance_below_amount':
    'Your wallet holds {balance} {currency}, which is less than the {requested} {currency} needed.',
  'wallet.not_withdrawable':
    'The withdrawable part of your balance is {withdrawable} {currency}, which is less than the {requested} {currency} needed. {restricted} {currency} is credit from SAFRA: it can be spent on the platform but not withdrawn.',
  'auth.two_factor_enrolment_required':
    'Two-factor authentication is required for this account. Enrol before continuing.',
  'setting.value_not_positive_money':
    '{key} must be a positive amount — either a number, or an amount with a currency.',
  'setting.schema_not_editable':
    '{key} has the schema "{schema}", which this editor cannot check. Change it deliberately rather than through this form.',
  'sanctions.list_unavailable':
    'Screening is unavailable: the sanctions list is missing or out of date. Refresh it before screening.',
} as const;
