import { notFound } from 'next/navigation';

import { getPartner, getSanctionsStatus } from '@/lib/api';
import { DocumentReview } from '@/components/document-review';
import { ScreeningPanel } from '@/components/screening-panel';
import { VerifyPartner } from '@/components/verify-partner';
import { BackLink } from '@/components/back-link';
import { returnHref } from '@/lib/search-params';
import { fill, label, t } from '@/lib/strings';

/**
 * One partner's application, and the decision (SRS §8.1).
 *
 * The screen the whole onboarding loop has been waiting for: partners could apply
 * (item 83) and upload documents (item 82), and no human could look at either
 * without curl.
 *
 * Laid out in the order the decision is actually made — who they are, what they sent,
 * whether they are sanctioned, then approve or reject — rather than grouped by data
 * model. The approval control sits last because it is the only irreversible thing
 * here, and it is the one that publishes their listings (item 116).
 */
export const dynamic = 'force-dynamic';

export default async function PartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — see the note in the bookings detail screen. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const back = returnHref('/partners', await searchParams, reference);

  /**
   * The list's health is fetched alongside the partner, so the screening panel can
   * explain a refusal before the reviewer triggers it rather than after.
   */
  const [partner, listStatus] = await Promise.all([
    getPartner(reference),
    getSanctionsStatus(),
  ]);

  if (partner === 'unauthenticated') {
    return (
      <Shell reference={reference} back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  // A missing partner and an unreadable one both render as not found — see the note
  // in `staffFetch` about not explaining which permission is absent.
  if (partner === 'failed') notFound();

  const screened = partner.sanctionsScreenedAt !== null;
  const decided = partner.verification !== 'pending';

  return (
    <Shell reference={reference} back={back}>
      <header>
        <p className="text-xs text-faint">{partner.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{partner.legalName}</h1>
        <p className="mt-1 text-sm text-muted">
          {fill(t.sections.partnerDetail.tradingAs, {
            name: `${partner.displayName} · ${partner.partnerType.code} · ${
              partner.city.nameAr ?? partner.city.nameEn
            }`,
          })}
        </p>
        <StatusPill status={partner.verification} />
      </header>

      {/* ── Contact and identity ──────────────────────────────────────────── */}
      <Section title={t.sections.partnerDetail.applicant}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label={t.sections.partnerDetail.email} value={partner.email} />
          <Row label={t.sections.partnerDetail.phone} value={partner.phone} />
          <Row label={t.sections.partnerDetail.address} value={partner.address} />
          <Row
            label={t.sections.partnerDetail.applied}
            value={partner.createdAt?.slice(0, 10) ?? '—'}
          />
        </dl>
      </Section>

      {/* ── §8.1 documents, reviewed one at a time (item 121) ─────────────── */}
      <Section title={t.sections.partnerDetail.documents}>
        {partner.documents.length === 0 ? (
          <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-gold">
            {t.sections.partnerDetail.noDocuments}
          </p>
        ) : (
          <ul className="grid gap-2">
            {partner.documents.map((document) => (
              <li key={document.id}>
                <DocumentReview document={document} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Sanctions screening (ADR 0002) ────────────────────────────────── */}
      <Section title={t.sections.partnerDetail.sanctionsScreening}>
        <ScreeningPanel
          reference={partner.reference}
          screenedAt={partner.sanctionsScreenedAt}
          result={partner.sanctionsScreeningResult}
          listStatus={
            listStatus === 'failed' || listStatus === 'unauthenticated'
              ? null
              : listStatus
          }
        />
      </Section>

      {/* ── What approving will publish (item 116) ────────────────────────── */}
      <Section title={t.sections.partnerDetail.theirListings}>
        {partner.properties.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.partnerDetail.noListings}</p>
        ) : (
          <ul className="grid gap-2 text-sm">
            {partner.properties.map((property) => (
              <li
                key={property.reference}
                className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3"
              >
                <span className="text-text">{property.nameEn ?? property.nameAr}</span>
                <span className="text-xs text-faint">
                  {property.reference} · {property.status.replace(/_/g, ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── The decision ──────────────────────────────────────────────────── */}
      <Section title={t.sections.partnerDetail.decision}>
        {decided ? (
          <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {partner.verifiedAt
              ? fill(t.sections.partnerDetail.alreadyDecidedOn, {
                  status: label(t.enums.verification, partner.verification),
                  date: partner.verifiedAt.slice(0, 10),
                })
              : fill(t.sections.partnerDetail.alreadyDecided, {
                  status: label(t.enums.verification, partner.verification),
                })}
          </p>
        ) : (
          <VerifyPartner reference={partner.reference} screened={screened} />
        )}
      </Section>
    </Shell>
  );
}

function Shell({
  reference,
  back,
  children,
}: {
  reference: string;
  back: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink href={back} section={t.nav.partners} />
      <div className="mt-4 grid gap-8" data-partner={reference}>
        {children}
      </div>
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

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'approved'
      ? 'border-ok/40 bg-ok/10 text-ok'
      : status === 'rejected'
        ? 'border-bad/40 bg-bad/10 text-bad'
        : 'border-gold/40 bg-gold/10 text-gold';

  return (
    <span className={`mt-3 inline-block rounded-full border px-3 py-1 text-xs ${tone}`}>
      {status}
    </span>
  );
}
