'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { text } from '@/lib/form';
import type { StaffMember } from '@/lib/api';
import { fill, roleName, t } from '@/lib/strings';
import { shortDate } from '@/lib/format';

const ROLES = [
  /*
    Labels come from `roleName`, the same translator the audit log and the permission matrix use.
    A second English list here is how "Operations manager" and "مدير عمليات" ended up on adjacent
    screens for the same role.
  */
  { value: 'support_agent' },
  { value: 'finance_officer' },
  { value: 'operations_manager' },
  { value: 'super_admin' },
] as const;

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
  currentUserId,
}: {
  staff: StaffMember[];
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
              { method: 'POST', body: { email, role: text(form, 'role') } },
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
            dir="ltr"
            className="rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
          />
          <select
            name="role"
            defaultValue="support_agent"
            aria-label={t.sections.staff.inviteRole}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2.5 text-[12.5px] text-text"
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {roleName(role.value)}
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
                    {roleName(member.role)} ·{' '}
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
                  <select
                    defaultValue={member.role}
                    disabled={busy === member.id}
                    onChange={(event) =>
                      void call(
                        member.id,
                        `/api/staff/${member.id}/role`,
                        { method: 'PATCH', body: { role: event.target.value } },
                        fill(t.sections.staff.roleChanged, {
                          email: member.email,
                          role: roleName(event.target.value),
                        }),
                      )
                    }
                    className="cursor-pointer rounded-lg border border-line bg-field px-3 py-1.5 text-xs text-text disabled:cursor-not-allowed"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {roleName(role.value)}
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
