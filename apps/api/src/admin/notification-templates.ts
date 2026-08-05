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
    implemented: true,
  },
  {
    key: 'partner.deadline_reminder',
    channels: ['whatsapp', 'email'],
    locales: ALL_LOCALES,
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
