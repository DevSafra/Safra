import {
  getAmenities,
  getCancellationPolicies,
  getCataloguePartnerTypes,
} from '@/lib/api';
import { AmenityManager } from '@/components/amenity-manager';
import { CancellationPolicyManager } from '@/components/cancellation-policy-manager';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { FootNote } from '@/components/admin-table';
import { PartnerTypeManager } from '@/components/partner-type-manager';
import { refuseSection } from '@/components/section-refusal';
import { sidebarCounts } from '@/lib/console';
import { t } from '@/lib/strings';

/**
 * كتالوج المنصّة — الخدمات، سياسات الإلغاء، أنواع الشركاء (Bashar, 2026-09-04).
 *
 * ## Why they were unmanageable, and why that mattered
 *
 * All three are read across the whole platform and were written NOWHERE: adding «شاحن سيارات
 * كهربائية», renaming a policy or closing a partner category meant SQL against production. In
 * Bashar's words: *"I do not want normal business operations to depend on direct SQL or migrations
 * where an administrator should reasonably be able to manage the data through the platform."*
 *
 * ## One page, three managers
 *
 * The same shape المدن والدول والعملات already takes: reference sets that are read together and
 * maintained by the same person in the same sitting belong on one screen. Three sidebar entries
 * for three tables of four rows each would bury the twenty sections that carry daily work.
 *
 * Each manager is complete on its own terms — create, edit, retire, delete, with its own counts
 * and its own confirmations — because the entities differ in what a change to them COSTS. Retiring
 * an amenity hides a checkbox; editing a cancellation ladder changes what every future booking
 * refunds. The policy panel says so in gold above its table for exactly that reason.
 *
 * ## Unpaginated, deliberately
 *
 * Twelve amenities, three policies, four partner types — bounded by the business rather than by
 * usage, the documented exception `geo-bounds.integration.test.ts` already holds the geography
 * lists to. If any of them outgrows a screen it belongs in that test, not behind a pager.
 */
export const dynamic = 'force-dynamic';

export default async function CataloguePage() {
  /*
    FIRST, before any fetch — `staffFetch` maps a 403 to 'unauthenticated', so a guard placed
    after the reads would render «انتهت الجلسة» to somebody whose session is fine.
  */
  const refused = await refuseSection('catalogue', t.nav.catalogue);

  if (refused) return refused;

  const [amenities, policies, partnerTypes, counts] = await Promise.all([
    getAmenities(),
    getCancellationPolicies(),
    getCataloguePartnerTypes(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.catalogue} counts={counts}>
      {/*
        Three panels rather than one, so a failure in any single read degrades that section alone.
        A page that refused to render the amenities because the policy endpoint blipped would be
        the worse failure — this screen is where somebody goes to FIX things.
      */}
      <ConsolePanel>
        <Section result={amenities}>
          {(data) => <AmenityManager amenities={data.amenities} />}
        </Section>
      </ConsolePanel>

      <ConsolePanel>
        <Section result={policies}>
          {(data) => <CancellationPolicyManager policies={data.policies} />}
        </Section>
      </ConsolePanel>

      <ConsolePanel>
        <Section result={partnerTypes}>
          {(data) => <PartnerTypeManager partnerTypes={data.partnerTypes} />}
        </Section>

        <FootNote>{t.sections.catalogue.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

/**
 * The three answers `staffFetch` can give, said once.
 *
 * Written out three times it would be three chances for one panel to say «تعذّر» where another
 * says «انتهت الجلسة» for the same cause — which is how a reader concludes that one section is
 * broken and the other is a permissions problem, when both are the API being unreachable.
 */
function Section<T>({
  result,
  children,
}: {
  readonly result: T | 'unauthenticated' | 'failed';
  readonly children: (data: T) => React.ReactNode;
}) {
  if (result === 'unauthenticated') {
    return <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>;
  }

  if (result === 'failed') {
    return <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>;
  }

  return <>{children(result)}</>;
}
