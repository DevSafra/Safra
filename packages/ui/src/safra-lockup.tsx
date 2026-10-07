import type { CSSProperties } from 'react';

import { SafraLogo } from './safra-logo.js';

/**
 * SAFRA's logo as the platform shows it everywhere (Bashar, 2026-10-07): his pin, his drawn «سفرة»,
 * a «|» and «SAFRA», all in the gold of the home page's service drawings.
 *
 * Settled on the customer navbar over a morning of review and then rolled out unchanged:
 *
 * - the gold is the drawings' own (`GOLD` in apps/web/src/components/service-icons.tsx), lit top
 *   to bottom; change them together;
 * - the pin takes all three stops; the lettering, the divider and «SAFRA» take the amber without
 *   the pale top, which vanishes from thin strokes on a white bar;
 * - no outline (he had it removed), and the divider is the name's colour, not a grey.
 *
 * ## Self-contained on purpose
 *
 * The colours and the layout are written here, inline, not in an app's stylesheet. It is drawn by
 * three apps and by a root 404 that loads no CSS at all, and one copy of the rules is the only
 * way the four cannot drift. His artwork paints with `var(--color-gold)`, so each drawn part is
 * pointed at a gradient by setting that variable on it; the artwork itself is untouched.
 *
 * The gradients carry fixed ids. A page that shows the lockup twice (header and footer) renders
 * two identical definitions under one id, which resolves to the same paint either way.
 *
 * `latin` is the caller's, from its catalogue, like every word in a shared component.
 */
const GOLD = {
  light: '#fbe3a6',
  mid: '#e6b04a',
  deep: '#b07a22',
  letterTop: '#eebd55',
  /* The middle of the lettering's run, for paper: see `print`. */
  letterSolid: '#cf9b3a',
} as const;

/* A sans face where no app font class arrives: the voucher and the contract, and the bare 404. */
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

const METAL = 'safra-lockup-metal';
const LETTER = 'safra-lockup-letter';

const SIZES = {
  /* The navbar and the footer: a 34px pin beside the name, the lockup's own proportion. */
  inline: { symbol: 34, wordmark: 21, latin: 20, gap: 10, inner: 8 },
  /* Sign-in, invitations, error pages: the pin above the name, centred. */
  stacked: { symbol: 64, wordmark: 30, latin: 28, gap: 14, inner: 10 },
} as const;

const goldText: CSSProperties = {
  backgroundImage: `linear-gradient(180deg, ${GOLD.letterTop}, ${GOLD.deep})`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  fontWeight: 700,
  lineHeight: 1,
};

export function SafraLockup({
  latin,
  layout = 'inline',
  label,
  className,
  latinClassName,
  print = false,
}: {
  /** «SAFRA», from the caller's catalogue. */
  readonly latin: string;
  readonly layout?: 'inline' | 'stacked';
  /** An accessible name, or nothing when the surrounding link or heading already names it. */
  readonly label?: string;
  readonly className?: string;
  /**
   * Classes for the «| SAFRA» half: its display and its font. The navbar hides it on a phone
   * («hidden sm:inline-flex»), which inline styles cannot say, so when this is given the half
   * takes its display from these classes alone.
   */
  readonly latinClassName?: string;
  /**
   * For a PDF. Chromium's print path does not reliably clip a gradient to text, and on the contract
   * it left a gold strip under «| SAFRA»; on paper the latin half is one solid gold, the middle of
   * the same run. The drawn parts keep their gradient, which prints exactly.
   */
  readonly print?: boolean;
}) {
  const size = SIZES[layout];
  const latinStyle: CSSProperties = print
    ? { color: GOLD.letterSolid, fontWeight: 700, lineHeight: 1 }
    : goldText;

  return (
    <span
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      style={{
        display: 'inline-flex',
        flexDirection: layout === 'stacked' ? 'column' : 'row',
        alignItems: 'center',
        gap: size.gap,
      }}
    >
      <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id={METAL} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GOLD.light} />
            <stop offset="0.45" stopColor={GOLD.mid} />
            <stop offset="1" stopColor={GOLD.deep} />
          </linearGradient>
          <linearGradient id={LETTER} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GOLD.letterTop} />
            <stop offset="1" stopColor={GOLD.deep} />
          </linearGradient>
        </defs>
      </svg>

      <SafraLogo
        variant="symbol"
        height={size.symbol}
        title=""
        style={{ ['--color-gold' as string]: `url(#${METAL})`, flexShrink: 0 }}
      />

      <span style={{ display: 'inline-flex', alignItems: 'center', gap: size.inner }}>
        <SafraLogo
          variant="wordmark"
          height={size.wordmark}
          title=""
          style={{ ['--color-gold' as string]: `url(#${LETTER})` }}
        />
        <span
          className={latinClassName}
          style={{
            ...(latinClassName ? {} : { display: 'inline-flex', fontFamily: SANS }),
            alignItems: 'center',
            gap: size.inner,
          }}
        >
          <span style={{ ...latinStyle, fontSize: size.latin }}>|</span>
          <span style={{ ...latinStyle, fontSize: size.latin }}>{latin}</span>
        </span>
      </span>
    </span>
  );
}
