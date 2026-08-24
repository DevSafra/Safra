'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { StaffMemberDetail, StaffRole } from '@/lib/api';
import { text } from '@/lib/form';
import { apiErrorOf, fill, t } from '@/lib/strings';

/**
 * What a super admin does TO a staff member: name them, change their role, suspend or reinstate
 * them, and resend an invitation that has not been redeemed.
 *
 * ## Why they are here and not on the list
 *
 * They were inline on every row of الموظفون. Bashar (2026-08-23): the page is too complicated. A
 * role select on each of 25 rows is 25 chances to change the wrong colleague's job with one
 * mis-click, and it is the reason the list could not be a list of links.
 *
 * ## Your own record: renaming yes, the rest no
 *
 * Changing your own role or suspending yourself is refused by the API, so offering either would
 * only produce an error. Renaming is not a change to your own authority and is offered — see the
 * note on the form.
 *
 * ## What is deliberately NOT pre-empted
 *
 * The LAST-super-admin refusal is left to fail rather than hidden. The console cannot know whether
 * another active super admin exists at the moment of the click, and a control that disappears on a
 * stale count is worse than one that fails with an explanation.
 */
export function StaffMemberActions({
  member,
  roles,
  isSelf,
}: {
  member: StaffMemberDetail;
  roles: readonly StaffRole[];
  isSelf: boolean;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(
    path: string,
    init: { method: string; body?: unknown },
    successMessage: string,
  ) {
    if (busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(path, {
        method: init.method,
        ...(init.body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(init.body),
            }
          : {}),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);

        /*
          `apiErrorOf`, not `body.message`.

          The API answers with a CODE and carries an English `message` alongside it for logs. This
          component read the message and printed it, so an Arabic-only console showed «last active
          super admin cannot be suspended» to an operator who does not read English.
        */
        setError(apiErrorOf(body));
        setBusy(false);
        return;
      }

      setNotice(successMessage);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(false);
  }

  return (
    <div className="grid gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok">
          {notice}
        </p>
      ) : null}

      {/*
        Renaming is offered on your OWN record too, unlike the two controls below.

        Those are refused by the API because changing your own role or suspending yourself is a
        change to your own authority. A name is not: correcting the spelling of your own name is
        the most ordinary edit on this screen, and there is nobody better placed to make it.

        It exists at all because 165 accounts predate the column — without a way to set a name on an
        EXISTING account they stay nameless permanently, and the invite form's new required field
        only fixes the ones created from here on.
      */}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const fullName = text(new FormData(event.currentTarget), 'fullName').trim();

          void call(
            `/api/staff/${member.id}`,
            { method: 'PATCH', body: { fullName } },
            fill(t.sections.staff.member.renamed, { name: fullName }),
          );
        }}
      >
        <input
          name="fullName"
          type="text"
          required
          maxLength={120}
          defaultValue={member.fullName ?? ''}
          disabled={busy}
          aria-label={t.sections.staff.member.colName}
          /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
          className="min-w-0 flex-1 rounded-lg border border-line bg-field px-3 py-2 text-xs text-text disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed lg:min-h-0"
        >
          {busy
            ? t.sections.staff.member.renameSaving
            : t.sections.staff.member.renameSave}
        </button>
      </form>

      {isSelf ? (
        <p className="text-[12.5px] text-faint">{t.sections.staff.member.actionsSelf}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/*
          The options are the ROLE ROWS, and the body carries a `staffRoleId`.

          System roles are included: «مدير عام» cannot be edited or withdrawn, but promoting
          somebody INTO it is the ordinary path — and it is the only way to satisfy the
          last-active-super-admin guard when the current holder leaves.

          An account seeded before named roles has no `staffRoleId`, so the select falls back to no
          selection rather than silently claiming the first role in the list.
        */}
          <select
            defaultValue={member.staffRoleId ?? ''}
            disabled={busy}
            aria-label={t.sections.staff.inviteRole}
            onChange={(event) =>
              void call(
                `/api/staff/${member.id}/role`,
                { method: 'PATCH', body: { staffRoleId: event.target.value } },
                fill(t.sections.staff.roleChanged, {
                  email: member.email,
                  role:
                    roles.find((role) => role.id === event.target.value)?.name ??
                    event.target.value,
                }),
              )
            }
            className="cursor-pointer rounded-lg border border-line bg-field px-3 py-2 text-xs text-text disabled:cursor-not-allowed"
          >
            {member.staffRoleId === null ? (
              <option value="">{t.sections.staff.noNamedRole}</option>
            ) : null}
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void call(
                `/api/staff/${member.id}/status`,
                {
                  method: 'PATCH',
                  body: {
                    status: member.status === 'suspended' ? 'active' : 'suspended',
                  },
                },
                member.status === 'suspended'
                  ? fill(t.sections.staff.reinstatedNotice, { email: member.email })
                  : fill(t.sections.staff.suspendedNotice, { email: member.email }),
              )
            }
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed lg:min-h-0"
          >
            {member.status === 'suspended'
              ? t.sections.staff.reinstate
              : t.sections.staff.suspend}
          </button>

          {member.invitationPending ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void call(
                  `/api/staff/${member.id}/resend-invitation`,
                  { method: 'POST' },
                  fill(t.sections.staff.inviteResent, { email: member.email }),
                )
              }
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed lg:min-h-0"
            >
              {t.sections.staff.inviteResend}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
