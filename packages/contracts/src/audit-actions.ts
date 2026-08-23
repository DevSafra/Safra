/**
 * Every action the platform writes to `audit_log.action` — the canonical list.
 *
 * ## Why this exists at all
 *
 * `AuditEntry.action` is a `string`, and the console translates it. Those two facts together mean an
 * action is a CONTRACT between the API that writes it and the console that displays it, with nothing
 * enforcing either side. On 2026-08-20 that cost forty-three missing Arabic labels: the console's
 * catalogue covered thirty of the seventy-three actions the code emits, and the rest reached
 * السجل as English prose because the fallback spaced the underscores out. See
 * `messages/admin/ar.ts` → `auditAction`.
 *
 * So the list lives here, once, and two tests hold both ends to it:
 *
 *   - `audit-actions.test.ts` (i18n) — every action here has an Arabic label.
 *   - `audit-catalogue.integration.test.ts` (api) — every action in the DATABASE is listed here.
 *
 * The first stops an action shipping untranslated. The second catches one that was emitted without
 * being registered, which is the only failure the first cannot see.
 *
 * ## Adding one
 *
 * Add it here, add its Arabic label, done. Both tests fail until you do, and that is the point —
 * `audit_log` is append-only, so an action written under a typo'd name is in the record forever.
 *
 * ## Why it is not the type of `AuditEntry.action` yet
 *
 * It should be, and that is the obvious next step. It is not done in the same change because five
 * call sites build the action with a template literal — `partner.${nextStatus}`,
 * `property.${decision === 'approve' ? 'approved' : 'rejected'}`, `dispute.${outcome}`,
 * `ad_campaign.${…}` and one raw SQL insert — so the union would need those narrowed by hand, and a
 * refactor of the audit trail wants to be its own reviewable change rather than a side effect of an
 * i18n fix. Recorded in `docs/FUTURE-WORK.md`.
 *
 * Those five are exactly why the two REJECTION actions were missing while their approvals were
 * present: a reader of the source sees one action where there are two.
 */
export const AUDIT_ACTIONS = [
  // ── Authentication ────────────────────────────────────────────────────────
  'auth.registered',
  'auth.register_existing_email',
  'auth.email_verified',
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.password_changed',
  'auth.password_change_refused',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.recovery_code_used',
  'auth.two_factor_enabled',
  'auth.two_factor_disabled',

  // ── Bookings and money ────────────────────────────────────────────────────
  'booking.created',
  'booking.cancelled',
  'booking.payment_captured',
  'booking.sla_expired',
  'booking.exported',
  'booking.export_requested',
  'payment.started',
  'payment.failed',
  'refund.created',
  'fx_rate.set',
  'wallet.adjusted',
  'gift_card.purchase',
  'gift_card.redeem',

  // ── Partners ──────────────────────────────────────────────────────────────
  'partner.registered',
  'partner.approved',
  'partner.rejected',
  'partner.sanctions_screened',
  'partner.two_factor_reset',
  'partner.invitation_accepted',
  'partner_document.uploaded',
  'partner_document.viewed',
  'partner_document.reviewed',
  'partner_contract.viewed',
  'partner_payout.released',
  'partner_payout.paid',
  'partner_payout.cancelled',
  'partner_payout.closed',
  'partner_application.submitted',
  'partner_application.contacted',
  'partner_application.accepted',
  'partner_application.rejected',
  'partner_application.invitation_resent',

  // ── Inventory ─────────────────────────────────────────────────────────────
  'property.created',
  'property.updated',
  'property.submitted_for_review',
  'property.approved',
  'property.rejected',
  'property_image.uploaded',
  'property_image.archived',
  'property_image.cover_set',
  'property_image.reordered',
  'city_image.uploaded',
  'city_image.archived',
  'unit.created',
  'unit.updated',
  'calendar.range_updated',

  // ── Customers, reviews, disputes ──────────────────────────────────────────
  'customer.profile_updated',
  'review.created',
  'review.replied',
  'review.reported',
  'review.hidden',
  'review.report_dismissed',
  'dispute.resolved',
  'dispute.rejected',

  // ── Advertising ───────────────────────────────────────────────────────────
  'ad_campaign.paused',
  'ad_campaign.resumed',

  // ── Staff and configuration ───────────────────────────────────────────────
  'staff.invited',
  'staff.invitation_accepted',
  'staff.invitation_resent',
  'staff.role_changed',
  'staff.scope_changed',
  'staff.suspended',
  'staff.reinstated',
  'rbac.grant_toggled',
  'setting.updated',
  /*
    `emergency_mode.*`, not `emergency.*`. The route is `/emergency` and the section is «وضع
    الطوارئ», so the shorter name is the one you reach for — and it is wrong. Taken from
    `emergency.service.ts`, which is the only authority for a name that is already written into an
    append-only table.
  */
  'emergency_mode.activated',
  'emergency_mode.deactivated',
  'partner_contract.uploaded',
  /* Generated by SAFRA from the template, before anybody has signed it. */
  'partner_contract.generated',
  /* One party's HAND-SIGNED copy, uploaded. The payload names WHICH party. */
  'partner_contract.countersigned',
  /* Staff handed the signing step back so the partner can upload again. */
  'partner_contract.reopened',
  'partner_contract.signed',
] as const;

/** One of the actions above. */
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
