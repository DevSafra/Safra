'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { ERROR } from '@safra/contracts';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { fill, t } from '@/lib/strings';
import type { PartnerEmployee, PartnerEmployeeRole } from '@/lib/api';

/**
 * The writes on الموظفون: inviting somebody, changing their role, suspending and removing.
 *
 * ## One client component for all of them
 *
 * They share the error-code map and the busy flag, and splitting them would mean two copies of the
 * translation from `employee.already_employed` to a sentence. The LIST itself stays a server
 * component — it is the reader's data and there is no reason for it to arrive as JSON and be
 * rendered twice.
 *
 * ## Every refusal names its cause
 *
 * The API answers with a CODE and this maps each to a sentence about the SITUATION, not about the
 * field. «هذا البريد لموظّف يعمل بالفعل» rather than «البريد غير صالح» — the address is fine, and
 * a message about the field sends somebody to retype what they typed correctly.
 */
function messageFor(code: unknown): string {
  /*
    The hold comes first, before this component's own vocabulary.

    `partner.suspended` is not a fact about employees, so it has no case below and would fall to
    `default:` — a generic failure for a state the reader can see the reason for at the top of the
    same screen. Consulted here rather than at each call site so every one of them inherits it.
  */
  const refused = refusalFor(code);

  if (refused) return refused;

  switch (code) {
    case ERROR.EMPLOYEE_ALREADY_EMPLOYED:
      return t.employees.alreadyEmployed;
    case ERROR.EMPLOYEE_EMAIL_IS_OWNER:
      return t.employees.emailIsOwner;
    case ERROR.EMPLOYEE_EMAIL_IS_STAFF:
      return t.employees.emailIsStaff;
    case ERROR.EMPLOYEE_ROLE_NOT_FOUND:
      return t.employees.roleNotFound;
    case ERROR.EMPLOYEE_NOT_FOUND:
      return t.employees.notFound;
    default:
      return t.employees.failed;
  }
}

/** «دعوة موظّف» — an address, a name and a role. */
export function EmployeeInvite({ roles }: { roles: PartnerEmployeeRole[] }) {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /*
    With no role defined there is nothing to assign, so the form says so and offers the way out
    instead of an empty picker that refuses whatever is submitted.

    Roles are the PARTNER's own since 2026-08-23, so this is not a wait for somebody else: the
    person who can fix it is the one reading. Whatever they define is still bounded by
    `PARTNER_EMPLOYEE_PERMISSIONS`, which is the platform's only remaining involvement — it stops
    an employee out-ranking their employer and is not administration.
  */
  if (roles.length === 0) {
    /*
      A ROUTE, not just a sentence.

      This said «تواصل مع فريق سفرة» until roles became the partner's own — advice to wait for
      somebody else, when the person who can fix it is the one reading. A dead end with a true
      sentence in it is the same defect as «انتهت الجلسة» on a permission refusal: it sends the
      reader somewhere that cannot help.
    */
    return (
      <div className="grid gap-2 rounded-xl border border-line bg-card p-4">
        <p className="text-sm text-muted">{t.employees.noRoles}</p>
        <Link
          href="/employee-roles"
          className="inline-flex min-h-10 w-fit items-center rounded-lg bg-gold px-4 text-sm font-semibold text-bg transition-opacity hover:opacity-90 lg:min-h-0 lg:py-2"
        >
          {t.employees.defineRoles}
        </Link>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    setSent(false);

    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, roleId }),
      });

      if (response.ok) {
        setSent(true);
        setFullName('');
        setEmail('');
        setRoleId('');
        setBusy(false);
        router.refresh();

        return;
      }

      setError(messageFor(await codeOfResponse(response)));
      setBusy(false);
    } catch {
      setError(t.employees.failed);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
      className="grid gap-3 rounded-xl border border-line bg-card p-4"
    >
      <h2 className="text-sm font-semibold text-text">{t.employees.inviteTitle}</h2>

      {/*
        No `dir` on any field. A field a person TYPES INTO follows the page's direction, which here
        is RTL (Bashar, 2026-08-19); an email is a left-to-right RUN and the bidi algorithm lays it
        out correctly inside an RTL field without being told. `dir="ltr"` would move the caret and
        the value to the far side of a label sitting on the right.
      */}
      <label className="grid gap-1 text-[12.5px] text-muted">
        {t.employees.fullName}
        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          minLength={2}
          maxLength={120}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {t.employees.email}
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
      </label>

      <label className="grid gap-1 text-[12.5px] text-muted">
        {t.employees.role}
        <select
          value={roleId}
          onChange={(event) => setRoleId(event.target.value)}
          required
          className="cursor-pointer rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        >
          <option value="">{t.employees.rolePlaceholder}</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      {sent ? <p className="text-sm text-ok">{t.employees.inviteSent}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="w-fit cursor-pointer rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t.employees.inviting : t.employees.inviteSubmit}
      </button>
    </form>
  );
}

/**
 * The controls on one row: change the role, suspend or restore, remove.
 *
 * ## Every control names the person
 *
 * `aria-label` carries the employee's name, because a list of eight rows otherwise offers eight
 * identical «إزالة» buttons — indistinguishable to somebody using a screen reader and to anybody
 * who has scrolled past the name.
 *
 * ## Removing asks first
 *
 * Suspending is reversible and removing is not: it ends the employment and revokes every session
 * they hold. `confirm` is the browser's own dialogue rather than a modal, because a modal here
 * would be a second focus trap to get right for one question with two answers.
 */
export function EmployeeActions({
  employee,
  roles,
}: {
  employee: PartnerEmployee;
  roles: PartnerEmployeeRole[];
}) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(init: { method: string; body?: unknown }): Promise<void> {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      /*
        Encoded even though it is a uuid the API issued.

        Nothing today can put a path separator in it, and the route handler encodes again before
        the upstream call — but a value interpolated into a URL path should not depend on two other
        places being careful, and the id reaches here through a schema that types it as `string`.
        The same reasoning `safeContractFileName` records for a filename.
      */
      const response = await fetch(`/api/employees/${encodeURIComponent(employee.id)}`, {
        method: init.method,
        ...(init.body
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(init.body),
            }
          : {}),
      });

      if (response.ok) {
        setBusy(false);
        router.refresh();

        return;
      }

      setError(messageFor(await codeOfResponse(response)));
      setBusy(false);
    } catch {
      setError(t.employees.failed);
      setBusy(false);
    }
  }

  const suspended = employee.status === 'suspended';

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={employee.roleId}
          disabled={busy}
          aria-label={fill(t.employees.roleLabel, { name: employee.fullName })}
          onChange={(event) =>
            void send({ method: 'PATCH', body: { roleId: event.target.value } })
          }
          className="cursor-pointer rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[12.5px] text-text disabled:cursor-not-allowed disabled:opacity-60"
        >
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={busy}
          aria-label={fill(
            suspended ? t.employees.restoreLabel : t.employees.suspendLabel,
            { name: employee.fullName },
          )}
          onClick={() =>
            void send({
              method: 'PATCH',
              body: { status: suspended ? 'active' : 'suspended' },
            })
          }
          className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-text transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {suspended ? t.employees.restore : t.employees.suspend}
        </button>

        <button
          type="button"
          disabled={busy}
          aria-label={fill(t.employees.removeLabel, { name: employee.fullName })}
          onClick={() => {
            if (
              window.confirm(fill(t.employees.removeConfirm, { name: employee.fullName }))
            ) {
              void send({ method: 'DELETE' });
            }
          }}
          className="cursor-pointer rounded-lg border border-bad/50 px-3 py-1.5 text-[12.5px] text-bad transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t.employees.remove}
        </button>

        {busy ? (
          <span className="text-[12px] text-faint">{t.employees.working}</span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
