import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import { getPartnerApplication } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { ApplicationActions } from '@/components/application-actions';
import { BackLink, type BackTarget } from '@/components/back-link';
import { backTarget } from '@/lib/search-params';
import { count, shortDateTime } from '@/lib/format';
import { label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { refuseSection } from '@/components/section-refusal';

/**
 * One partnership request, and the decision (Bashar, 2026-08-19).
 *
 * Laid out in the order the decision is actually made rather than grouped by data model: who is
 * asking and on what number, what the business is, what has already been done about it, and only
 * then the actions.
 *
 * ## What is NOT on this screen
 *
 * Any way to name an account. The request records which account filed it, proven by the session
 * it was filed from, and acceptance converts THAT one. A reviewer who could type an address would
 * turn "accept this request" into "make an account of my choosing a partner" — the same button,
 * the same audit entry, a different action.
 *
 * ## The one thing an operator has to carry away
 *
 * Accepting is not the end. The contract still has to be uploaded from the partner's own screen,
 * and the account stays «قيد الانتظار» until somebody checks the documents. Said at the bottom of
 * the actions, where it is read at the moment it becomes true.
 */
export const dynamic = 'force-dynamic';

export default async function PartnerApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /* The list position to return to — see `returnQuery` and `backTarget`. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('partnerApplications', t.nav.partnerApplications);

  if (refused) return refused;

  const { reference } = await params;
  const query = await searchParams;
  /*
    A LITERAL base path. The only thing the query string may influence is WHICH PAGE of a known
    list to return to, so a crafted link cannot turn «رجوع» into a redirect off the console.
  */
  const back = backTarget('/applications', query, reference);

  const application = await getPartnerApplication(reference);

  if (application === 'unauthenticated') {
    return (
      <Shell reference={reference} back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  /* A missing request and an unreadable one both render as not found — see `staffFetch`. */
  if (application === 'failed') notFound();

  const c = t.sections.partnerApplications;

  return (
    <Shell reference={reference} back={back}>
      <header>
        <p className="text-xs text-faint">
          <Ltr>{application.reference}</Ltr>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{application.legalName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <StatusPill tone={statusTone(application.status)}>
            {label(t.enums.partnerApplicationStatus, application.status)}
          </StatusPill>
          <span className="text-[12px] text-faint">
            {c.submittedAt} <Ltr>{shortDateTime(application.createdAt)}</Ltr>
          </span>
        </div>
      </header>

      <Section title={c.applicant}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Row label={c.contactName} value={application.contactName} />
          {/* The number to ring. A Latin run isolated as a VALUE, never the label with it. */}
          <Row label={c.phone} value={<Ltr>{application.phone}</Ltr>} />
          <Row label={c.email} value={<Ltr>{application.email}</Ltr>} />
          <Row
            label={c.locale}
            value={label(t.enums.locales, application.preferredLocale)}
          />
        </div>
      </Section>

      <Section title={c.business}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Row label={c.legalName} value={application.legalName} />
          <Row label={c.displayName} value={application.displayName} />
          <Row label={c.partnerType} value={application.partnerTypeAr} />
          <Row label={c.city} value={application.cityAr} />
          <Row label={c.address} value={application.address} />
          {application.propertyCount === null ? null : (
            <Row
              label={c.propertyCount}
              value={<Ltr>{count(application.propertyCount)}</Ltr>}
            />
          )}
          {application.website ? (
            /*
              Rendered as TEXT, not as an anchor.

              It is a URL somebody typed into a public form. A reviewer who wants to look copies
              it deliberately; a link would make an accidental click on an attacker-chosen
              destination one pixel away from reading the row, and would leak the console's
              `Referer` to it.
            */
            <Row label={c.website} value={<Ltr>{application.website}</Ltr>} />
          ) : null}
        </div>

        {application.message ? (
          <div className="mt-2 rounded-lg border border-line bg-card px-4 py-3">
            <p className="text-[11.5px] text-faint">{c.message}</p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-text">
              {application.message}
            </p>
          </div>
        ) : null}
      </Section>

      <Section title={c.history}>
        <ul className="grid gap-2">
          <Event
            when={application.createdAt}
            title={c.submittedAt}
            by={null}
            notes={null}
          />
          {/*
            One line per CALL, not one line for "contacted".

            A request is telephoned as many times as it takes, and each call is its own note —
            which is what the previous shape could not hold: it kept a single note field and every
            call overwrote it, so this list showed one «تم الاتصال» however many times somebody had
            rung (Bashar, 2026-08-20). Ordered oldest first by the API, so the history reads
            downwards: arrival, each call, the decision.
          */}
          {application.contacts.map((contact, index) => (
            <Event
              /*
                The index, and it is the right key here: the list is append-only and ordered by the
                server, so a call's position never changes. `at` would read better and is not
                unique by construction — two calls logged in the same transaction share `now()`.
              */
              key={index}
              when={contact.at}
              title={c.contactedAt}
              by={contact.byEmail}
              notes={contact.notes}
            />
          ))}
          {application.decidedAt ? (
            <Event
              when={application.decidedAt}
              title={c.decidedAt}
              by={application.decidedByEmail}
              notes={application.decisionNotes}
            />
          ) : null}
        </ul>

        {application.partnerReference ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Row
              label={c.becamePartner}
              value={<Ltr>{application.partnerReference}</Ltr>}
            />
            {application.partnerVerification ? (
              <Row
                label={c.partnerVerification}
                value={
                  <StatusPill tone={statusTone(application.partnerVerification)}>
                    {label(t.enums.verification, application.partnerVerification)}
                  </StatusPill>
                }
              />
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section title={t.table.colStatus}>
        <ApplicationActions
          reference={application.reference}
          status={application.status}
        />
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] leading-relaxed text-faint">
          {c.afterAccept}
        </p>
      </Section>
    </Shell>
  );
}

function Shell({
  reference,
  back,
  children,
}: {
  readonly reference: string;
  readonly back: BackTarget;
  readonly children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.partnerApplications} />
      <div className="mt-4 grid gap-8" data-application={reference}>
        {children}
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label: name,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <p className="text-[11.5px] text-faint">{name}</p>
      <p className="mt-1 text-[13px] text-text">{value}</p>
    </div>
  );
}

/** One thing that happened, when, by whom, and what they wrote down. */
function Event({
  when,
  title,
  by,
  notes,
}: {
  readonly when: string;
  readonly title: string;
  readonly by: string | null;
  readonly notes: string | null;
}) {
  return (
    <li className="rounded-lg border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-semibold text-text">{title}</span>
        <span className="text-[11.5px] text-faint">
          <Ltr>{shortDateTime(when)}</Ltr>
        </span>
        {by ? (
          <span className="text-[11.5px] text-faint">
            {t.sections.partnerApplications.contactedBy} <Ltr>{by}</Ltr>
          </span>
        ) : null}
      </div>
      {notes ? (
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-text2">
          {notes}
        </p>
      ) : null}
    </li>
  );
}
