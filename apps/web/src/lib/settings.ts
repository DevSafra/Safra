import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/lib/localise';

/**
 * Reads operational values that the storefront must DISPLAY.
 *
 * Nothing here hardcodes a fee. The super admin sets these on the Rules Engine
 * settings page (P-005), and the approved screen charges the customer a flat
 * $1.99 while the partner pays 7% — two different units. Rendering either as a
 * literal string in a component would mean a price change requires a deploy.
 */
export function customerFee(settings: Record<string, unknown>): {
  mode: 'flat' | 'percent';
  value: number;
} {
  const mode =
    settings['commission.customer_fee_mode'] === 'percent' ? 'percent' : 'flat';
  const raw = settings['commission.customer_fee_value'];
  const value = typeof raw === 'number' ? raw : Number(raw ?? 0);

  return { mode, value: Number.isFinite(value) ? value : 0 };
}

export function partnerRate(settings: Record<string, unknown>): number | null {
  const raw = settings['commission.partner_rate'];

  if (raw === undefined || raw === null) {
    // Distinct from zero. A missing setting must not render as "0% commission" —
    // that is a false claim about our pricing, and it is how an unreachable API
    // turns into a misleading marketing page.
    return null;
  }

  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Formats a configured fee for display, respecting its unit.
 *
 * `partnerRate` is stored as a fraction (0.07) and shown as a percentage; the
 * customer fee is shown as currency when flat and as a percentage when not.
 */
export function formatCustomerFee(
  settings: Record<string, unknown>,
  which: 'customerFee' | 'partnerRate',
  locale: Locale,
): string {
  const intlLocale = locale === 'ar' ? 'ar-SY' : locale;

  if (which === 'partnerRate') {
    const rate = partnerRate(settings);

    // An em dash rather than a number we cannot stand behind.
    if (rate === null) return '—';

    return new Intl.NumberFormat(intlLocale, {
      style: 'percent',
      maximumFractionDigits: 2,
      numberingSystem: 'latn',
    }).format(rate);
  }

  const fee = customerFee(settings);

  if (fee.mode === 'percent') {
    return new Intl.NumberFormat(intlLocale, {
      style: 'percent',
      maximumFractionDigits: 2,
      numberingSystem: 'latn',
    }).format(fee.value);
  }

  /*
    Through `formatMoney`, not `Intl` directly — the SECOND place this spelling was decided.

    It rendered «رسوم خدمة ثابتة 1.99 US$» on the home page while the card beside it said «$100»,
    because both asked `Intl` for a currency STYLE and `Intl` answers in the reader's locale. One
    formatter now owns the question (see the note there), and this is a caller of it.
  */
  return formatMoney(String(fee.value), 'USD', locale);
}

/**
 * Today's date in the primary launch market's calendar.
 *
 * Used only as the date picker's floor. The AUTHORITATIVE same-day cutoff is
 * per-city and enforced by the API (§5.3) — a visitor in Berlin browsing Damascus
 * must not get Berlin's "today", and only the API knows the city's timezone before
 * a city has been chosen.
 */
export function todayInDamascus(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Damascus',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // en-CA yields YYYY-MM-DD.
  return parts;
}

/**
 * The header announcement for this reader, or nothing.
 *
 * Bashar, 2026-09-11: the banner stays and «the super admin should be able to manage it example
 * hide/show and write the message himself». So two settings decide it, and they mean different
 * things:
 *
 * - `site.announcement_enabled` is «no banner for anybody» — the switch to reach for during an
 *   incident, which must not require re-typing the wording to use.
 * - an EMPTY string for a locale is «no banner for readers of that language», which is how a
 *   notice written in Arabic and not yet translated stays off the German site rather than
 *   greeting a German reader in Arabic.
 *
 * Returns null for both, because the caller's question is «is there a banner», not «which of the
 * two reasons was it».
 */
export function announcementFor(
  settings: Record<string, unknown>,
  locale: string,
): string | null {
  if (settings['site.announcement_enabled'] !== true) return null;

  const text = settings['site.announcement_text'];

  if (typeof text !== 'object' || text === null) return null;

  const line = (text as Record<string, unknown>)[locale];

  /* Trimmed here as well as on the way in: a row written before the validator existed may not be. */
  return typeof line === 'string' && line.trim().length > 0 ? line.trim() : null;
}
