import { getPartnerSession } from '@/lib/session-server';
import { getMyProperties, type PartnerProperty } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { fill, propertyStatus, t } from '@/lib/strings';

/**
 * عقاراتي (design handoff §7.2) — the listing cards.
 *
 * The add-property form the handoff also specifies is a separate piece of work: it posts to
 * `POST /partner/properties`, carries the trip-traits chip group and three image slots, and each
 * of those is its own decision. The cards come first because they are the half a partner reads
 * every day.
 *
 * Every listing shown belongs to the signed-in partner because the API scopes the query to the
 * `partnerId` in the verified token — not because this page filters anything.
 */
export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const session = await getPartnerSession();
  const properties = await getMyProperties();
  const name = session?.user.email ?? '';

  return (
    <Shell title={t.properties.title} partnerName={name} active="properties">
      {properties === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : properties === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : properties.length === 0 ? (
        <p className="text-sm text-faint">{t.properties.empty}</p>
      ) : (
        <>
          <p className="mb-3 text-[12.5px] text-faint">
            {fill(t.properties.count, { n: properties.length })} · {t.properties.note}
          </p>

          <ul className="grid gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
            {properties.map((property) => (
              <li key={property.reference}>
                <Card property={property} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}

function Card({ property }: { readonly property: PartnerProperty }) {
  return (
    <article className="flex h-full flex-col rounded-[14px] border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-[14px] font-bold text-text">{property.nameAr}</h2>
        <span className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[10.5px] font-bold text-muted">
          {propertyStatus(property.status)}
        </span>
      </div>

      {/*
        The handoff's card also carries a photo, the trait chips and a nightly price. None of the
        three is in `GET /partner/properties` — it returns no units and no images — so they are
        absent rather than invented. Adding them is an API change, not a layout one.
      */}
      <p className="mt-1 text-[11.5px] text-faint">
        <Ltr>{property.reference}</Ltr>
      </p>

      {property.rating ? (
        <p className="mt-2 text-[12.5px] font-bold text-gold">
          ★ {property.rating}{' '}
          <span className="font-normal text-faint">
            {fill(t.properties.reviews, { n: property.reviewsCount })}
          </span>
        </p>
      ) : null}
    </article>
  );
}
