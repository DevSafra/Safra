import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import type { SearchResultItem } from '@/lib/api';
import { OrnamentField } from '@/components/ornament';
import { localisedName, localisedText } from '@/lib/localise';
import { imageUrl } from '@/lib/property';
import { getCurrencyCatalogue } from '@/lib/catalog';
import { convertForDisplay, displayCurrency } from '@/lib/currency';
import { dynamicMessage } from '@/lib/dynamic-message';
import { StarRating } from '@safra/ui';

/**
 * A search result card (§5.5, §5.6).
 *
 * ## It leads with the photograph (Bashar, 2026-09-02: «the items here look very bad»)
 *
 * It was type only — a name, a type, a city, a rating and two prices — which is survivable in a
 * grid of results and is not in a SLIDER beside a row of photographs. Three faults compounded: no
 * visual anchor at all, a `mt-auto` that stretched a hole through the middle of every card once
 * they were 336px wide, and the SAME price printed twice on a one-night search («$US 100 /
 * الليلة» over «$US 100 لليلة واحدة»), which reads as a rendering fault rather than as a total.
 *
 * The projection now carries a cover — see the note on the outer select in `search.service.ts` for
 * why that costs one index probe per RETURNED row rather than one per matching property. A listing
 * with no photograph gets the ornament, the same surface a city with none gets, rather than a grey
 * box that reads as a page that failed to load.
 *
 * Shows the nightly rate, and the stay total WHEN THAT SAYS SOMETHING ELSE — the total is what the
 * customer actually pays and per-night pricing hides multi-night arithmetic, but on a one-night
 * search the two lines are the same figure.
 *
 * **No service fee line** (Bashar, 2026-09-03). It said «+ رسوم خدمة سفرة» under every price, on a
 * surface whose whole job is comparison, where it is a constant that changes no comparison — and
 * every card carried it, so twenty cards said it twenty times. It is still stated at checkout,
 * where it is part of a figure somebody is about to be charged.
 *
 * ## Prices convert here, and say when they have
 *
 * A card exists to be COMPARED against other cards, which is exactly the job a reader should not
 * have to do currency arithmetic for. So it renders in whatever the visitor picked in the footer,
 * when a rate exists to get there.
 *
 * The original is printed underneath whenever it did convert. That line is not decoration: a
 * converted figure is an estimate from one rate a staff member typed, and a reader who books this
 * will be charged the amount in the listing's own currency. Checkout never converts.
 */
export async function PropertyCard({
  item,
  locale,
  stay,
}: {
  item: SearchResultItem;
  locale: Locale;
  /**
   * The party and the dates the reader searched for, as a ready-made `?…` string.
   *
   * Passed in rather than assembled here, and that is the security half of it: a card that read
   * the current URL would reflect whatever a crafted link happened to carry into an anchor on our
   * own page. The caller builds it from values it has already parsed and clamped — the same
   * reasoning `returnQuery` records on the console.
   *
   * Without it the search's party was simply LOST here. The property page then fell back to two
   * adults and no children, so a family of four reached checkout as a party of two and the
   * occupancy check ran against the wrong number — §5.2, found by the SRS audit on 2026-08-25.
   */
  stay?: string | undefined;
}) {
  const t = await getTranslations('property');
  const tt = await getTranslations('propertyTypes');
  const ts = await getTranslations('starRating');
  const common = await getTranslations('common');

  /*
    Both reads are cached and request-deduplicated, so a page of twenty cards makes one of each
    rather than twenty. `displayCurrency` reads a cookie, which these pages already are dynamic for.
  */
  const [{ rates }, target] = await Promise.all([
    getCurrencyCatalogue(),
    displayCurrency(),
  ]);

  const nightly = convertForDisplay(
    item.nightlyFrom,
    item.currencyCode,
    locale,
    target,
    rates,
  );
  const total = convertForDisplay(
    item.stayTotal,
    item.currencyCode,
    locale,
    target,
    rates,
  );

  /*
    `localisedName`, not a locale ternary. The old `locale === 'ar' ? nameAr : nameEn || nameAr`
    answered ENGLISH to a German reader on the busiest screen in the app.
  */
  const name = localisedName(item, locale);
  /*
    And the city was worse: it printed `item.citySlug` — «damascus» — to anybody not reading Arabic,
    because the search projection sent no city name in their language at all.
  */
  const city = localisedName(
    { nameAr: item.cityNameAr, nameEn: item.cityNameEn, nameDe: item.cityNameDe },
    locale,
  );

  return (
    <article className="group relative flex h-full w-full flex-col overflow-hidden rounded-card border border-line bg-card transition-colors hover:border-gold/60">
      <div className="relative aspect-[3/2] shrink-0 overflow-hidden bg-band">
        {item.cover ? (
          <picture>
            <source srcSet={imageUrl(item.cover, 600, 'avif')} type="image/avif" />
            <source srcSet={imageUrl(item.cover, 600, 'webp')} type="image/webp" />
            <img
              src={imageUrl(item.cover, 600, 'webp')}
              /*
                Empty where the partner wrote none: the property's NAME is the next element in the
                reading order, so a screen reader that also announced the picture would hear the
                listing twice. Where alt text exists it is used, because then it says something the
                name does not.
              */
              alt={localisedText(item.cover.alt, locale)}
              className="size-full object-cover transition-transform duration-500 ease-out-strong group-hover:scale-[1.04]"
              loading="lazy"
            />
          </picture>
        ) : (
          <OrnamentField
            id={`ornament-property-${item.propertyReference}`}
            className="text-gold opacity-30"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[14.5px] font-bold text-text">
            {/*
              The WHOLE CARD is the target, and there is still only one link (Bashar, 2026-09-02).

              Those two things are usually in tension: wrapping the card in an anchor makes the
              rating, the badges and the price part of the link's accessible name, so a screen
              reader announces «اختبار 4.8 موثّق من سفرة 5 تقييمات 65 دولار…» as the name of one
              control. Putting an anchor on each of them instead gives four links to the same
              place.

              `after:absolute after:inset-0` is the third answer: the anchor keeps its own short
              name in the accessibility tree, and its pseudo-element is stretched over the card so
              a press anywhere inside lands on it. The card is `relative` so that box is the
              card's, and `after:content-['']` because a pseudo-element with no content is not
              rendered at all.

              `min-h-10` below `lg` stays even though the hit area is now the whole card: the
              anchor is what a keyboard focuses and what its focus ring is drawn around, and a
              21px ring on a 300px card reads as focus landing on nothing.
            */}
            <Link
              href={`/${locale}/property/${item.slug}${stay ?? ''}`}
              className="inline-flex min-h-10 items-center after:absolute after:inset-0 after:content-[''] lg:min-h-0"
            >
              {name}
            </Link>
          </h3>
          {item.rating ? (
            <span className="shrink-0 text-[13px] font-bold text-gold">
              ★ {item.rating}
            </span>
          ) : null}
        </div>

        {/*
          12.5px and MUTED, not 11px faint (Bashar, 2026-09-03: «too light or small»). These lines
          are the card's only facts — what kind of place it is, where it is, how many people have
          stayed — and they were set at the size the design reserves for a footnote. `--faint` is
          the quietest step in the ladder and was doing the second-quietest one's work.
        */}
        {/*
          ── The star CLASSIFICATION, on the TYPE line ──────────────────────────

          Deliberately here and not beside «★ 4.6» above. That figure is the guest REVIEW score, and
          two star-shaped things on one card is a customer reading an opinion as a classification.
          A classification belongs with what it classifies, so «فندق ★★★★☆ · دمشق» reads as one
          fact about the building and the review score keeps its own corner with its own count.

          Absent when it is null. 2,703 listings predate the field and inventing «١ نجمة» for a
          hotel nobody has classified would be a claim, not a blank.
        */}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted">
          <span>{dynamicMessage(tt, item.propertyTypeCode, item.propertyTypeCode)}</span>
          {item.starRating ? (
            <StarRating
              value={item.starRating}
              label={ts('stars', { count: item.starRating })}
            />
          ) : null}
          <span>· {city}</span>
        </p>

        {/* Trust badges (§5.6). Awarded by SAFRA, never set by the partner. */}
        {item.badges.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {item.badges.map((badge) => (
              <li
                key={badge}
                className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs text-gold"
              >
                {badge === 'safra_verified' ? t('badgeVerified') : t('badgeRecommends')}
              </li>
            ))}
          </ul>
        ) : null}

        {item.reviewsCount > 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">
            {t('reviews', { count: item.reviewsCount })}
          </p>
        ) : null}

        {/*
          A dotted rule between the facts and the money (Bashar, 2026-09-03, with the reference).
          The price is the one line on the card a person compares against every other card, and it
          was sharing an edgeless column with the type, the city and the review count. A dotted rule
          separates without adding a second box: the card already has one border and does not need
          an interior one.

          **Two elements, and the outer one is why.** The dots are `border-t-2`, not `border-t`: at
          1px they were a hairline nobody could see was dotted (Bashar: «the points should be
          bigger»). And the gap above them is `pt-5` on an OUTER box rather than a margin on this
          one, because `mt-auto` is what pushes the money to the foot of a stretched card and a
          second margin-top would fight it — where a card is not stretched, `auto` resolves to zero
          and the rule sat against «تقييم واحد». Padding on a wrapper is a floor `auto` cannot eat.
        */}
        <div className="mt-auto pt-5">
          <div className="border-t-2 border-dotted border-line pt-4">
            <p className="text-base text-text">
              <span className="text-[18px] font-bold text-gold">{nightly.text}</span>{' '}
              <span className="text-[12.5px] text-muted">{t('perNight')}</span>
            </p>
            {/*
          The total, only when it says something the line above does not. On a one-night search the
          two are the same figure, and «$US 100 / الليلة» over «$US 100 لليلة واحدة» reads as the
          card having printed the price twice by mistake.
        */}
            {item.nights > 1 ? (
              <p className="mt-0.5 text-xs text-muted">
                {total.text} {t('totalFor', { nights: item.nights })}
              </p>
            ) : null}
            {/* Said once per card, under the total — the figure a booking is actually made against. */}
            {total.converted ? (
              <p className="mt-0.5 text-[12px] text-muted">
                {common('convertedFrom', { amount: total.original })}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
