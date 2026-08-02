'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { text } from '@/lib/form';
import type { StaffMember } from '@/lib/api';

const ROLES = [
  { value: 'support_agent', label: 'Support agent' },
  { value: 'finance_officer', label: 'Finance officer' },
  { value: 'operations_manager', label: 'Operations manager' },
  { value: 'super_admin', label: 'Super admin' },
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
        setError(messageOf(body) ?? 'That did not work.');
        setBusy(null);
        return;
      }

      if (successMessage) setNotice(successMessage);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
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
        <p className="rounded-lg border border-good/40 bg-good/10 p-3 text-sm text-good">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="text-lg text-text">Invite a staff member</h2>
        <p className="mt-1 text-xs text-faint">
          They receive a single-use link to set their own password. You never see it, and
          the account cannot be used until they accept and enrol in two-factor
          authentication.
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
              `Invitation sent to ${email}.`,
            );
            event.currentTarget.reset();
          }}
        >
          <input
            name="email"
            type="email"
            required
            placeholder="colleague@safra.example"
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          />
          <select
            name="role"
            defaultValue="support_agent"
            className="rounded-lg border border-line bg-field px-3 py-2 text-sm text-text"
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy === 'invite'}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {busy === 'invite' ? 'Sending…' : 'Invite'}
          </button>
        </form>
      </section>

      <ul className="grid gap-2">
        {staff.map((member) => {
          const isSelf = member.id === currentUserId;

          return (
            <li key={member.id} className="rounded-lg border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-text">
                    {member.email}
                    {isSelf ? <span className="text-faint"> — you</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {member.role.replace(/_/g, ' ')} ·{' '}
                    {member.lastLoginAt
                      ? `last signed in ${member.lastLoginAt.slice(0, 10)}`
                      : 'never signed in'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {member.invitationPending ? (
                    <Pill tone="gold">Invitation pending</Pill>
                  ) : null}
                  {!member.twoFactorEnabled && !member.invitationPending ? (
                    <Pill tone="gold">2FA not enrolled</Pill>
                  ) : null}
                  {member.status === 'suspended' ? (
                    <Pill tone="bad">Suspended</Pill>
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
                        `${member.email} is now ${event.target.value.replace(/_/g, ' ')}.`,
                      )
                    }
                    className="rounded-lg border border-line bg-field px-3 py-1.5 text-xs text-text"
                  >
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
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
                          ? `${member.email} reinstated.`
                          : `${member.email} suspended; their sessions were ended.`,
                      )
                    }
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold"
                  >
                    {member.status === 'suspended' ? 'Reinstate' : 'Suspend'}
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
                          `Invitation re-sent to ${member.email}.`,
                        )
                      }
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-gold/50 hover:text-gold"
                    >
                      Re-send invitation
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
