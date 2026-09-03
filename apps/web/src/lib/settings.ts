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
