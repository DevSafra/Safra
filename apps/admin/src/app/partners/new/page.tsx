import { getGeography, getPartnerTypes } from '@/lib/api';
import { OnboardPartnerForm } from '@/components/onboard-partner-form';
import { BackLink } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { t } from '@/lib/strings';

/**
 * تسجيل شريك جديد, step 1 — the partner's details (Bashar, 2026-08-23).
 *
 * A route of its own rather than a panel on الشركاء, because it is the only screen in the console
 * that CREATES a partner and it wants the whole width for a fourteen-field form. Saving lands on
 * `/partners/[reference]/onboarding`, which carries the remaining steps.
 *
 * ## The choices are fetched, never hardcoded
 *
 * Types and cities come from the catalogue, so adding Mobility or a new city is an INSERT and not
 * a deployment — the same reasoning the public «انضم كشريك» form is built on. A failed read
 * renders the form with an empty select rather than a blank page: the operator can see what went
 * wrong instead of a screen that looks like a missing feature.
 */
export const dynamic = 'force-dynamic';

export default async function NewPartnerPage() {
  const [partnerTypes, geography] = await Promise.all([
    getPartnerTypes(),
    getGeography(),
  ]);

  const unauthenticated =
    partnerTypes === 'unauthenticated' || geography === 'unauthenticated';

  const types =
    partnerTypes === 'failed' || partnerTypes === 'unauthenticated' ? [] : partnerTypes;

  /*
    Active cities only. An inactive city is not somewhere SAFRA operates, and the API refuses one
    anyway — offering it would be a select whose choices the server rejects.
  */
  const cities =
    geography === 'failed' || geography === 'unauthenticated'
      ? []
      : geography.cities
          .filter((city) => city.isActive)
          .map((city) => ({ slug: city.slug, nameAr: city.nameAr }));

  /*
    No list position to restore: this screen is reached from a button on الشركاء, not from a row,
    so `backTarget` with no parameters resolves to the plain registry — which is the useful
    destination. The same fallback every detail screen uses when it is reached from a bookmark.
  */
  const back = backTarget('/partners', {});

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.partners} />

      <header className="mt-4">
        <h1 className="text-2xl font-semibold text-text">
          {t.sections.partnerOnboarding.title}
        </h1>
        <p className="mt-1 text-sm text-muted">{t.sections.partnerOnboarding.subtitle}</p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          {t.sections.partnerOnboarding.intro}
        </p>
      </header>

      <div className="mt-6">
        {unauthenticated ? (
          <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
        ) : (
          <OnboardPartnerForm partnerTypes={types} cities={cities} />
        )}
      </div>
    </main>
  );
}
