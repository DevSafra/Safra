'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ERROR,
  PARTNER_SECTION_PERMISSIONS,
  groupPermissions,
  openableSections,
} from '@safra/contracts';

import { codeOfResponse, refusalFor } from '@/lib/refusal';
import { fill, t } from '@/lib/strings';
import type { PartnerEmployeeRoleDetail } from '@/lib/api';

/** Every refusal the roles API can give, as a sentence about the SITUATION. */
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
    case ERROR.EMPLOYEE_ROLE_NAME_TAKEN:
      return t.employeeRoles.nameTaken;
    case ERROR.EMPLOYEE_ROLE_NOT_FOUND:
      return t.employeeRoles.notFound;
    case ERROR.EMPLOYEE_ROLE_IN_USE:
      return t.employeeRoles.inUse;
    default:
      return t.employeeRoles.failed;
  }
}

/** A capability in words, falling back to the raw permission so a new one announces itself. */
function capabilityLabel(permission: string): string {
  return t.employeeRoles.capability[permission] ?? permission;
}

/** A group heading, falling back to its key for the same reason. */
function groupLabel(group: string): string {
  return t.employeeRoles.capabilityGroup[group] ?? group;
}

/**
 * The form, used for BOTH creating and editing.
 *
 * One component rather than two, because the fields, the validation and the capability list are
 * identical and the only differences are the endpoint, the verb and three words of copy. Two
 * copies would drift the moment a capability gained a hint.
 *
 * ## It always sends the COMPLETE set
 *
 * The API is `PUT`, which replaces. That is right — a partial permission set cannot say whether it
 * means "this is now everything" or "add this" — and it means the form must never send a delta.
 * The checkboxes ARE the state, so what is submitted is what is on screen.
 */
function RoleForm({
  role,
  capabilities,
  onDone,
}: {
  role?: PartnerEmployeeRoleDetail;
  capabilities: string[];
  onDone: () => void;
}) {
  const router = useRouter();

  const [name, setName] = useState(role?.name ?? '');
  const [chosen, setChosen] = useState<string[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = role !== undefined;

  function toggle(permission: string): void {
    setChosen((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission],
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    /*
      Checked here as well as by the API, because the remedy is on this screen and a round trip to
      be told "tick something" is a round trip that teaches nothing.
    */
    if (chosen.length === 0) {
      setError(t.employeeRoles.capabilitiesRequired);

      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        editing
          ? `/api/employee-roles/${encodeURIComponent(role.id)}`
          : '/api/employee-roles',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, permissions: chosen }),
        },
      );

      if (response.ok) {
        setBusy(false);
        onDone();
        router.refresh();

        return;
      }

      setError(messageFor(await codeOfResponse(response)));
      setBusy(false);
    } catch {
      setError(t.employeeRoles.failed);
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
      <h2 className="text-sm font-semibold text-text">
        {editing ? t.employeeRoles.editTitle : t.employeeRoles.createTitle}
      </h2>

      {/* No `dir`: a field a person types into follows the page's direction (Bashar, 2026-08-19). */}
      <label className="grid gap-1 text-[12.5px] text-muted">
        {t.employeeRoles.nameLabel}
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          minLength={2}
          maxLength={60}
          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text"
        />
        <span className="text-[11.5px] text-faint">{t.employeeRoles.nameHint}</span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="text-[12.5px] text-muted">
          {t.employeeRoles.capabilitiesLabel}
        </legend>

        {/*
          Built from the SERVED list, not from a constant copied into this app — a checkbox offering
          something the API rejects produces a refusal the reader cannot act on — and GROUPED by the
          shared `groupPermissions()` rather than a second hand-written taxonomy.

          Eleven capabilities in one column is a wall somebody ticks without reading. Four headings
          is a set of decisions. Empty groups are omitted by the helper, and an uncategorised one
          lands in a visible «أخرى» rather than disappearing.
        */}
        {groupPermissions(capabilities).map(({ group, permissions }) => (
          <div key={group} className="grid gap-1.5">
            <p className="text-[11.5px] font-semibold text-faint">{groupLabel(group)}</p>

            <div className="grid gap-1.5 sm:grid-cols-2">
              {permissions.map((permission) => (
                <label
                  key={permission}
                  className="flex cursor-pointer items-center gap-2 text-[12.5px] text-text"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(permission)}
                    onChange={() => toggle(permission)}
                    className="cursor-pointer"
                  />
                  {capabilityLabel(permission)}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      {/*
        A role that opens no screen is legitimate but almost never intended — see the copy for why
        it is a warning and not a refusal. Shown live as the boxes are ticked, so the partner sees
        it while they are still deciding rather than after they have hired somebody into it.
      */}
      {chosen.length > 0 &&
      openableSections(chosen, PARTNER_SECTION_PERMISSIONS).length === 0 ? (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] leading-relaxed text-warn">
          {t.employeeRoles.opensNothing}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy
            ? editing
              ? t.employeeRoles.saving
              : t.employeeRoles.creating
            : editing
              ? t.employeeRoles.save
              : t.employeeRoles.create}
        </button>

        {editing ? (
          <button
            type="button"
            onClick={onDone}
            className="cursor-pointer rounded-lg border border-line px-4 py-2.5 text-sm text-muted transition-opacity hover:opacity-80"
          >
            {t.employeeRoles.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * أدوار الموظفين — the whole screen's interactive half.
 *
 * The list is rendered here rather than on the server because editing swaps a row for the form in
 * place, and a partner has a handful of roles: there is no page weight to save by splitting it, and
 * splitting it would put the "which row am I editing" state on one side of a boundary and the rows
 * on the other.
 */
export function EmployeeRoleManager({
  roles,
  capabilities,
}: {
  roles: PartnerEmployeeRoleDetail[];
  capabilities: string[];
}) {
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(role: PartnerEmployeeRoleDetail): Promise<void> {
    if (busyId) return;

    if (!window.confirm(fill(t.employeeRoles.confirmRemove, { name: role.name }))) {
      return;
    }

    setBusyId(role.id);
    setError(null);

    try {
      const response = await fetch(`/api/employee-roles/${encodeURIComponent(role.id)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setBusyId(null);
        router.refresh();

        return;
      }

      setError(messageFor(await codeOfResponse(response)));
      setBusyId(null);
    } catch {
      setError(t.employeeRoles.failed);
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {editingId === null ? (
        <RoleForm capabilities={capabilities} onDone={() => setEditingId(null)} />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}

      {roles.length === 0 ? null : (
        <ul id="employee-roles-list" className="grid gap-2.5">
          {roles.map((role) =>
            editingId === role.id ? (
              <li key={role.id}>
                <RoleForm
                  role={role}
                  capabilities={capabilities}
                  onDone={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={role.id}>
                <div className="grid gap-2 rounded-xl border border-line bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-text">{role.name}</p>

                    {/*
                      How many people hold it, so the delete constraint is legible BEFORE the
                      button is pressed rather than reported as a refusal afterwards.
                    */}
                    <span className="text-[11.5px] text-faint">
                      {role.employeeCount === 0
                        ? t.employeeRoles.heldNobody
                        : fill(t.employeeRoles.held, { n: String(role.employeeCount) })}
                    </span>
                  </div>

                  <p className="text-[12.5px] leading-relaxed text-muted">
                    {role.permissions.map(capabilityLabel).join(' · ')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId !== null}
                      aria-label={fill(t.employeeRoles.editLabel, { name: role.name })}
                      onClick={() => setEditingId(role.id)}
                      className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-text transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t.employeeRoles.edit}
                    </button>

                    {/*
                      A held role offers no delete at all, and says why in its place. Offering a
                      button that always refuses teaches somebody that the screen is unreliable;
                      saying "move them first" teaches them what to do.
                    */}
                    {role.employeeCount > 0 ? (
                      <span className="text-[11.5px] text-faint">
                        {t.employeeRoles.inUse}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId !== null}
                        aria-label={fill(t.employeeRoles.removeLabel, {
                          name: role.name,
                        })}
                        onClick={() => void remove(role)}
                        className="cursor-pointer rounded-lg border border-bad/50 px-3 py-1.5 text-[12.5px] text-bad transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {t.employeeRoles.remove}
                      </button>
                    )}

                    {busyId === role.id ? (
                      <span className="text-[12px] text-faint">
                        {t.employeeRoles.working}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
