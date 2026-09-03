import type { Locale } from '@/i18n/routing';

/**
 * A flag per language, drawn rather than typed.
 *
 * ## Why not the emoji
 *
 * 🇸🇾 is two regional-indicator letters, and whether they become a flag is the operating system's
 * decision: macOS and iOS draw one, Windows draws the letters «SY» in a box, and several Android
 * builds draw a third thing. A control whose entire content is a picture cannot be a picture on
 * some machines and two letters on others.
 *
 * ## Where the artwork comes from
 *
 * Syria's is lifted verbatim from `SAFRA - موقع سفرة 20.08.html`, which embeds it as a data URI —
 * so the one flag the approved design actually specifies is the approved one. The other two are
 * authored in the same flat style and the same 30×20 box, because three flags at three aspect
 * ratios in one row is a row that looks broken.
 *
 * 30×20 is 3:2, which is Germany's real ratio and not Syria's (2:3… 2:1 for the UK). Flags in a
 * UI are chips rather than flags: a consistent box is what lets them sit in a row, and the
 * alternative is three different widths for three items in one menu.
 *
 * ## And a flag is not a language
 *
 * Arabic is not Syria — a reader in Amman or Beirut is choosing a LANGUAGE and being shown a
 * country. The approved design makes that trade and the primary launch market is Syria, so this
 * follows it; the endonym «العربية» is always beside the flag, and it is the endonym that names
 * the choice. Worth revisiting if the Jordanian and Lebanese markets grow.
 */
export function Flag({ locale, className = '' }: { locale: Locale; className?: string }) {
  const Drawn = FLAGS[locale];

  return (
    <span
      aria-hidden
      className={`inline-block overflow-hidden rounded-[3px] leading-none ring-1 ring-black/10 ${className}`}
    >
      <Drawn />
    </span>
  );
}

/** Green over white over black, with the three red stars — verbatim from the prototype. */
function SyriaFlag() {
  return (
    <svg viewBox="0 0 30 20" className="block size-full">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#007A3D" />
      <rect y="13.33" width="30" height="6.67" fill="#000" />
      <polygon
        fill="#CE1126"
        points="7.5,7.8 8.02,9.32 9.59,9.32 8.35,10.26 8.79,11.78 7.5,10.85 6.21,11.78 6.65,10.26 5.41,9.32 6.98,9.32"
      />
      <polygon
        fill="#CE1126"
        points="15,7.8 15.52,9.32 17.09,9.32 15.85,10.26 16.29,11.78 15,10.85 13.71,11.78 14.15,10.26 12.91,9.32 14.48,9.32"
      />
      <polygon
        fill="#CE1126"
        points="22.5,7.8 23.02,9.32 24.59,9.32 23.35,10.26 23.79,11.78 22.5,10.85 21.21,11.78 21.65,10.26 20.41,9.32 21.98,9.32"
      />
    </svg>
  );
}

/**
 * The Union Jack.
 *
 * Built from strokes rather than polygons: a white saltire under a red one, then a white cross
 * under a red one, in that order, which is how the flag is actually layered.
 *
 * The red saltire is CENTRED on the white rather than counterchanged — the real flag offsets each
 * red arm to one side of the diagonal. At the ~20px this renders at, the offset is a third of a
 * pixel; drawing it properly would take eight clipped polygons to express something no reader can
 * see. Noted rather than silently approximated.
 */
function UnitedKingdomFlag() {
  return (
    <svg viewBox="0 0 30 20" className="block size-full">
      <rect width="30" height="20" fill="#012169" />
      <path d="M0 0 L30 20 M30 0 L0 20" stroke="#fff" strokeWidth="4.4" />
      <path d="M0 0 L30 20 M30 0 L0 20" stroke="#C8102E" strokeWidth="1.8" />
      <path d="M15 0 V20 M0 10 H30" stroke="#fff" strokeWidth="6.6" />
      <path d="M15 0 V20 M0 10 H30" stroke="#C8102E" strokeWidth="4" />
    </svg>
  );
}

/** Black over red over gold. */
function GermanyFlag() {
  return (
    <svg viewBox="0 0 30 20" className="block size-full">
      <rect width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.66" fill="#DD0000" />
      <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
    </svg>
  );
}

const FLAGS: Record<Locale, () => React.JSX.Element> = {
  ar: SyriaFlag,
  en: UnitedKingdomFlag,
  de: GermanyFlag,
};
