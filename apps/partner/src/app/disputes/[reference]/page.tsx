import { notFound } from 'next/navigation';

import { getMyDispute, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { DisputeEvidence } from '@/components/dispute-evidence';
import { DisputeResponse } from '@/components/dispute-response';
import { Ltr } from '@/components/ltr';
import { amount } from '@/lib/format';
import { disputeKind, disputeStatus, fill, plural, t } from '@/lib/strings';
import { ltrIsolate, renderRedactions } from '@safra/i18n';

/**
 * One dispute, from the side that had no voice until now (finding 223).
 *
 * ## What is on it, and what is deliberately not
 *
 * Bashar's list, 2026-09-08 — reference, category, status, the guest's title and description, the
 * affected booking, the frozen amount, a response box, the decision and its reasoning. And his
 * boundary: no customer files by default, no contact details, no payment or wallet information, no
 * internal staff notes. None of those four are selected by the API, which is the only way to be
 * sure of it — `booking_internal_notes` is not joined at all.
 *
 * ## The withheld count is SHOWN, not hidden
 *
 * *«If staff determine that a customer image or file is necessary for a fair resolution, then that
 * should be an explicit staff decision and not the default behaviour.»* So a guest's photograph
 * does not appear here — but the fact that one EXISTS does, as a number. A screen that showed
 * nothing would read as «there is no evidence», and the next thing that happens is a support
 * ticket asking what SAFRA is hiding. A count and a sentence answer it in advance.
 *
 * ## Bodies go through `renderRedactions`
 *
 * The guest's description and the partner's own responses are stored with contact details already
 * removed, marked by a token. Rendered raw the reader meets `⟦…⟧`; rendered through this they meet
 * a sentence in their own language saying something was taken out.
 */
export const dynamic = 'force-dynamic';

export default async function DisputePage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  const [access, profile] = await Promise.all([
    sectionAccess('disputes'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={fill(t.disputes.detailTitle, { reference })}
      partnerName={name}
      active="disputes"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const dispute = await getMyDispute(reference);

  if (dispute === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  /*
    `notFound()`, not a message. A dispute belonging to another partner answers 404 from the API,
    and a page that distinguished «not yours» from «no such dispute» would let the reference
    sequence be walked one screen at a time.
  */
  if (dispute === 'failed') notFound();

  const closed = dispute.status === 'resolved' || dispute.status === 'rejected';

  return shell(
    <>
      <section className="rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[16px] font-bold text-sky">
            <Ltr>{dispute.reference}</Ltr>
          </span>
          <span className="text-[13px] text-muted">{disputeStatus(dispute.status)}</span>
          <span className="text-[13px] text-faint">{disputeKind(dispute.kind)}</span>
          {dispute.frozenAmount !== null && dispute.currencyCode !== null ? (
            <span className="ms-auto text-[16px] font-extrabold text-warn">
              {ltrIsolate(amount(dispute.frozenAmount, dispute.currencyCode))}
            </span>
          ) : null}
        </div>

        <p className="mt-1 text-[13px] text-faint">
          {t.disputes.stay}: <Ltr>{dispute.booking.reference}</Ltr>
          {dispute.booking.unitName ? ` · ${dispute.booking.unitName}` : ''} ·{' '}
          {ltrIsolate(dispute.booking.checkIn)} ← {ltrIsolate(dispute.booking.checkOut)}
        </p>
        <p className="mt-0.5 text-[13px] text-faint">
          {t.disputes.openedAt}: {ltrIsolate(dispute.openedAt.slice(0, 10))}
          {dispute.closedAt
            ? ` · ${t.disputes.closedAt}: ${ltrIsolate(dispute.closedAt.slice(0, 10))}`
            : ''}
        </p>
      </section>

      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[14px] font-bold text-text">{t.disputes.allegation}</h2>
        <p className="mt-1.5 text-[14px] font-semibold text-text">
          {renderRedactions(dispute.title, 'ar')}
        </p>
        <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line text-muted">
          {dispute.description
            ? renderRedactions(dispute.description, 'ar')
            : t.disputes.noDescription}
        </p>
      </section>

      {/*
        The DECISION, and its absence said out loud.

        A closed dispute carries a resolution — a CHECK enforces it — so this is never an empty
        panel on a closed case. While it is open the panel says the decision has not been made AND
        that the response below is read before it is: a person deciding whether to spend ten minutes
        writing their account deserves to know it will be read.
      */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[14px] font-bold text-text">{t.disputes.decision}</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-line text-muted">
          {dispute.resolution
            ? renderRedactions(dispute.resolution, 'ar')
            : t.disputes.decisionPending}
        </p>
      </section>

      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[14px] font-bold text-text">{t.disputes.yourResponses}</h2>

        {dispute.responses.length === 0 ? (
          <p className="mt-1.5 text-[14px] text-faint">{t.disputes.noResponses}</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {dispute.responses.map((response) => (
              <li
                key={response.submittedAt}
                className="rounded-lg border border-line bg-field p-3"
              >
                <p className="text-[14px] leading-relaxed whitespace-pre-line text-text">
                  {renderRedactions(response.body, 'ar')}
                </p>
                <p className="mt-1 text-[14px] text-faint">
                  {ltrIsolate(response.submittedAt.slice(0, 16).replace('T', ' '))}
                </p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-line pt-4">
          {closed ? (
            <p className="text-[14px] text-faint">{t.disputes.respondClosed}</p>
          ) : (
            <>
              <h3 className="text-[14px] font-bold text-text">
                {t.disputes.respondHeading}
              </h3>
              <p className="mt-1 mb-3 text-[13px] leading-relaxed text-faint">
                {t.disputes.respondHint}
              </p>
              <DisputeResponse reference={dispute.reference} />
            </>
          )}
        </div>
      </section>

      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[14px] font-bold text-text">{t.disputes.evidence}</h2>

        {/*
          The pictures themselves, and the control that adds one (finding 223, completed).

          It was a list of FILE NAMES — «IMG_2841.jpg · مرفوع منك» — which is the least useful
          rendering of a photograph there is, and there was no way to add one at all. A host asked
          to answer «الغرفة لا تطابق الصور المنشورة» could write a paragraph and show nothing.
        */}
        <DisputeEvidence
          reference={dispute.reference}
          closed={closed}
          evidence={dispute.evidence}
        />

        {/*
          «There are files you have not seen», as a NUMBER.

          Not a list: a filename can carry as much as the photograph it names. And not silence:
          a partner who cannot tell that evidence exists cannot ask for it, which would make the
          «explicit staff decision» Bashar asked for something nobody ever requests.
        */}
        {dispute.withheldEvidenceCount > 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-field px-3 py-2 text-[13px] leading-relaxed text-faint">
            {plural(t.disputes.evidenceWithheld, {
              count: dispute.withheldEvidenceCount,
            })}
          </p>
        ) : null}
      </section>
    </>,
  );
}
