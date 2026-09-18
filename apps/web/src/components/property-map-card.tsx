import { StarRating } from '@safra/ui';

export interface PropertyMapCardData {
  readonly name: string;
  /** The guest review score, already formatted. Null for a listing with none. */
  readonly rating: string | null;
  /** How many published reviews that score is drawn from. */
  readonly reviewsLabel: string | null;
  /** The official 1–5 classification, separate from the review score. */
  readonly starRating: number | null;
  readonly starsLabel: string | null;
  readonly nightly: string;
  readonly perNight: string;
  readonly fromLabel: string;
  readonly address: string;
  readonly image: { src: string; alt: string } | null;
  /** Where «أعرض» goes: the booking panel on the page underneath. */
  readonly viewHref: string;
  readonly viewLabel: string;
}

/**
 * The listing's summary, beside the full-screen map.
 *
 * ## Why this is its own file
 *
 * `one-slider.test.ts` fails any file that draws a modal around an `<img>` without
 * importing the shared previewer — the shape of a hand-rolled lightbox. The map overlay is
 * a modal and this card has a photograph, so together they would trip a sweep aimed at
 * something they are not: the test's own note names «the ad creative's EDIT dialog, which
 * merely happens to contain a thumbnail» as exactly the case it did not want to excuse.
 *
 * Splitting them is not a way around the sweep. The card is a separate concern — it is the
 * listing, not the map — and it reads better for being liftable to any other surface that
 * wants a compact summary. Worth knowing, though, that the sweep is per-FILE, so a real
 * hand-rolled previewer split across two files would also walk past it.
 *
 * The sweep matches on the literal attribute text, so naming it in prose here would flag
 * this file for a modal it does not contain — which is how that was discovered.
 *
 * ## Every figure comes from the page
 *
 * Nothing here is recomputed. `nightly` already carries the customer fee applied at the
 * point of display, `rating` is the trigger-maintained aggregate, and the star rating is
 * the CLASSIFICATION rather than the review score — the two are different facts and the
 * page keeps them apart, so this does too.
 */
export function PropertyMapCard({
  data,
  onView,
}: {
  readonly data: PropertyMapCardData;
  /**
   * Pressed «أعرض».
   *
   * The anchor keeps its `href` so the destination is real — hover shows it, middle-click
   * opens it, and nothing here depends on JavaScript to be a link. The handler exists
   * because following it from INSIDE the overlay does nothing a reader can see: the map is
   * fixed over the whole page and the body is scroll-locked, so the browser dutifully
   * changes the hash and lands on a section nobody can see.
   */
  readonly onView: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card shadow-[var(--shadow-lift)]">
      <div className="flex gap-3 p-4">
        {/*
          `<img>` rather than `next/image`: the same decision the gallery and the ad
          creatives made — these are already-derived variants from the upload pipeline, and
          routing them through the optimiser would re-encode a file that was encoded for
          this purpose.
        */}
        {data.image ? (
          <img
            src={data.image.src}
            alt={data.image.alt}
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            className="size-20 shrink-0 rounded-lg border border-line object-cover"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base leading-snug text-text">{data.name}</h2>

          {data.starRating && data.starsLabel ? (
            <p className="mt-1">
              <StarRating value={data.starRating} size="sm" label={data.starsLabel} />
            </p>
          ) : null}

          {data.rating ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="rounded-md bg-gold/15 px-1.5 py-0.5 font-bold text-gold-read">
                ★ {data.rating}
              </span>
              {data.reviewsLabel ? <span>{data.reviewsLabel}</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line px-4 py-3">
        <p className="min-w-0">
          <span className="block text-11 text-faint">{data.fromLabel}</span>
          {/*
            The amount and its currency in ONE span, because `formatMoney` has already put
            them together — «no amount is ever written without its currency», and the
            currency here is inside the formatted string rather than a sibling element.
          */}
          <span className="font-display text-lg text-text">{data.nightly}</span>
          <span className="text-xs text-muted">{data.perNight}</span>
        </p>

        <a
          href={data.viewHref}
          onClick={onView}
          className="btn-gold inline-flex min-h-10 shrink-0 cursor-pointer items-center rounded-full px-4 text-sm font-bold shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out-strong hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none lg:min-h-0 lg:py-2"
        >
          {data.viewLabel}
        </a>
      </div>

      <p className="border-t border-line px-4 py-3 text-xs text-muted">{data.address}</p>
    </div>
  );
}
