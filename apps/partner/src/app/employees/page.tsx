import Link from 'next/link';

import { statusTone } from '@safra/ui';

import {
  getEmployeeRoles,
  getMyEmployees,
  sidebarBadges,
  type PartnerEmployee,
  type PartnerEmployeeRole,
} from '@/lib/api';
import { isEmployeeReader, requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { EmployeeActions, EmployeeInvite } from '@/components/employee-manager';
import { TONES } from '@/lib/tones';
import { t } from '@/lib/strings';

/**
 * الموظفون — a partner's own staff (Bashar, 2026-08-23).
 *
 * ## Two facts per row, not one
 *
 * `activated` and `invitationPending` are shown separately because they answer different questions
 * and their combinations are not a single scale:
 *
 * | activated | pending | what it means            | what the reader does |
 * | --------- | ------- | ------------------------ | -------------------- |
 * | true      | —       | signed in, working       | nothing              |
 * | false     | true    | invited, link still live | wait                 |
 * | false     | false   | link expired unused      | invite again         |
 *
 * A single "invited?" flag cannot express the third row, and the third row is the one that needs
 * somebody to act. This project has already paid for collapsing that distinction once: the
 * in-person onboarding screen showed five green steps while the person could not sign in at all.
 *
 * ## Cursor-paged, not a full fetch
 *
 * A partner's headcount is bounded by THEIR business rather than by SAFRA's roadmap, so the
 * "it stays small" assumption behind the geography screens' exemption does not transfer — a bounds
 * test would fire after a partner's screen had already broken, about somebody else's organisation.
 * So the endpoint pages and this shows «عرض المزيد», like every other customer-facing list.
 *
 * The cursor lives in the URL, so a page is reload-safe and the control is an ordinary link that
 * works without JavaScript.
 */
export const dynamic = 'force-dynamic';

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['cursor'];
  const cursor = Array.isArray(raw) ? raw[0] : raw;

  /*
    An EMPLOYEE is told this belongs to the owner before either fetch is made.

    `PARTNER_EMPLOYEE_MANAGE` is deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS` — a
    receptionist who could hire could promote themselves — so both calls would answer 403, and
    `partnerFetch` reports that as `'unauthenticated'`, which the screen renders as «انتهت الجلسة».
    Their session is fine, and signing in again cannot help.

    The sidebar already hides this item from them; that is not a substitute, because a bookmark or
    a pasted link reaches the page directly.
  */
  const [employee, profile] = await Promise.all([
    isEmployeeReader(),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.employees.title}
      partnerName={name}
      active="employees"
      badges={sidebarBadges(profile)}
    >
      <div className="mx-auto grid w-full max-w-[760px] gap-5">{children}</div>
    </Shell>
  );

  if (employee) {
    return shell(
      <p className="text-sm leading-relaxed text-muted">{t.employees.ownerOnly}</p>,
    );
  }

  const [page, rolesResult] = await Promise.all([
    getMyEmployees(cursor),
    getEmployeeRoles(),
  ]);

  if (page === 'unauthenticated' || rolesResult === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (page === 'failed' || rolesResult === 'failed') {
    return shell(<p className="text-sm text-bad">{t.employees.loadFailed}</p>);
  }

  const roles = rolesResult.roles;

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-muted">{t.employees.intro}</p>

      <EmployeeInvite roles={roles} />

      {page.items.length === 0 ? (
        <p className="text-sm text-faint">{t.employees.empty}</p>
      ) : (
        /* An id, so a browser test can address the LIST rather than every `li` on the page —
           the same handle النزاعات carries for the same reason. */
        <ul id="employees-list" className="grid gap-2.5">
          {page.items.map((row) => (
            <li key={row.id}>
              <Row employee={row} roles={roles} />
            </li>
          ))}
        </ul>
      )}

      {/*
        An ordinary link, so paging needs no JavaScript and the URL is shareable. Only rendered
        when the API says there IS another page — a control that leads nowhere teaches nobody
        anything, which is the same reason the geography screens have no pager at all.
      */}
      {page.nextCursor ? (
        <Link
          href={`/employees?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="inline-flex min-h-10 w-fit items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
        >
          {t.employees.loadMore}
        </Link>
      ) : null}
    </>,
  );
}

/** One person: who they are, what they may do, and where they have got to. */
function Row({
  employee,
  roles,
}: {
  employee: PartnerEmployee;
  roles: PartnerEmployeeRole[];
}) {
  /*
    Which of the three states this row is in. `activated` wins: once somebody has signed in, a
    stale invitation row is not news.
  */
  const progress = employee.activated
    ? null
    : employee.invitationPending
      ? { label: t.employees.invitationPending, tone: 'text-muted' }
      : { label: t.employees.invitationExpired, tone: 'text-warn' };

  return (
    <div className="grid gap-3 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <p className="text-sm font-semibold text-text">{employee.fullName}</p>
          {/*
            The address is isolated as a VALUE, never wrapped together with a label — «البريد
            a@b.com» inside one LTR run renders with the value colliding with what precedes it.
          */}
          <Ltr className="text-[12.5px] text-muted">{employee.email}</Ltr>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(employee.status)]}`}
          >
            {employee.status === 'suspended'
              ? t.employees.statusSuspended
              : t.employees.statusActive}
          </span>

          {progress ? (
            <span className={`text-[11.5px] ${progress.tone}`}>{progress.label}</span>
          ) : null}
        </div>
      </div>

      <EmployeeActions employee={employee} roles={roles} />
    </div>
  );
}
