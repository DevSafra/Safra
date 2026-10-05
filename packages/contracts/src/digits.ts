/**
 * Arabic-Indic and Persian digits as ASCII, and the Arabic decimal mark as a point.
 *
 * The console is Arabic and its keyboard types «٢٠» and «٤٥٠٫٥». Every numeric field a person types
 * into goes through this before it is checked, because `Number('٢٠')` is NaN and a regex `\d`
 * without the u flag matches ASCII only (audit 2026-10-04): seats typed in Arabic were saved as «no
 * limit», an FAQ position as 0, and a trip's price and dates were refused with an error naming no
 * field.
 */
export function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.');
}
