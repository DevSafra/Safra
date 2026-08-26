/**
 * The message templates SAFRA sends, in the three launch languages (design handoff §8).
 *
 * ## Why this is code and not a table
 *
 * A template is not configuration: each one is bound to a code path that knows which variables it
 * has, and adding one means writing the code that fills it. A `templates` table would let somebody
 * add a row that nothing ever sends, which is worse than no inventory at all — the console would
 * show a template that does not exist.
 *
 * The delivery LOG is data, in `notifications`. This is the catalogue, and the console shows both:
 * a template that has never been sent must still appear, and a query over the log cannot do that.
 *
 * ## The keys are identifiers; the NAMES are not here
 *
 * Each entry carries only its stable key. What staff call a template — "تأكيد الحجز + قسيمة + QR"
 * — is UI copy and lives in `@safra/i18n` under `notificationTemplate`, keyed by that same key.
 * It used to be a `nameAr` field on this interface, which put Arabic into a JSON response and gave
 * any second client nothing it could display.
 */
import type { EmailMessages } from '@safra/i18n';

export interface NotificationTemplate {
  /** Stable key, written to `notifications.template_key`. */
  readonly key: string;
  /** Which channels this template can go out on. */
  readonly channels: readonly ('whatsapp' | 'email')[];
  /** Locales the copy exists in. All six exist in all three (§8: "ع · EN · DE"). */
  readonly locales: readonly ('ar' | 'en' | 'de')[];
  /** Whether the send path is implemented today. */
  readonly implemented: boolean;
}

const ALL_LOCALES = ['ar', 'en', 'de'] as const;

/**
 * Which entry in the email catalogue each template key's copy lives under.
 *
 * The two names differ and always have: `notifications.template_key` is `support.replied`, and the
 * copy is `emailMessages(locale).supportReplied`. One is the identifier written to a row that
 * outlives any deploy; the other is a property name. Mapping them explicitly is the only honest
 * option — deriving one from the other by camel-casing would work until a key needed a name that
 * did not transliterate, and would fail silently when it did.
 *
 * Only the keys the platform SENDS are here. A template nothing sends has no row to expand.
 */
export const TEMPLATE_COPY_KEYS: Readonly<Record<string, keyof EmailMessages>> = {
  'booking.confirmed': 'bookingConfirmed',
  'booking.invoice': 'bookingInvoice',
  'booking.cancelled_refund': 'bookingCancelledBySafra',
  'booking.refunded': 'bookingRefunded',
  'booking.needs_action': 'bookingNeedsAction',
  'partner.deadline_reminder': 'bookingDeadlineReminder',
  'review.received': 'reviewReceived',
  'review.replied': 'reviewReplied',
  'support.replied': 'supportReplied',
  'partner.warned': 'partnerWarned',
  'partner.fined': 'partnerFined',
  'partner.fine_waived': 'partnerFineWaived',
  'partner.suspended': 'partnerSuspended',
  'partner.unsuspended': 'partnerUnsuspended',
};

export const NOTIFICATION_TEMPLATES: readonly NotificationTemplate[] = [
  {
    key: 'booking.confirmed',
    channels: ['whatsapp', 'email'],
    locales: ALL_LOCALES,
    /*
      Email works — `MailService` is wired and refuses to boot without SMTP. WhatsApp does not:
      the provider is undecided (item 192). The console shows the per-channel truth rather than one
      flag for the template, because "confirmation sending is broken" and "the WhatsApp half is
      not wired" lead to different actions.
    */
    implemented: true,
  },
  {
    key: 'booking.invoice',
    channels: ['email'],
    locales: ALL_LOCALES,
    /*
      Built 2026-08-25. `markPaid` sends it the moment the payment is captured, which is when a
      receipt is owed — a link to the customer's own invoice screen rather than an attachment, so
      no PDF is rendered on the capture path. `notification-catalogue.test.ts` holds the claim.
    */
    implemented: true,
  },
  {
    key: 'booking.cancelled_refund',
    channels: ['whatsapp', 'email'],
    locales: ALL_LOCALES,
    implemented: true,
  },
  {
    key: 'wallet.compensation',
    channels: ['whatsapp', 'email'],
    locales: ALL_LOCALES,
    /*
      Not a message of its own, and marking it implemented claimed one existed.

      §6.4's compensation is announced INSIDE `booking.cancelled_refund` — one event, one mail, as
      that template's own note explains. Nothing sends a separate «تعويض المحفظة» notice. The
      honest options were to build one or to stop claiming it; a second mail a minute after the
      first would read as a second problem.
    */
    implemented: false,
  },
  {
    key: 'partner.deadline_reminder',
    channels: ['whatsapp', 'email'],
    locales: ALL_LOCALES,
    /*
      Built 2026-08-26. The SLA sweep chases the partner when `SLA_EXPIRY_WARNING_MINUTES` remain —
      the same threshold at which the console starts warning staff — and once per booking, decided
      from the delivery log rather than from a new column.
    */
    implemented: true,
  },
  {
    key: 'ad.single_offer',
    channels: ['whatsapp'],
    locales: ALL_LOCALES,
    /*
      NOT implemented, and the one that must never be quietly switched on: §8 allows exactly one
      non-intrusive WhatsApp advertisement, and enforcing "one" needs the notification log to be
      consulted before every send. Until that check exists, the template stays inert.
    */
    implemented: false,
  },
] as const;
