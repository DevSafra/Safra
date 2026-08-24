import {
  getMyProperties,
  getPropertyFormReference,
  sidebarBadges,
  type PartnerProperty,
} from '@/lib/api';
import Link from 'next/link';

import { AddProperty } from '@/components/add-property';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { statusTone } from '@safra/ui';

import { TONES } from '@/lib/tones';

import { amount } from '@/lib/format';
import { coverUrl } from '@/lib/media';
import { fill, propertyStatus, propertyType, t, tripAttribute } from '@/lib/strings';

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
  /*
    Refused BEFORE the fetch, so the 403 is never made rather than made and reported as a dead
    session. `sectionAccess` picks the sentence: عقاراتي is grantable, so an employee without it is
    told their role does not include it and who can change that.
  */
  const [access, profile] = await Promise.all([
    sectionAccess('properties'),
    requireVerifiedPartner(),
  ]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (access !== 'open') {
    return (
      <Shell
        title={t.properties.title}
        partnerName={name}
        active="properties"
        badges={sidebarBadges(profile)}
      >
        <SectionRefusal access={access} />
      </Shell>
    );
  }

  const [properties, reference] = await Promise.all([
    getMyProperties(),
    getPropertyFormReference(),
  ]);

  return (
    <Shell
      title={t.properties.title}
      partnerName={name}
      active="properties"
      badges={sidebarBadges(profile)}
    >
      {properties === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : properties === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <>
          {/*
            §7.2's header row, ABOVE the empty check.

            A partner with no listings is the one who most needs this button — putting it inside
            the non-empty branch would show it to everybody except the person adding their first.
          */}
          {reference === 'failed' ? null : (
            <div className="mb-3.5">
              <AddProperty
                reference={reference}
                verified={
                  profile !== 'failed' &&
                  profile !== 'unauthenticated' &&
                  profile.verification === 'approved'
                }
              />
            </div>
          )}

          {properties.length === 0 ? (
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
        </>
      )}
    </Shell>
  );
}

/**
 * One listing, as the handoff's §7.2 card draws it: a 140px image with the status pill over it,
 * the name and rating, a meta line, the trait chips, the price, and the two actions.
 */
function Card({ property }: { readonly property: PartnerProperty }) {
  const meta = [
    property.city,
    propertyType(property.propertyType),
    fill(t.properties.units, { n: property.unitCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[14px] border border-line bg-card">
      {/*
        The image, or an honest placeholder. `property_images` is empty for every seeded listing
        because nothing has uploaded one yet — a stock photo here would be a picture of somewhere
        the guest is not going.
      */}
      <div className="relative h-[140px] bg-field">
        {property.coverKey ? (
          /*
            A plain `<img>`, not `next/image`. The media host is configured per environment and
            Next's optimiser would need it in `remotePatterns` at build time; these are already
            rendered to fixed variants by the upload pipeline, so there is nothing left to optimise.
          */
          <img
            src={coverUrl(property.coverKey, property.coverWidths, 560)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="grid h-full place-items-center text-[11.5px] text-faint">
            {t.properties.noPhoto}
          </span>
        )}

        <span className="absolute top-2.5 start-2.5">
          <StatusPill status={property.status} />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-[14px] font-bold text-text">
            {property.nameAr}
            {/*
              The room number beside the name, and only when there is one (Bashar, 2026-08-19).

              Only the VALUE is isolated. Wrapping the whole thing in `dir="ltr"` put the Arabic
              label «وحدة» inside a left-to-right run, so it laid out after the number and the value
              collided with the listing name — «فندق اختبار 08351A-12 وحدة». `A-12` still needs the
              isolation on its own: the hyphen is bidi-neutral, so an unisolated value reads `12-A`.
            */}
            {property.roomNumber ? (
              <span className="ms-2 whitespace-nowrap text-[11.5px] font-semibold text-muted">
                {t.properties.roomNumberBadge} <Ltr>{property.roomNumber}</Ltr>
              </span>
            ) : null}
          </h2>
          {property.rating ? (
            <span className="shrink-0 text-[12.5px] font-extrabold text-gold">
              ★ {property.rating}
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-[11.5px] text-faint">{meta}</p>

        {property.attributes.length > 0 ? (
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {property.attributes.map((attribute) => (
              <li
                key={attribute}
                className="rounded-full border border-gold/40 px-2 py-0.5 text-[11px] font-semibold text-gold"
              >
                {tripAttribute(attribute)}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-auto pt-3.5">
          {property.fromPrice ? (
            <p className="text-[17px] font-extrabold text-gold">
              <Ltr>{amount(property.fromPrice, property.currencyCode ?? 'USD')}</Ltr>
              <span className="text-[12px] font-normal text-faint">
                {' '}
                {t.properties.perNight}
              </span>
            </p>
          ) : null}

          <div className="mt-2.5 flex gap-2">
            {/* الصور is built; تعديل and التقويم are not, and say so rather than navigating nowhere. */}
            <Link
              href={`/properties/${encodeURIComponent(property.reference)}/images`}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-gold/50 px-3 text-[11.5px] font-semibold text-gold lg:min-h-0 lg:py-1.5"
            >
              {t.properties.manageImages}
            </Link>
            <Link
              href={`/properties/${property.reference}/edit`}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-line px-3 text-[11.5px] text-muted lg:min-h-0 lg:py-1.5"
            >
              {t.properties.edit}
            </Link>
            <Link
              href={`/properties/${property.reference}/calendar`}
              className="inline-flex min-h-10 flex-1 items-center justify-center rounded-lg border border-line px-3 text-[11.5px] text-muted lg:min-h-0 lg:py-1.5"
            >
              {t.properties.calendar}
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

/** The §7.2 status pill: a coloured outline over the image. */
function StatusPill({ status }: { readonly status: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${TONES[statusTone(status)]}`}
    >
      {propertyStatus(status)}
    </span>
  );
}
