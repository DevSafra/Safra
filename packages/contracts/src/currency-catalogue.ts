/**
 * The ISO 4217 currencies a staff member may add, with the facts that come WITH the code.
 *
 * ## Why a list rather than a text box
 *
 * Bashar (2026-08-30): «رمز العملة should be a menu to select, and the الرمز field should be
 * disabled and autofilled». A currency code is not free text — it is an identifier from a
 * standard, and the symbol and the minor-unit digits are properties OF that identifier, not
 * choices. Typing «USD» and «€» together produced a currency that renders every dollar with a
 * euro sign, and nothing would have refused it.
 *
 * `decimals` is the one that is silently expensive: JOD has THREE, and a currency stored with two
 * truncates 10.125 to 10.13 on the way in — the defect `0049_concerned_eternals.sql` exists to fix.
 * Taking it from the code rather than from a form field is what stops that recurring.
 *
 * ## Not every currency in the world
 *
 * The markets SAFRA serves and the ones a reader is likely to price in. Adding one here is a
 * one-line change with no migration; the point is that the three facts arrive together.
 */
export interface CurrencyOption {
  readonly code: string;
  readonly symbol: string;
  /** Minor-unit digits: 2 for USD, 0 for JPY, 3 for JOD. */
  readonly decimals: number;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly nameDe: string;
}

export const CURRENCY_CATALOGUE: readonly CurrencyOption[] = [
  {
    code: 'SYP',
    symbol: 'ل.س',
    decimals: 2,
    nameAr: 'ليرة سورية',
    nameEn: 'Syrian Pound',
    nameDe: 'Syrisches Pfund',
  },
  {
    code: 'USD',
    symbol: '$',
    decimals: 2,
    nameAr: 'دولار أمريكي',
    nameEn: 'US Dollar',
    nameDe: 'US-Dollar',
  },
  {
    code: 'EUR',
    symbol: '€',
    decimals: 2,
    nameAr: 'يورو',
    nameEn: 'Euro',
    nameDe: 'Euro',
  },
  {
    code: 'JOD',
    symbol: 'د.أ',
    decimals: 3,
    nameAr: 'دينار أردني',
    nameEn: 'Jordanian Dinar',
    nameDe: 'Jordanischer Dinar',
  },
  {
    code: 'LBP',
    symbol: 'ل.ل',
    decimals: 2,
    nameAr: 'ليرة لبنانية',
    nameEn: 'Lebanese Pound',
    nameDe: 'Libanesisches Pfund',
  },
  {
    code: 'TRY',
    symbol: '₺',
    decimals: 2,
    nameAr: 'ليرة تركية',
    nameEn: 'Turkish Lira',
    nameDe: 'Türkische Lira',
  },
  {
    code: 'AED',
    symbol: 'د.إ',
    decimals: 2,
    nameAr: 'درهم إماراتي',
    nameEn: 'UAE Dirham',
    nameDe: 'VAE-Dirham',
  },
  {
    code: 'SAR',
    symbol: 'ر.س',
    decimals: 2,
    nameAr: 'ريال سعودي',
    nameEn: 'Saudi Riyal',
    nameDe: 'Saudi-Riyal',
  },
  {
    code: 'EGP',
    symbol: 'ج.م',
    decimals: 2,
    nameAr: 'جنيه مصري',
    nameEn: 'Egyptian Pound',
    nameDe: 'Ägyptisches Pfund',
  },
  {
    code: 'IQD',
    symbol: 'د.ع',
    decimals: 3,
    nameAr: 'دينار عراقي',
    nameEn: 'Iraqi Dinar',
    nameDe: 'Irakischer Dinar',
  },
  {
    code: 'GBP',
    symbol: '£',
    decimals: 2,
    nameAr: 'جنيه إسترليني',
    nameEn: 'Pound Sterling',
    nameDe: 'Pfund Sterling',
  },
];

/** The catalogue entry for a code, or `undefined` — never a guessed symbol. */
export function currencyOption(code: string): CurrencyOption | undefined {
  return CURRENCY_CATALOGUE.find((one) => one.code === code.toUpperCase());
}
