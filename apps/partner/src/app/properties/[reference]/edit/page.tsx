import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';

import {
  getOfferableAmenities,
  getProperty,
  getPropertyFormReference,
  sidebarBadges,
} from '@/lib/api';
import { PropertyAmenities } from '@/components/property-amenities';
import { PropertyEditor } from '@/components/property-editor';
import { PropertyDescriptionForm } from '@/components/property-description-form';
import { PropertyLocationForm } from '@/components/property-location-form';
import { SubmitForReview } from '@/components/submit-for-review';
import { UnitEditor } from '@/components/unit-editor';
import { requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { t } from '@/lib/strings';

/**
 * تعديل العقار.
 *
 * Whether a form is offered at all is the API's answer (`isStructurallyEditable`), not this
 * page's. A screen that decided for itself would eventually show a form whose submit is refused —
 * the partner does the work and then loses it, which is worse than never offering the form.
 *
 * When it is refused, the page says WHY and names what the partner can still change, because
 * «لا يمكن التعديل» on its own reads as a fault rather than as a rule.
 */
export const dynamic = 'force-dynamic';

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  /*
    The amenity catalogue is read ONCE here and passed down. Every unit row and the add form offer
    the same list, so a fetch per component would be one request per unit for an answer that cannot
    differ between them.
  */
  const [profile, property, formReference, amenities] = await Promise.all([
    requireVerifiedPartner(),
    getProperty(reference),
    getPropertyFormReference(),
    getOfferableAmenities(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (property === 'unauthenticated') {
    return (
      <Shell title={t.editProperty.title} partnerName={name} active="properties">
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  /* Unknown, or another partner's. The same answer either way, deliberately. */
  if (property === 'failed') notFound();

  /*
    Where the location picker opens for a listing that has none — its own city, which is a
    published fact and somewhere the partner recognises. Null when the reference lookup
    failed; the picker then falls back to Damascus rather than an empty ocean.
  */
  const city =
    formReference === 'failed'
      ? undefined
      : formReference.cities.find((one) => one.slug === property.citySlug);

  return (
    <Shell
      title={t.editProperty.title}
      partnerName={name}
      active="properties"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">
        <Back />

        <h2 className="text-16 font-bold text-text">{property.name.ar}</h2>

        {property.reviewNotes ? (
          <section className="rounded-card border border-bad/40 bg-bad/10 p-4">
            <h3 className="pb-1 text-14 font-bold text-bad">
              {t.editProperty.rejectedTitle}
            </h3>
            <p className="text-14 leading-relaxed text-text">{property.reviewNotes}</p>
          </section>
        ) : null}

        {property.isStructurallyEditable ? (
          formReference === 'failed' ? (
            <p className="text-sm text-muted">{t.editProperty.unreachable}</p>
          ) : (
            <PropertyEditor property={property} reference={formReference} />
          )
        ) : (
          <>
            <Locked reference={property.reference} />

            {/*
              The one structural thing a published listing may still complete: a location it
              has never had. See `PropertyLocationForm` — setting a null coordinate is not a
              change to anything SAFRA verified, and without this the 97% of published
              listings with no coordinates could only be fixed by a support ticket each.

              Rendered only while it is genuinely absent, so the panel disappears the moment
              it is set and the partner is never offered a control the API will refuse.
            */}
            {!property.latitude || !property.longitude ? (
              <PropertyLocationForm
                /* Reached from «لا تظهر على الخريطة» on الإعلانات. */
                reference={property.reference}
                cityLatitude={city?.latitude ?? null}
                cityLongitude={city?.longitude ?? null}
                /*
                  The listing's OWN city — this form never changes it, unlike the draft editor
                  where the partner can. A published listing's city is frozen by §8.1, so there is
                  one correct set of landmarks and no state to keep in step.
                */
                landmarks={
                  formReference === 'failed'
                    ? []
                    : (formReference.landmarks[property.citySlug] ?? [])
                }
              />
            ) : null}

            {/*
              And the description, for the same reason and under the same narrow rule.

              Rendered only while it is genuinely EMPTY, so the panel disappears the moment it is
              written and the partner is never offered a control the API will refuse — the same
              arrangement the location form above has. Arabic only: it is the default locale and
              the one a reader is guaranteed to meet, and it is the language الإعلانات reports on.
            */}
            {!property.description.ar?.trim() ? (
              <PropertyDescriptionForm reference={property.reference} />
            ) : null}
          </>
        )}

        {/*
          Facilities sit OUTSIDE the structural form, and above الوحدات.

          A published listing may not change its address and may change its facilities, so they
          cannot live in the same gated form — see the component's own note. Above the units because
          a guest reads the building before the room.
        */}
        <PropertyAmenities
          reference={property.reference}
          initial={property.amenityCodes}
          amenities={
            amenities === 'failed' || amenities === 'unauthenticated'
              ? []
              : amenities.amenities
          }
        />

        {/*
          `id="units"` so «بلا وحدات» on الإعلانات lands HERE rather than at the top of a long
          form. `scroll-mt-24` keeps the heading clear of the shell header — the same pairing
          `rowAnchor` uses on the console, and for the same reason: a fragment that scrolls
          somewhere and marks nothing leaves the reader hunting anyway.
        */}
        <section id="units" className="grid gap-2 scroll-mt-24">
          <h3 className="text-14 font-bold text-text">{t.editProperty.units}</h3>
          <UnitEditor
            reference={property.reference}
            units={property.units}
            fallbackCurrency={DEFAULT_MONEY_CURRENCY}
            /*
              An unreachable catalogue degrades to an empty picker with its own sentence, rather
              than taking the whole editor down: a partner correcting a price must not be blocked
              because a reference read blipped.
            */
            amenities={
              amenities === 'failed' || amenities === 'unauthenticated'
                ? []
                : amenities.amenities
            }
          />
        </section>

        {/*
          The step that was missing entirely — see `submit-for-review.tsx`. It sits BELOW الوحدات
          deliberately: submitting is refused without a unit, so the reader meets the requirement
          before they meet the button that depends on it.
        */}
        <SubmitForReview
          reference={property.reference}
          status={property.status}
          unitCount={property.units.length}
          hasLocation={Boolean(property.latitude && property.longitude)}
        />
      </div>
    </Shell>
  );
}

function Back() {
  return (
    <Link
      href="/properties"
      className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-3 text-14 text-muted lg:min-h-0 lg:py-1.5"
    >
      {/* The arrow is its own flex item so `dir="rtl"` places it, not the bidi algorithm. */}
      <span aria-hidden="true">→</span>
      {t.editProperty.back}
    </Link>
  );
}

/**
 * The screen for a listing whose verification would be invalidated by an edit.
 *
 * It names the reason and both remaining routes. A dead end that only says "no" is what makes
 * somebody email support to ask what they did wrong.
 */
function Locked({ reference }: { readonly reference: string }) {
  return (
    <section className="grid gap-3 rounded-card border border-line bg-card p-4">
      <h3 className="text-14 font-bold text-text">{t.editProperty.lockedTitle}</h3>
      <p className="text-14 leading-relaxed text-muted">{t.editProperty.lockedWhy}</p>
      <p className="text-14 leading-relaxed text-muted">
        {t.editProperty.lockedWhatYouCan}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/properties/${reference}/calendar`}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-13 text-muted lg:min-h-0 lg:py-1.5"
        >
          {t.editProperty.goCalendar}
        </Link>
        <Link
          href={`/properties/${reference}/images`}
          className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-13 text-muted lg:min-h-0 lg:py-1.5"
        >
          {t.editProperty.goImages}
        </Link>
      </div>
      <p className="text-13 leading-relaxed text-faint">{t.editProperty.lockedContact}</p>
    </section>
  );
}
