/**
 * A property's official star CLASSIFICATION, drawn (Bashar, 2026-09-04).
 *
 * His requirement, and the reason this is in the shared package rather than written three times:
 * *"Use a clear visual star component rather than plain text. The visual representation should be
 * consistent across all three applications."* A convention drifts; a component cannot.
 *
 * ## It is not the guest review score, and the drawing has to say so
 *
 * `properties.rating` is the average a worker computes from reviews, and the customer card already
 * renders it as «★ 4.6» — a glyph and a decimal. This is a different fact: a fixed designation the
 * partner declares and SAFRA checks at approval. Two things on one card, both made of stars, is a
 * customer reading one number as the other.
 *
 * So the two are drawn differently on purpose. The review score stays a NUMBER beside a single
 * glyph, with its review count next to it. This is a ROW of five — a shape, not a value — and it
 * sits with the property TYPE, because that is what it classifies. It is the same separation
 * booking.com and expedia settled on, and for the same reason.
 *
 * ## Five slots, always, and the unfilled ones stay
 *
 * A hotel with three stars renders three gold and two faint, not three alone. Every card is then
 * the same width and comparison down a column of search results is a glance at how much gold there
 * is, rather than counting shapes of varying length. It also states the scale without a word of
 * copy: nobody has to be told it is out of five.
 *
 * ## Authored, not a glyph
 *
 * `★` is the operating system's drawing and arrives at a different weight, colour and baseline on
 * every platform — the same argument `share-button.tsx` and the flags already make. An inline path
 * is the product's own, inherits `currentColor`, and cannot be substituted by a font.
 *
 * ## Not mirrored, and it does not need to be
 *
 * Five identical shapes have no direction. The FILL order follows the DOM, and the DOM follows the
 * reading order, so on an Arabic screen the gold begins at the right edge without a single
 * direction-aware rule. Nothing here uses a physical `left` or `right`.
 *
 * ## The label is the caller's
 *
 * Required, never defaulted, for the reason `PasswordField` and `ImageSlider` both give: a sentence
 * living in a shared package is invisible to the task of adding a language. Each app passes its
 * own «فندق 4 نجوم» / "4-star hotel". The stars themselves are `aria-hidden` — a screen reader
 * gets the sentence, not ten path elements.
 */
export interface StarRatingProps {
  /** 1 to 5. A caller with `null` renders nothing at all — see `StarRating.tsx`'s note on absence. */
  readonly value: number;
  /**
   * What a screen reader hears, e.g. «فندق 4 نجوم». Required: no user-facing text lives here.
   */
  readonly label: string;
  /** `sm` for a card or a table row, `md` for a property page heading. */
  readonly size?: 'sm' | 'md';
  /**
   * Drawn INSIDE something that already names the rating — a `<label>` on a filter chip.
   *
   * The row then becomes `aria-hidden` rather than an image with its own label, because a screen
   * reader reaching a chip should hear «٤ نجوم» once, not the label and then the picture of it.
   * The `label` prop is still required: it is what the CALLER puts on the control, and making it
   * optional here would invite a chip with no accessible name at all.
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

/** 14px in a card, 18px beside a page heading. Two sizes, because three would be a decision. */
const SIZES = { sm: 14, md: 18 } as const;

export function StarRating({
  value,
  label,
  size = 'sm',
  decorative = false,
  className,
}: StarRatingProps) {
  /*
    Clamped, not trusted. The column has a CHECK and the schema has a bound, but this component is
    handed a number by four different screens across three apps — and `Array.from({ length: -1 })`
    throws while `{ length: 9 }` would silently draw nine stars in a five-star row. A display
    component that cannot be made to render nonsense is one fewer thing to verify per caller.
  */
  const filled = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <span
      /*
        `inline-flex` so it sits on the same line as the property type, and `align-middle` so the
        stars centre against the text rather than on its baseline — a star's visual mass is lower
        than a letter's, and left on the baseline the row reads as if it has slipped.
      */
      className={`inline-flex shrink-0 items-center gap-0.5 align-middle ${className ?? ''}`}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img' as const, 'aria-label': label })}
      data-star-rating={filled}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} lit={index < filled} px={SIZES[size]} />
      ))}
    </span>
  );
}

/**
 * One star.
 *
 * The unlit ones are drawn at 22% rather than hidden or outlined. An outline needs a stroke that
 * reads as a different SHAPE at 14px, and hiding them collapses the row's width — which is the one
 * property that makes a column of cards comparable at a glance.
 *
 * `text-gold` on both, with opacity doing the work, so the pair follows the theme together. The
 * light theme's gold is a darker value than the night theme's, and two separately declared colours
 * would need to be kept in step by hand.
 */
function Star({ lit, px }: { readonly lit: boolean; readonly px: number }) {
  return (
    <svg
      aria-hidden
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`text-gold ${lit ? '' : 'opacity-[0.22]'}`}
    >
      {/* A five-pointed star, drawn rather than borrowed. Points at the top, as a star is read. */}
      <path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.42l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.95L12 2.6z" />
    </svg>
  );
}
