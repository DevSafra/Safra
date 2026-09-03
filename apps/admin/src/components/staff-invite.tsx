'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { text } from '@/lib/form';
import type { StaffRole } from '@/lib/api';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * دعوة موظف جديد — the invite form, and the only client-side JavaScript الموظفون now loads.
 *
 * ## Why this is its own component
 *
 * `StaffAdmin` used to be the form AND the table AND every row's controls, which made the whole
 * list a client component: 165 rows of markup shipped to the browser so that three buttons per row
 * could call `fetch`. The controls moved to صفحة الموظف (Bashar, 2026-08-23 — "every Employee
 * should be clickable to see his details"), so the list is now plain server-rendered links and the
 * only thing left that needs a browser is this form.
 */
export function StaffInvite({ roles }: { roles: readonly StaffRole[] }) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite(fullName: string, email: string, staffRoleId: string) {
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
          A `staffRoleId`, so somebody is invited straight INTO the role they will hold.

          It sent an enum value until 2026-08-23, which meant inviting into a custom role took two
          steps — and between redeeming the invitation and the second step the account carried
          `ROLE_PERMISSIONS[whichever enum was chosen]`, with nothing forcing anybody to take that
          step. An over-permission window with no upper bound, created by an omission.
        */
        body: JSON.stringify({ fullName, email, staffRoleId }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(body));
        setBusy(false);
        return;
      }

      setNotice(fill(t.sections.staff.inviteSent, { email }));
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <h2 className="text-[14.5px] font-extrabold text-gold-ink">
        {t.sections.staff.invite}
      </h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
        {t.sections.staff.inviteHint}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {notice}
        </p>
      ) : null}

      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1.4fr_1.6fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);

          void invite(
            text(form, 'fullName').trim(),
            text(form, 'email').trim(),
            text(form, 'staffRoleId'),
          );
          event.currentTarget.reset();
        }}
      >
        {/*
          The name first, because that is the order somebody says it in — and it is REQUIRED, since
          the API rejects an invitation without one. No `dir`: a field a person types into follows
          the page (docs/i18n.md §9), and an Arabic name in an RTL field is the ordinary case.
        */}
        <input
          name="fullName"
          type="text"
          required
          maxLength={120}
          placeholder={t.sections.staff.inviteNamePlaceholder}
          aria-label={t.sections.staff.inviteName}
          className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
        />
        <input
          name="email"
          type="email"
          required
          placeholder={t.sections.staff.inviteEmailPlaceholder}
          aria-label={t.sections.staff.inviteEmail}
          /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
          className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
        />
        {/*
          No default selection. The role decides what the account can reach, so a select that
          arrives pre-filled invites somebody to send an invitation without reading it.
        */}
        <select
          name="staffRoleId"
          required
          defaultValue=""
          aria-label={t.sections.staff.inviteRole}
          className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
        >
          <option value="" disabled>
            {t.sections.staff.pickRole}
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-[9px] bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2.5 text-[12.5px] font-extrabold text-[#241A05] disabled:opacity-60"
        >
          {busy ? t.sections.staff.inviteSending : t.sections.staff.inviteSend}
        </button>
      </form>

      <p className="mt-2.5 text-[11px] text-faint">{t.sections.staff.inviteNote}</p>
    </section>
  );
}
