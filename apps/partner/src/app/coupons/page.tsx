import type { ReactNode } from 'react';

import { CouponDecision } from '@/components/coupon-decision';
import { getMyCoupons, sidebarBadges, type PartnerCoupon } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { amount, count } from '@/lib/format';
import { t } from '@/lib/strings';

/**
 * الكوبونات — the coupons SAFRA has offered this partner (Bashar, 2026-09-01).
 *
 * ## Three sections, one list
 *
 * Pending, accepted, rejected. They are the same rows grouped by the partner's own answer rather
 * than three fetches: the API returns what this partner was offered and nothing else, so grouping
 * here keeps one round trip and one source of truth about what «accepted» means.
 *
 * Rejected is shown rather than hidden. A partner who declined a campaign and later sees a
 * competitor advertising it needs to be able to check what they did and when — that is the whole
 * value of keeping the row, and hiding it would make the record exist without being readable.
 */
export const dynamic = 'force-dynamic';

export default async function CouponsPage() {
  const [access, profile] = await Promise.all([
    sectionAccess('coupons'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: ReactNode) => (
    <Shell
      title={t.coupons.title}
      partnerName={name}
      active="coupons"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  /*
    Asked BEFORE the fetch. An employee holds no `PARTNER_COUPON_DECIDE`, so the request would
    answer 403 — which `partnerFetch` reports as 'unauthenticated' and the screen would render
    «انتهت الجلسة» to somebody whose session is perfectly fine.
  */
  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const result = await getMyCoupons();

  if (result === 'unauthenticated' || result === 'failed') {
    return shell(
      <p className="text-sm text-muted">
        {result === 'unauthenticated'
          ? t.dashboard.sessionExpired
          : t.contracts.loadFailed}
      </p>,
    );
  }

  const all = result.coupons;
  const of = (status: PartnerCoupon['status']) =>
    all.filter((one) => one.status === status);

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-muted">{t.coupons.intro}</p>

      <Section
        title={t.coupons.pendingTitle}
        empty={t.coupons.pendingEmpty}
        rows={of('pending')}
        decidable
      />
      <Section
        title={t.coupons.acceptedTitle}
        empty={t.coupons.acceptedEmpty}
        rows={of('accepted')}
      />
      <Section
        title={t.coupons.rejectedTitle}
        empty={t.coupons.rejectedEmpty}
        rows={of('rejected')}
      />
    </>,
  );
}

function Section({
  title,
  empty,
  rows,
  decidable,
}: {
  readonly title: string;
  readonly empty: string;
  readonly rows: readonly PartnerCoupon[];
  /** Only the pending section carries «قبول» / «رفض» — the others are a record. */
  readonly decidable?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[14.5px] font-extrabold text-gold">{title}</h2>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-faint2">{empty}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((coupon) => (
            <li
              key={coupon.code}
              data-coupon={coupon.code}
              className="grid gap-2 rounded-xl border border-line bg-card px-4 py-3.5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[13px] font-bold text-text">
                  {coupon.code}
                </span>
                <span className="text-[12.5px] font-semibold text-gold">
                  {discountOf(coupon)}
                </span>
                {coupon.expired ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-faint">
                    {t.coupons.expired}
                  </span>
                ) : null}
              </div>

              <p className="text-[11.5px] text-faint">
                {t.coupons.colWindow}: {day(coupon.startsAt)} – {day(coupon.endsAt)}
                {coupon.minBookingAmount ? (
                  <>
                    {' · '}
                    {t.coupons.minBooking}:{' '}
                    {amount(coupon.minBookingAmount, coupon.currencyCode ?? 'USD')}
                  </>
                ) : null}
                {coupon.status === 'accepted' ? (
                  <>
                    {' · '}
                    {t.coupons.colUsage}: {count(coupon.redemptions)}
                  </>
                ) : null}
                {coupon.decidedAt ? (
                  <>
                    {' · '}
                    {t.coupons.colDecided}: {day(coupon.decidedAt)}
                  </>
                ) : null}
              </p>

              {decidable ? <CouponDecision code={coupon.code} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The discount in words.
 *
 * A percentage carries no currency and a fixed amount must never be written without one — the
 * «no amount without its currency» rule — so `amount()` is used for the fixed case rather than a
 * bare number beside a symbol assembled here.
 */
function discountOf(coupon: PartnerCoupon): string {
  if (coupon.valueKind === 'percent') {
    return `${Number(coupon.value)}٪`;
  }

  return amount(coupon.value, coupon.currencyCode ?? 'USD');
}

/** A date as the portal writes them — the day only, which is all a coupon window has. */
function day(value: string): string {
  return value.slice(0, 10);
}
