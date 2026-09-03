import { getTranslations } from 'next-intl/server';

import { getCityAds } from '@/lib/api';

/**
 * «إعلان شريك» — paid placements from businesses in the city the customer booked in (§9.3).
 *
 * ## Labelled, separate, and never in a ranking
 *
 * The SRS promise is that advertising is «موسومة دائماً «إعلان شريك» ولا تُخلط بترتيب البحث
 * الطبيعي», and this component is where a reader meets that promise. It is a block of its own with
 * its own heading, every card carries the label, and it renders only on screens that are ALREADY
 * about one booking or one city — never inside a result list, where the separation would be a
 * matter of styling rather than of structure.
 *
 * There is no ordering here, no score and no boost: the API returns at most three, oldest campaign
 * first, and this renders them in the order it was given. A component that sorted them would be the
 * mechanism the promise exists to rule out.
 *
 * ## Every link goes through SAFRA — and through THIS app
 *
 * The href is this app's own click route, not the advertiser's URL and not `DeliveredAd.clickPath`.
 * That field is the API's path on the API's origin, which the customer's browser never reaches:
 * every call this app makes goes through a route handler and there is no rewrite. Rendering it
 * verbatim produced a link to a route that does not exist here — invisible to every HTTP-level
 * check, and obvious the moment somebody clicks.
 *
 * `rel="nofollow sponsored noopener noreferrer"` is the search-engine and browser half of the same
 * statement: a paid link is declared as one, and the advertiser's page gets no handle on the tab it
 * was opened from. A plain `<a>` rather than `<Link>`, deliberately — `<Link>` prefetches, and a
 * prefetched click is a click nobody made.
 *
 * ## The creative comes through the platform's own pipeline
 *
 * This used to render text only, because the column behind it was a free-text `image_path` nobody
 * validated — the first thing to write it would have decided what SAFRA's pages fetch. Staff now
 * upload through the SAME pipeline as every listing photograph: the magic bytes are checked before
 * a byte is stored, a worker decodes and re-encodes (destroying polyglot files and stripping EXIF),
 * and `imageUrl` is set only once that has finished. So what a customer is served is always
 * something this platform produced, never something somebody uploaded.
 *
 * A campaign without one is still a complete ad — a headline and an advertiser name — so the card
 * simply has no picture rather than a placeholder.
 *
 * ## An empty slate renders nothing
 *
 * Not an empty box with a heading. Most cities have no live campaign at any given moment, and a
 * section announcing that there is nothing to announce is worse than silence.
 */
export async function PartnerAds({
  citySlug,
  locale,
}: {
  readonly citySlug: string;
  readonly locale: string;
}) {
  const ads = await getCityAds(citySlug, locale);

  if (ads.length === 0) return null;

  const t = await getTranslations('ads');

  return (
    <section className="mt-10" aria-label={t('title')}>
      <h2 className="font-display text-lg font-bold text-gold">{t('title')}</h2>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ads.map((ad) => (
          <li
            key={ad.reference}
            className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-card p-4"
          >
            {/*
              The label FIRST, above the headline.

              Below it, a reader who stops after the first line has read an advertisement without
              being told it was one — and that first line is the half designed to be read.
            */}
            <span className="w-fit rounded-full border border-gold/40 px-2 py-0.5 text-[11px] font-semibold text-gold-ink">
              {t('label')}
            </span>

            {ad.imageUrl ? (
              /*
                `alt=""` — the headline directly beneath says the same thing, and a screen reader
                announcing it twice is worse than not announcing the picture at all. `loading="lazy"`
                because an advertisement must never delay the booking the reader came for.
              */
              <img
                src={ad.imageUrl}
                alt=""
                loading="lazy"
                className="aspect-[3/2] w-full rounded-lg border border-line object-cover"
              />
            ) : null}

            <p className="text-sm font-semibold text-text">{ad.headline}</p>

            {/*
              The description, when the campaign has one (Bashar, 2026-08-31). Between the headline
              and the advertiser, which is where a reader looks for what the ad is actually about —
              and absent entirely when there is none, rather than an empty line holding space.
            */}
            {ad.description ? (
              <p className="text-xs leading-relaxed text-text2">{ad.description}</p>
            ) : null}

            <p className="text-xs text-muted">{ad.advertiser}</p>

            <a
              href={`/${locale}/api/ads/${encodeURIComponent(ad.reference)}/click`}
              rel="nofollow sponsored noopener noreferrer"
              target="_blank"
              className="mt-auto inline-flex min-h-10 w-fit items-center text-xs font-semibold text-gold-ink hover:underline lg:min-h-0"
            >
              {t('visit')}
            </a>
          </li>
        ))}
      </ul>

      {/*
        Said out loud rather than left to the label.

        «لا تؤثر على ترتيب نتائج البحث» is the part a customer cannot verify by looking, and it is
        the whole reason the platform can carry advertising without the search results becoming
        untrustworthy. It costs one line.
      */}
      <p className="mt-3 text-xs text-faint">{t('note')}</p>
    </section>
  );
}
