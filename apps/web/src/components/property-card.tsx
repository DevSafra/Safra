import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@/i18n/routing';
import type { SearchResultItem } from '@/lib/api';
import { formatMoney } from '@/lib/localise';
import { dynamicMessage } from '@/lib/dynamic-message';

/**
 * A search result card (§5.5, §5.6).
 *
 * Shows the nightly rate AND the stay total, because the total is what the
 * customer actually pays and per-night pricing hides multi-night arithmetic. The
 * service fee is called out separately rather than folded in, so the price is not
 * misleading at the point of comparison.
 */
export async function PropertyCard({
  item,
  locale,
}: {
  item: SearchResultItem;
  locale: Locale;
}) {
  const t = await getTranslations('property');
  const tt = await getTranslations('propertyTypes');

  const name = locale === 'ar' ? item.nameAr : item.nameEn || item.nameAr;

  return (
    <article className="flex h-full flex-col rounded-card border border-line bg-card p-5 transition-colors hover:border-gold/60">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg text-text">
          {/* The whole card is not a link: the heading is, so screen readers get one
              clear target instead of a wall of duplicated link text. */}
          <Link href={`/${locale}/property/${item.slug}`} className="hover:text-gold">
            {name}
          </Link>
        </h3>
        {item.rating ? (
          <span className="shrink-0 rounded-lg border border-line bg-field px-2 py-1 text-sm text-gold">
            ★ {item.rating}
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-sm text-faint">
        {dynamicMessage(tt, item.propertyTypeCode, item.propertyTypeCode)} ·{' '}
        {locale === 'ar' ? item.cityNameAr : item.citySlug}
      </p>

      {/* Trust badges (§5.6). Awarded by SAFRA, never set by the partner. */}
      {item.badges.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
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
        <p className="mt-2 text-xs text-faint">
          {t('reviews', { count: item.reviewsCount })}
        </p>
      ) : null}

      <div className="mt-auto pt-5">
        <div className="gold-rule mb-4" />
        <p className="text-lg text-text">
          <span className="font-semibold text-gold">
            {formatMoney(item.nightlyFrom, item.currencyCode, locale)}
          </span>{' '}
          <span className="text-sm text-faint">{t('perNight')}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          {formatMoney(item.stayTotal, item.currencyCode, locale)}{' '}
          {t('totalFor', { nights: item.nights })}
        </p>
        <p className="mt-1 text-xs text-faint">{t('serviceFee')}</p>
      </div>
    </article>
  );
}
