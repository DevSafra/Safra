import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getProperty } from '@/lib/api';
import { ReviewProperty } from '@/components/review-property';

/**
 * One listing, and the decision to publish it (SRS §8.1, P-002).
 *
 * "Trust before volume" is enforced here or nowhere: approving is what puts a
 * property in front of paying customers, and it is the last human step before search
 * can return it.
 */
export const dynamic = 'force-dynamic';

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const property = await getProperty(reference);

  if (property === 'unauthenticated') {
    return (
      <Shell>
        <p className="text-sm text-muted">Your session expired. Sign in again.</p>
      </Shell>
    );
  }

  if (property === 'failed') notFound();

  const partnerVerified = property.partner.verification === 'approved';
  const reviewable = property.status === 'pending_review';

  return (
    <Shell>
      <header>
        <p className="text-xs text-faint">{property.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">
          {property.nameEn ?? property.nameAr}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {property.propertyType.code} · {property.city.nameEn ?? property.city.nameAr} ·{' '}
          {property.status.replace(/_/g, ' ')}
        </p>
      </header>

      {/*
        The partner's state, first and prominent. Item 116 refuses to publish a
        listing whose partner is unverified, so a reviewer who reads this last has
        already wasted their time on the rest of the page.
      */}
      <section
        className={`rounded-lg border p-4 ${
          partnerVerified ? 'border-line bg-card' : 'border-gold/30 bg-gold/5'
        }`}
      >
        <p className="text-sm text-text">{property.partner.legalName}</p>
        <p className="mt-0.5 text-xs text-faint">
          Trading as {property.partner.displayName} · {property.partner.reference}
        </p>
        {partnerVerified ? (
          <p className="mt-2 text-xs text-good">Partner is verified.</p>
        ) : (
          <p className="mt-2 text-xs text-gold">
            Partner is {property.partner.verification}. This listing cannot be published
            until they are verified —{' '}
            <Link
              href={`/partners/${property.partner.reference}`}
              className="underline hover:text-gold"
            >
              review the partner
            </Link>
            .
          </p>
        )}
      </section>

      <Section title="Listing">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Address" value={property.address} />
          <Row label="Slug" value={property.slug} />
          <Row label="Submitted" value={property.createdAt?.slice(0, 10) ?? '—'} />
          <Row
            label="Coordinates"
            value={
              property.latitude && property.longitude
                ? `${property.latitude}, ${property.longitude}`
                : 'Not set'
            }
          />
        </dl>

        {property.descriptionAr || property.descriptionEn ? (
          <p className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {property.descriptionEn ?? property.descriptionAr}
          </p>
        ) : (
          <p className="mt-3 text-sm text-faint">No description provided.</p>
        )}

        {property.attributes && property.attributes.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {property.attributes.map((attribute) => (
              <li
                key={attribute}
                className="rounded-full border border-line bg-field px-2.5 py-0.5 text-xs text-muted"
              >
                {attribute.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {/*
        Photo COUNT rather than the photos.

        Serving them would mean either a public CDN URL for an unpublished listing or
        a second authenticated image proxy; neither is worth building before the
        storage layer has a signed-URL story. Saying "6 photos" and admitting they are
        not shown is honest; showing nothing and implying there are none is not.
      */}
      <Section title="Photos">
        {property.images.length === 0 ? (
          <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold">
            No photos uploaded. §5.6 expects a gallery, and the ranking score rewards
            photo count — publishing without any is possible but rarely right.
          </p>
        ) : (
          <p className="text-sm text-muted">
            {property.images.length} photo{property.images.length === 1 ? '' : 's'}{' '}
            uploaded
            {property.images.some((image) => image.isCover)
              ? ', cover set'
              : ', no cover set'}
            .{' '}
            <span className="text-faint">
              Previews are not shown here yet — see roadmap 159a.
            </span>
          </p>
        )}
      </Section>

      <Section title="Units">
        {property.units.length === 0 ? (
          <p className="text-sm text-bad">
            No units. A listing with no unit cannot be booked and should not publish.
          </p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {property.units.map((unit) => (
              <li
                key={unit.nameEn}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="text-text">{unit.nameEn}</span>
                <span className="text-xs text-faint">
                  up to {unit.maxGuests} guests · {unit.basePrice} / night · min{' '}
                  {unit.minNights} night{unit.minNights === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Decision">
        {reviewable ? (
          <ReviewProperty
            reference={property.reference}
            partnerVerified={partnerVerified}
            hasUnits={property.units.length > 0}
          />
        ) : (
          <div className="rounded-lg border border-line bg-card p-4">
            <p className="text-sm text-muted">
              This listing is {property.status.replace(/_/g, ' ')} and is not awaiting
              review.
            </p>
            {property.reviewNotes ? (
              <p className="mt-2 text-xs text-faint">{property.reviewNotes}</p>
            ) : null}
          </div>
        )}
      </Section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-gold">
        ← Queues
      </Link>
      <div className="mt-4 grid gap-8">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-text">{value}</dd>
    </div>
  );
}
