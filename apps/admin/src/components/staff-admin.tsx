'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { text } from '@/lib/form';
import type { StaffMember, StaffRole } from '@/lib/api';
import { fill, roleName, t } from '@/lib/strings';
import { shortDate } from '@/lib/format';

/**
 * Staff administration (M-5, §9.3).
 *
 * Deliberately shows the refusals rather than hiding the controls that trigger them.
 * Your own row has no role or suspend control — those are refused by the API and
 * offering them would only produce an error — but the last-super-admin refusal is
 * NOT pre-empted here. The console cannot know reliably whether another active super
 * admin exists at the moment of the click, and a control that disappears based on a
 * stale count is worse than one that fails with an explanation.
 */
export function StaffAdmin({
  staff,
  roles,
  currentUserId,
}: {
  staff: StaffMember[];
  /*
    The named roles, fetched once by the page rather than per row (Bashar, 2026-08-23).

    Staff roles are rows now, so the four hard-coded values below could not stand — and a role's
    NAME is data, not a catalogue entry, so `roleName()` cannot resolve «مشرف حجوزات».
  */
  roles: readonly StaffRole[];
  currentUserId: string | undefined;
}) {
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function call(
    key: string,
    path: string,
    init: { method: string; body?: unknown },
    successMessage?: string,
  ) {
    if (busy) return;

    setBusy(key);
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
        setError(messageOf(body) ?? t.sections.staff.actionFailed);
        setBusy(null);
        return;
      }

      if (successMessage) setNotice(successMessage);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    }

    setBusy(null);
  }

  return (
    <div className="grid gap-6">
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

      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="text-[14.5px] font-extrabold text-gold">
          {t.sections.staff.invite}
        </h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-faint">
          {t.sections.staff.inviteHint}
        </p>

        <form
          className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const email = text(form, 'email').trim();

            void call(
              'invite',
              '/api/staff',
              {
                method: 'POST',
                /*
                  A `staffRoleId`, so somebody is invited straight INTO the role they will hold.

                  It sent an enum value until 2026-08-23, which meant inviting into a custom role
                  took two steps — and between redeeming the invitation and the second step the
                  account carried `ROLE_PERMISSIONS[whichever enum was chosen]`, with nothing
                  forcing anybody to take that step. An over-permission window with no upper
                  bound, created by an omission.
                */
                body: { email, staffRoleId: text(form, 'staffRoleId') },
              },
              fill(t.sections.staff.inviteSent, { email }),
            );
            event.currentTarget.reset();
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder={t.sections.staff.inviteEmailPlaceholder}
            aria-label={t.sections.staff.inviteEmail}
            /* No `dir`: a field a person types into follows the page (docs/i18n.md §9). */
            className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
          />
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
            disabled={busy === 'invite'}
            className="cursor-pointer rounded-[9px] bg-[linear-gradient(135deg,#F0CB7C,#C4923E)] px-5 py-2.5 text-[12.5px] font-extrabold text-[#241A05] disabled:opacity-60"
          >
            {busy === 'invite'
              ? t.sections.staff.inviteSending
              : t.sections.staff.inviteSend}
          </button>
        </form>

        <p className="mt-2.5 text-[11px] text-faint">{t.sections.staff.inviteNote}</p>
      </section>

      <ul aria-label={t.sections.staff.listLabel} className="grid gap-2">
        {staff.map((member) => {
          const isSelf = member.id === currentUserId;

          return (
            <li key={member.id} className="rounded-lg border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-text">
                    {member.email}
                    {isSelf ? (
                      <span className="text-faint"> {t.sections.staff.you}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {member.staffRoleName ?? roleName(member.role)} ·{' '}
                    {member.lastLoginAt
                      ? fill(t.sections.staff.lastSignIn, {
                          when: shortDate(member.lastLoginAt),
                        })
                      : t.sections.staff.neverSignedIn}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {member.invitationPending ? (
                    <Pill tone="gold">{t.sections.staff.invitationPending}</Pill>
                  ) : null}
                  {!member.twoFactorEnabled && !member.invitationPending ? (
                    <Pill tone="gold">{t.sections.staff.twoFactorMissing}</Pill>
                  ) : null}
                  {member.status === 'suspended' ? (
                    <Pill tone="bad">{t.sections.staff.suspended}</Pill>
                  ) : null}
                </div>
              </div>

              {/*
                No controls on your own row. Changing your own role or suspending
                yourself is refused by the API — offering the control would only
                produce an error message.
              */}
              {isSelf ? null : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/*
                    The options are the ROLE ROWS, and the body carries a `staffRoleId`.

                    System roles are included: «مدير عام» cannot be edited or withdrawn, but
                    promoting somebody INTO it is the ordinary path — and it is the only way to
                    satisfy the last-active-super-admin guard when the current holder leaves.

                    An account seeded before named roles has no `staffRoleId`, so the select falls
                    back to no selection rather than silently claiming the first role in the list.
                  */}
                  <select
                    defaultValue={member.staffRoleId ?? ''}
                    disabled={busy === member.id}
                    onChange={(event) =>
                      void call(
                        member.id,
                        `/api/staff/${member.id}/role`,
                        {
                          method: 'PATCH',
                          body: { staffRoleId: event.target.value },
                        },
                        fill(t.sections.staff.roleChanged, {
                          email: member.email,
                          role:
                            roles.find((r) => r.id === event.target.value)?.name ??
                            event.target.value,
                        }),
                      )
                    }
                    className="cursor-pointer rounded-lg border border-line bg-field px-3 py-1.5 text-xs text-text disabled:cursor-not-allowed"
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
                    disabled={busy === member.id}
                    onClick={() =>
                      void call(
                        member.id,
                        `/api/staff/${member.id}/status`,
                        {
                          method: 'PATCH',
                          body: {
                            status:
                              member.status === 'suspended' ? 'active' : 'suspended',
                          },
                        },
                        member.status === 'suspended'
                          ? fill(t.sections.staff.reinstatedNotice, {
                              email: member.email,
                            })
                          : fill(t.sections.staff.suspendedNotice, {
                              email: member.email,
                            }),
                      )
                    }
                    className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed"
                  >
                    {member.status === 'suspended'
                      ? t.sections.staff.reinstate
                      : t.sections.staff.suspend}
                  </button>

                  {member.invitationPending ? (
                    <button
                      type="button"
                      disabled={busy === member.id}
                      onClick={() =>
                        void call(
                          member.id,
                          `/api/staff/${member.id}/resend-invitation`,
                          { method: 'POST' },
                          fill(t.sections.staff.inviteResent, { email: member.email }),
                        )
                      }
                      className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold disabled:cursor-not-allowed"
                    >
                      {t.sections.staff.inviteResend}
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Pill({ tone, children }: { tone: 'gold' | 'bad'; children: React.ReactNode }) {
  const classes =
    tone === 'bad'
      ? 'border-bad/40 bg-bad/10 text-bad'
      : 'border-gold/40 bg-gold/10 text-gold';

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${classes}`}>
      {children}
    </span>
  );
}

function messageOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) return null;

  const { message } = body;
  return typeof message === 'string' ? message : null;
}
