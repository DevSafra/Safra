/**
 * Every dialling country, its calling code, and how many digits a national number has.
 *
 * GENERATED from `libphonenumber-js` — do not hand-edit. To regenerate after a dial plan
 * changes, see the command in `dial-codes.test.ts`, which fails if this table drifts from the
 * library.
 *
 * ## Why a generated table rather than the library in the browser
 *
 * The registration page is customer-facing and under a 2s budget (project rule 3). The library's
 * metadata is megabytes; what this field needs is three fields per country, which is a few kB. So
 * `libphonenumber-js` is a devDependency, used at generation and in the test, and no phone
 * library reaches the client at all.
 *
 * ## `digits` is the length of an EXAMPLE MOBILE number
 *
 * It drives the `0/10` counter, and it is a guide rather than a rule: several countries have
 * more than one valid national length. The counter therefore reports progress and never BLOCKS a
 * submission — the API's E.164 schema is the authority on what is valid, and a field that refuses
 * a real number because a table disagreed is worse than one that accepts an odd length.
 */
export type DialCountry = {
  /** ISO 3166-1 alpha-2. Also what the flag emoji and the country name are derived from. */
  readonly code: string;
  /** Calling code WITHOUT the plus — several countries share one (US and CA are both 1). */
  readonly dial: string;
  /** Digits in an example mobile number, for the counter. */
  readonly digits: number;
};

export const DIAL_COUNTRIES: readonly DialCountry[] = [
  { code: 'AC', dial: '247', digits: 5 },
  { code: 'AD', dial: '376', digits: 6 },
  { code: 'AE', dial: '971', digits: 9 },
  { code: 'AF', dial: '93', digits: 9 },
  { code: 'AG', dial: '1', digits: 10 },
  { code: 'AI', dial: '1', digits: 10 },
  { code: 'AL', dial: '355', digits: 9 },
  { code: 'AM', dial: '374', digits: 8 },
  { code: 'AO', dial: '244', digits: 9 },
  { code: 'AR', dial: '54', digits: 11 },
  { code: 'AS', dial: '1', digits: 10 },
  { code: 'AT', dial: '43', digits: 9 },
  { code: 'AU', dial: '61', digits: 9 },
  { code: 'AW', dial: '297', digits: 7 },
  { code: 'AX', dial: '358', digits: 9 },
  { code: 'AZ', dial: '994', digits: 9 },
  { code: 'BA', dial: '387', digits: 8 },
  { code: 'BB', dial: '1', digits: 10 },
  { code: 'BD', dial: '880', digits: 10 },
  { code: 'BE', dial: '32', digits: 9 },
  { code: 'BF', dial: '226', digits: 8 },
  { code: 'BG', dial: '359', digits: 8 },
  { code: 'BH', dial: '973', digits: 8 },
  { code: 'BI', dial: '257', digits: 8 },
  { code: 'BJ', dial: '229', digits: 10 },
  { code: 'BL', dial: '590', digits: 9 },
  { code: 'BM', dial: '1', digits: 10 },
  { code: 'BN', dial: '673', digits: 7 },
  { code: 'BO', dial: '591', digits: 8 },
  { code: 'BQ', dial: '599', digits: 7 },
  { code: 'BR', dial: '55', digits: 11 },
  { code: 'BS', dial: '1', digits: 10 },
  { code: 'BT', dial: '975', digits: 8 },
  { code: 'BW', dial: '267', digits: 8 },
  { code: 'BY', dial: '375', digits: 9 },
  { code: 'BZ', dial: '501', digits: 7 },
  { code: 'CA', dial: '1', digits: 10 },
  { code: 'CC', dial: '61', digits: 9 },
  { code: 'CD', dial: '243', digits: 9 },
  { code: 'CF', dial: '236', digits: 8 },
  { code: 'CG', dial: '242', digits: 9 },
  { code: 'CH', dial: '41', digits: 9 },
  { code: 'CI', dial: '225', digits: 10 },
  { code: 'CK', dial: '682', digits: 5 },
  { code: 'CL', dial: '56', digits: 9 },
  { code: 'CM', dial: '237', digits: 9 },
  { code: 'CN', dial: '86', digits: 11 },
  { code: 'CO', dial: '57', digits: 10 },
  { code: 'CR', dial: '506', digits: 8 },
  { code: 'CU', dial: '53', digits: 8 },
  { code: 'CV', dial: '238', digits: 7 },
  { code: 'CW', dial: '599', digits: 8 },
  { code: 'CX', dial: '61', digits: 9 },
  { code: 'CY', dial: '357', digits: 8 },
  { code: 'CZ', dial: '420', digits: 9 },
  { code: 'DE', dial: '49', digits: 11 },
  { code: 'DJ', dial: '253', digits: 8 },
  { code: 'DK', dial: '45', digits: 8 },
  { code: 'DM', dial: '1', digits: 10 },
  { code: 'DO', dial: '1', digits: 10 },
  { code: 'DZ', dial: '213', digits: 9 },
  { code: 'EC', dial: '593', digits: 9 },
  { code: 'EE', dial: '372', digits: 8 },
  { code: 'EG', dial: '20', digits: 10 },
  { code: 'EH', dial: '212', digits: 9 },
  { code: 'ER', dial: '291', digits: 7 },
  { code: 'ES', dial: '34', digits: 9 },
  { code: 'ET', dial: '251', digits: 9 },
  { code: 'FI', dial: '358', digits: 9 },
  { code: 'FJ', dial: '679', digits: 7 },
  { code: 'FK', dial: '500', digits: 5 },
  { code: 'FM', dial: '691', digits: 7 },
  { code: 'FO', dial: '298', digits: 6 },
  { code: 'FR', dial: '33', digits: 9 },
  { code: 'GA', dial: '241', digits: 8 },
  { code: 'GB', dial: '44', digits: 10 },
  { code: 'GD', dial: '1', digits: 10 },
  { code: 'GE', dial: '995', digits: 9 },
  { code: 'GF', dial: '594', digits: 9 },
  { code: 'GG', dial: '44', digits: 10 },
  { code: 'GH', dial: '233', digits: 9 },
  { code: 'GI', dial: '350', digits: 8 },
  { code: 'GL', dial: '299', digits: 6 },
  { code: 'GM', dial: '220', digits: 7 },
  { code: 'GN', dial: '224', digits: 9 },
  { code: 'GP', dial: '590', digits: 9 },
  { code: 'GQ', dial: '240', digits: 9 },
  { code: 'GR', dial: '30', digits: 10 },
  { code: 'GT', dial: '502', digits: 8 },
  { code: 'GU', dial: '1', digits: 10 },
  { code: 'GW', dial: '245', digits: 9 },
  { code: 'GY', dial: '592', digits: 7 },
  { code: 'HK', dial: '852', digits: 8 },
  { code: 'HN', dial: '504', digits: 8 },
  { code: 'HR', dial: '385', digits: 9 },
  { code: 'HT', dial: '509', digits: 8 },
  { code: 'HU', dial: '36', digits: 9 },
  { code: 'ID', dial: '62', digits: 9 },
  { code: 'IE', dial: '353', digits: 9 },
  { code: 'IL', dial: '972', digits: 9 },
  { code: 'IM', dial: '44', digits: 10 },
  { code: 'IN', dial: '91', digits: 10 },
  { code: 'IO', dial: '246', digits: 7 },
  { code: 'IQ', dial: '964', digits: 10 },
  { code: 'IR', dial: '98', digits: 10 },
  { code: 'IS', dial: '354', digits: 7 },
  { code: 'IT', dial: '39', digits: 10 },
  { code: 'JE', dial: '44', digits: 10 },
  { code: 'JM', dial: '1', digits: 10 },
  { code: 'JO', dial: '962', digits: 9 },
  { code: 'JP', dial: '81', digits: 10 },
  { code: 'KE', dial: '254', digits: 9 },
  { code: 'KG', dial: '996', digits: 9 },
  { code: 'KH', dial: '855', digits: 8 },
  { code: 'KI', dial: '686', digits: 8 },
  { code: 'KM', dial: '269', digits: 7 },
  { code: 'KN', dial: '1', digits: 10 },
  { code: 'KP', dial: '850', digits: 10 },
  { code: 'KR', dial: '82', digits: 10 },
  { code: 'KW', dial: '965', digits: 8 },
  { code: 'KY', dial: '1', digits: 10 },
  { code: 'KZ', dial: '7', digits: 10 },
  { code: 'LA', dial: '856', digits: 10 },
  { code: 'LB', dial: '961', digits: 8 },
  { code: 'LC', dial: '1', digits: 10 },
  { code: 'LI', dial: '423', digits: 9 },
  { code: 'LK', dial: '94', digits: 9 },
  { code: 'LR', dial: '231', digits: 9 },
  { code: 'LS', dial: '266', digits: 8 },
  { code: 'LT', dial: '370', digits: 8 },
  { code: 'LU', dial: '352', digits: 9 },
  { code: 'LV', dial: '371', digits: 8 },
  { code: 'LY', dial: '218', digits: 9 },
  { code: 'MA', dial: '212', digits: 9 },
  { code: 'MC', dial: '377', digits: 9 },
  { code: 'MD', dial: '373', digits: 8 },
  { code: 'ME', dial: '382', digits: 8 },
  { code: 'MF', dial: '590', digits: 9 },
  { code: 'MG', dial: '261', digits: 9 },
  { code: 'MH', dial: '692', digits: 7 },
  { code: 'MK', dial: '389', digits: 8 },
  { code: 'ML', dial: '223', digits: 8 },
  { code: 'MM', dial: '95', digits: 8 },
  { code: 'MN', dial: '976', digits: 8 },
  { code: 'MO', dial: '853', digits: 8 },
  { code: 'MP', dial: '1', digits: 10 },
  { code: 'MQ', dial: '596', digits: 9 },
  { code: 'MR', dial: '222', digits: 8 },
  { code: 'MS', dial: '1', digits: 10 },
  { code: 'MT', dial: '356', digits: 8 },
  { code: 'MU', dial: '230', digits: 8 },
  { code: 'MV', dial: '960', digits: 7 },
  { code: 'MW', dial: '265', digits: 9 },
  { code: 'MX', dial: '52', digits: 10 },
  { code: 'MY', dial: '60', digits: 9 },
  { code: 'MZ', dial: '258', digits: 9 },
  { code: 'NA', dial: '264', digits: 9 },
  { code: 'NC', dial: '687', digits: 6 },
  { code: 'NE', dial: '227', digits: 8 },
  { code: 'NF', dial: '672', digits: 6 },
  { code: 'NG', dial: '234', digits: 10 },
  { code: 'NI', dial: '505', digits: 8 },
  { code: 'NL', dial: '31', digits: 9 },
  { code: 'NO', dial: '47', digits: 8 },
  { code: 'NP', dial: '977', digits: 10 },
  { code: 'NR', dial: '674', digits: 7 },
  { code: 'NU', dial: '683', digits: 7 },
  { code: 'NZ', dial: '64', digits: 9 },
  { code: 'OM', dial: '968', digits: 8 },
  { code: 'PA', dial: '507', digits: 8 },
  { code: 'PE', dial: '51', digits: 9 },
  { code: 'PF', dial: '689', digits: 8 },
  { code: 'PG', dial: '675', digits: 8 },
  { code: 'PH', dial: '63', digits: 10 },
  { code: 'PK', dial: '92', digits: 10 },
  { code: 'PL', dial: '48', digits: 9 },
  { code: 'PM', dial: '508', digits: 6 },
  { code: 'PR', dial: '1', digits: 10 },
  { code: 'PS', dial: '970', digits: 9 },
  { code: 'PT', dial: '351', digits: 9 },
  { code: 'PW', dial: '680', digits: 7 },
  { code: 'PY', dial: '595', digits: 9 },
  { code: 'QA', dial: '974', digits: 8 },
  { code: 'RE', dial: '262', digits: 9 },
  { code: 'RO', dial: '40', digits: 9 },
  { code: 'RS', dial: '381', digits: 9 },
  { code: 'RU', dial: '7', digits: 10 },
  { code: 'RW', dial: '250', digits: 9 },
  { code: 'SA', dial: '966', digits: 9 },
  { code: 'SB', dial: '677', digits: 7 },
  { code: 'SC', dial: '248', digits: 7 },
  { code: 'SD', dial: '249', digits: 9 },
  { code: 'SE', dial: '46', digits: 9 },
  { code: 'SG', dial: '65', digits: 8 },
  { code: 'SH', dial: '290', digits: 5 },
  { code: 'SI', dial: '386', digits: 8 },
  { code: 'SJ', dial: '47', digits: 8 },
  { code: 'SK', dial: '421', digits: 9 },
  { code: 'SL', dial: '232', digits: 8 },
  { code: 'SM', dial: '378', digits: 8 },
  { code: 'SN', dial: '221', digits: 9 },
  { code: 'SO', dial: '252', digits: 8 },
  { code: 'SR', dial: '597', digits: 7 },
  { code: 'SS', dial: '211', digits: 9 },
  { code: 'ST', dial: '239', digits: 7 },
  { code: 'SV', dial: '503', digits: 8 },
  { code: 'SX', dial: '1', digits: 10 },
  { code: 'SY', dial: '963', digits: 9 },
  { code: 'SZ', dial: '268', digits: 8 },
  { code: 'TA', dial: '290', digits: 4 },
  { code: 'TC', dial: '1', digits: 10 },
  { code: 'TD', dial: '235', digits: 8 },
  { code: 'TG', dial: '228', digits: 8 },
  { code: 'TH', dial: '66', digits: 9 },
  { code: 'TJ', dial: '992', digits: 9 },
  { code: 'TK', dial: '690', digits: 4 },
  { code: 'TL', dial: '670', digits: 8 },
  { code: 'TM', dial: '993', digits: 8 },
  { code: 'TN', dial: '216', digits: 8 },
  { code: 'TO', dial: '676', digits: 7 },
  { code: 'TR', dial: '90', digits: 10 },
  { code: 'TT', dial: '1', digits: 10 },
  { code: 'TV', dial: '688', digits: 6 },
  { code: 'TW', dial: '886', digits: 9 },
  { code: 'TZ', dial: '255', digits: 9 },
  { code: 'UA', dial: '380', digits: 9 },
  { code: 'UG', dial: '256', digits: 9 },
  { code: 'US', dial: '1', digits: 10 },
  { code: 'UY', dial: '598', digits: 8 },
  { code: 'UZ', dial: '998', digits: 9 },
  { code: 'VA', dial: '39', digits: 10 },
  { code: 'VC', dial: '1', digits: 10 },
  { code: 'VE', dial: '58', digits: 10 },
  { code: 'VG', dial: '1', digits: 10 },
  { code: 'VI', dial: '1', digits: 10 },
  { code: 'VN', dial: '84', digits: 9 },
  { code: 'VU', dial: '678', digits: 7 },
  { code: 'WF', dial: '681', digits: 6 },
  { code: 'WS', dial: '685', digits: 7 },
  { code: 'XK', dial: '383', digits: 8 },
  { code: 'YE', dial: '967', digits: 9 },
  { code: 'YT', dial: '262', digits: 9 },
  { code: 'ZA', dial: '27', digits: 9 },
  { code: 'ZM', dial: '260', digits: 9 },
  { code: 'ZW', dial: '263', digits: 9 },
];

/** Lookup by ISO code. `undefined` for a code the table does not carry. */
export function dialCountry(code: string): DialCountry | undefined {
  return DIAL_COUNTRIES.find((country) => country.code === code);
}

/**
 * The flag, COMPUTED from the ISO code rather than served as an image.
 *
 * Two letters map to the two REGIONAL INDICATOR SYMBOLS at `U+1F1E6 + (letter - 'A')`, which the
 * platform draws as a flag. No asset, no request, and nothing for the CSP to allow — a sprite or a
 * CDN flag would need `img-src` widened on the one page where a stranger types their details.
 *
 * The honest caveat: Windows ships no flag glyphs, so Chrome and Firefox there render the two
 * letters — `SY` rather than 🇸🇾. That is legible and correctly identifies the country, which is why
 * it is an acceptable failure; the dial code and the country NAME are beside it either way and
 * neither depends on this.
 */
export function flagOf(code: string): string {
  const BASE = 0x1f1e6;
  const A = 'A'.charCodeAt(0);

  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((letter) => BASE + (letter.charCodeAt(0) - A)),
  );
}

/**
 * A dial code and whatever the customer typed, as the E.164 string the API validates.
 *
 * Returns `''` for an empty national number rather than a bare `+963`: the schema would accept
 * eight-plus digits and a lone calling code is not a phone number, so composing one would turn a
 * blank field into a plausible-looking wrong value.
 *
 * The leading zero is a TRUNK PREFIX — how a number is written for dialling INSIDE a country
 * (`0912…` in Syria, `0151…` in Germany) and never part of the international form. People copy the
 * number as it is written down, so dropping it here is the difference between a form that works
 * and a format error nobody can act on.
 */
export function toE164(dial: string, national: string): string {
  const digits = national.replace(/\D/g, '').replace(/^0+/, '');

  return digits ? `+${dial}${digits}` : '';
}
