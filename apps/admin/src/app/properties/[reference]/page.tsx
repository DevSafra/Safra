import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getProperty } from '@/lib/api';
import { ReviewProperty } from '@/components/review-property';
import { BackLink, type BackTarget } from '@/components/back-link';
import { StatusPill } from '@/components/admin-table';
import { backTarget, detailHref, origin } from '@/lib/search-params';
import { statusTone } from '@/lib/status-tone';
import { fill, label, t } from '@/lib/strings';

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
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — see the note in the bookings detail screen. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const query = await searchParams;
  const back = backTarget('/properties', query, reference);
  const property = await getProperty(reference);

  if (property === 'unauthenticated') {
    return (
      <Shell back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  if (property === 'failed') notFound();

  const partnerVerified = property.partner.verification === 'approved';
  const reviewable = property.status === 'pending_review';

  return (
    <Shell back={back}>
      <header>
        <p className="text-xs text-faint">{property.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">
          {property.nameEn ?? property.nameAr}
        </h1>
        {/*
          Arabic city name first, and the status through the catalogue rather than the raw enum
          spaced out — this line read «apartment · Damascus · pending review» on an Arabic screen
          (Bashar, 2026-08-06). The status also gets the registry's pill, so العقارات and this
          screen cannot disagree about its colour.
        */}
        <p className="mt-1 text-sm text-muted">
          {property.propertyType.code} · {property.city.nameAr ?? property.city.nameEn}
        </p>
        <p className="mt-2">
          <StatusPill tone={statusTone(property.status)}>
            {label(t.enums.propertyStatus, property.status)}
          </StatusPill>
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
          {fill(t.sections.propertyDetail.tradingAs, {
            name: `${property.partner.displayName} · ${property.partner.reference}`,
          })}
        </p>
        {partnerVerified ? (
          <p className="mt-2 text-xs text-ok">
            {t.sections.propertyDetail.partnerVerified}
          </p>
        ) : (
          <p className="mt-2 text-xs text-gold">
            {fill(t.sections.propertyDetail.partnerNotVerified, {
              status: label(t.enums.verification, property.partner.verification),
            })}{' '}
            <Link
              href={detailHref(
                '/partners',
                property.partner.reference,
                origin('properties', property.reference),
                query,
              )}
              className="underline hover:text-gold"
            >
              {t.sections.propertyDetail.reviewThePartner}
            </Link>
            .
          </p>
        )}
      </section>

      <Section title={t.sections.propertyDetail.listing}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t.sections.propertyDetail.address} value={property.address} />
          <Row label={t.sections.propertyDetail.slug} value={property.slug} />
          <Row
            label={t.sections.propertyDetail.submitted}
            value={property.createdAt?.slice(0, 10) ?? '—'}
          />
          <Row
            label={t.sections.propertyDetail.coordinates}
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
          <p className="mt-3 text-sm text-faint">
            {t.sections.propertyDetail.noDescription}
          </p>
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
      <Section title={t.sections.propertyDetail.photos}>
        {property.images.length === 0 ? (
          <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold">
            {t.sections.propertyDetail.noPhotos}
          </p>
        ) : (
          <p className="text-sm text-muted">
            {fill(t.sections.propertyDetail.photoCount, {
              count: property.images.length,
              cover: property.images.some((image) => image.isCover)
                ? t.sections.propertyDetail.coverSet
                : t.sections.propertyDetail.coverMissing,
            })}{' '}
            <span className="text-faint">
              {t.sections.propertyDetail.previewsPending}
            </span>
          </p>
        )}
      </Section>

      <Section title={t.sections.propertyDetail.units}>
        {property.units.length === 0 ? (
          <p className="text-sm text-bad">{t.sections.propertyDetail.noUnits}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {property.units.map((unit) => (
              <li
                key={unit.nameEn}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="text-text">{unit.nameEn}</span>
                <span className="text-xs text-faint">
                  {fill(t.sections.propertyDetail.unitLine, {
                    guests: unit.maxGuests,
                    price: unit.basePrice,
                    minNights: unit.minNights,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t.sections.propertyDetail.decision}>
        {reviewable ? (
          <ReviewProperty
            reference={property.reference}
            partnerVerified={partnerVerified}
            hasUnits={property.units.length > 0}
          />
        ) : (
          <div className="rounded-lg border border-line bg-card p-4">
            <p className="text-sm text-muted">
              {fill(t.sections.propertyDetail.notAwaitingReview, {
                status: label(t.enums.propertyStatus, property.status),
              })}
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

function Shell({ back, children }: { back: BackTarget; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.properties} />
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
