import { getMyProfile, getMyProperties, type PartnerProperty } from '@/lib/api';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { statusTone, type Tone } from '@safra/ui';

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
  const [profile, properties] = await Promise.all([getMyProfile(), getMyProperties()]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

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
          <h2 className="min-w-0 text-[14px] font-bold text-text">{property.nameAr}</h2>
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
            <Action label={t.properties.edit} />
            <Action label={t.properties.calendar} />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * تعديل and التقويم, disabled and saying so.
 *
 * Neither screen exists yet. A button that navigates nowhere is worse than one that admits it —
 * the console makes the same call for its unbuilt sections, and `aria-disabled` with a title is
 * what tells a screen-reader user the same thing the cursor tells everybody else.
 */
function Action({ label }: { readonly label: string }) {
  return (
    <span
      aria-disabled="true"
      title={t.properties.notBuilt}
      className="inline-flex min-h-10 flex-1 cursor-not-allowed items-center justify-center rounded-lg border border-line px-3 text-[11.5px] text-faint2 lg:min-h-0 lg:py-1.5"
    >
      {label}
    </span>
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

/**
 * Tone classes for this app.
 *
 * The COLOUR comes from `statusTone` in `@safra/ui`, shared with the console and the customer
 * site, so «منشور» is the same green everywhere in the project. Only the pill's shape is local:
 * this one sits over a photograph and needs a filled background to stay legible.
 */
const TONES: Record<Tone, string> = {
  ok: 'border-ok bg-ok/15 text-ok',
  teal: 'border-teal bg-teal/15 text-teal',
  lime: 'border-lime bg-lime/15 text-lime',
  sky: 'border-sky bg-sky/15 text-sky',
  indigo: 'border-indigo bg-indigo/15 text-indigo',
  pend: 'border-pend bg-pend/15 text-pend',
  gold: 'border-gold bg-gold/15 text-gold',
  warn: 'border-warn bg-warn/15 text-warn',
  orange: 'border-orange bg-orange/15 text-orange',
  bad: 'border-bad bg-bad/15 text-bad',
  crimson: 'border-crimson bg-crimson/15 text-crimson',
  faint: 'border-line bg-field text-faint',
  slate: 'border-slate bg-slate/15 text-slate',
  stone: 'border-stone bg-stone/15 text-stone',
};
