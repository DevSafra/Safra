'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { groupPermissions } from '@safra/contracts';

import type { StaffRole } from '@/lib/api';
import { count } from '@/lib/format';
import { apiErrorOf, fill, label, t } from '@/lib/strings';

const copy = t.sections.staffRoles;

/**
 * أدوار موظفي الشركاء — the super admin names the roles, partners assign them
 * (Bashar, 2026-08-23).
 *
 * ## The checkbox list is DATA, not markup
 *
 * `assignable` arrives from `GET /admin/staff-roles/assignable`, which serves the same constant
 * the API validates against — and the API REJECTS an unknown capability rather than filtering it.
 * So a hand-written list here would offer capabilities the server refuses, and the operator would
 * discover the disagreement as an unexplained 400 on a role they had already named.
 *
 * The Arabic names come from a catalogue keyed by the permission string, so a capability added to
 * the allow-list before it is translated renders as its raw identifier — visibly missing rather
 * than silently absent from the list.
 *
 * ## Why one component holds create, edit and delete
 *
 * They are the same form. An edit is a create with the fields pre-filled and a different verb, and
 * `PUT` carries the WHOLE role — so the editing form has to be the one that knows every capability,
 * not a diff against something. Two components would be two places for the capability list to be
 * assembled, which is the thing this file exists to keep singular.
 */
export function StaffRolesManager({
  roles,
  assignable,
}: {
  readonly roles: readonly StaffRole[];
  readonly assignable: readonly string[];
}) {
  const router = useRouter();
  const formId = useId();

  /** `null` = nothing open, `'new'` = the create form, otherwise the role being edited. */
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  function start(role: StaffRole | 'new'): void {
    setError(null);
    setConfirming(null);

    if (role === 'new') {
      setOpen('new');
      setName('');
      setPicked([]);

      return;
    }

    setOpen(role.id);
    setName(role.name);
    /*
      Filtered against `assignable` on the way IN as well as on the way out. A role stored before a
      capability was withdrawn from the allow-list still carries it in the database; showing it as a
      ticked box the form cannot submit would be a control that refuses its own initial state.
    */
    setPicked(role.permissions.filter((p) => assignable.includes(p)));
  }

  function toggle(permission: string): void {
    setPicked((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    );
  }

  async function send(method: string, path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);

        setError(apiErrorOf(payload));
        setBusy(false);

        return false;
      }

      setOpen(null);
      setConfirming(null);
      router.refresh();
      setBusy(false);

      return true;
    } catch {
      setError(copy.unreachable);
      setBusy(false);

      return false;
    }
  }

  async function submit(): Promise<void> {
    if (busy) return;

    if (picked.length === 0) {
      setError(copy.capabilitiesRequired);

      return;
    }

    const body = { name: name.trim(), permissions: [...picked] };

    await (open === 'new'
      ? send('POST', '/api/staff-roles', body)
      : send('PUT', `/api/staff-roles/${encodeURIComponent(open ?? '')}`, body));
  }

  return (
    <div className="grid gap-4">
      {/*
        `intro` only. `scopeNote` is rendered by the page's `FootNote`, which is where every other
        section puts the sentence explaining what the screen does NOT do — and it was appearing in
        both places, so the panel said the same paragraph twice a few lines apart.
      */}
      <p className="text-[12.5px] leading-relaxed text-muted">{copy.intro}</p>

      {error ? (
        <p role="alert" className="text-[12.5px] text-bad">
          {error}
        </p>
      ) : null}

      {open === null ? (
        <div className="flex">
          <button
            type="button"
            onClick={() => start('new')}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-ok/40 px-4 py-2 text-[12.5px] font-semibold text-ok hover:bg-ok/5 lg:min-h-0"
          >
            {copy.create}
          </button>
        </div>
      ) : (
        <form
          className="grid gap-3 rounded-lg border border-ok/30 bg-ok/5 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <label
              htmlFor={`${formId}-name`}
              className="text-[11.5px] font-semibold text-muted"
            >
              {copy.nameLabel}
            </label>
            <input
              id={`${formId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
              maxLength={60}
              aria-describedby={`${formId}-name-hint`}
              className="min-h-10 rounded-lg border border-line bg-field px-3 py-2.5 text-[13px] text-text lg:min-h-0"
            />
            <span
              id={`${formId}-name-hint`}
              className="text-[10.5px] font-normal text-faint"
            >
              {copy.nameHint}
            </span>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[11.5px] font-semibold text-muted">
              {copy.capabilitiesLabel}
            </legend>

            {/*
              Grouped, because sixty-three checkboxes in one column is a wall rather than a form.

              The five domains come from `groupPermissions` in `@safra/contracts` — the same
              taxonomy `permissions.ts` already uses in its own section comments — so this screen
              and the partner-employee one cannot file the same permission under different
              headings. Grouping by the `resource.action` prefix was the obvious alternative and
              measured wrong: 63 permissions carry 31 prefixes, which is the flat list again.

              An unmapped resource lands in «أخرى» and is still offered. Dropping it would make a
              capability the API accepts ungrantable from the only screen that grants it, and an
              absent checkbox looks like a shorter list rather than a bug.
            */}
            <div className="grid gap-4">
              {groupPermissions(assignable).map(({ group, permissions }) => (
                <fieldset key={group} className="grid gap-2">
                  <legend className="mb-1 text-[11px] font-bold text-faint">
                    {label(copy.group, group)}
                  </legend>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {permissions.map((permission) => (
                      <label
                        key={permission}
                        className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-text2"
                      >
                        <input
                          type="checkbox"
                          checked={picked.includes(permission)}
                          onChange={() => toggle(permission)}
                          className="size-[15px] cursor-pointer accent-[#3E9E6E]"
                        />
                        {label(copy.capability, permission)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-ok px-4 py-2 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0"
            >
              {busy ? copy.saving : open === 'new' ? copy.create : copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(null);
                setError(null);
              }}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-sm text-muted lg:min-h-0"
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      )}

      {roles.length === 0 ? (
        <p className="text-[12.5px] text-faint">{copy.none}</p>
      ) : (
        <ul className="grid gap-2">
          {roles.map((role) => (
            <li
              key={role.id}
              className="rounded-lg border border-line bg-card px-4 py-3"
              data-staff-role={role.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-text">{role.name}</span>
                <span className="flex items-center gap-2 text-[11.5px] text-faint">
                  {role.isSystem ? (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint2">
                      {copy.systemRole}
                    </span>
                  ) : null}
                  {copy.colEmployees}: {count(role.employeeCount)}
                </span>
              </div>

              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                {role.permissions.map((p) => label(copy.capability, p)).join(' · ')}
              </p>

              {/*
                A seeded role offers NO control at all, and says why.

                «مدير عام» cannot be edited or withdrawn — otherwise a super admin edits their own
                role, removes `staff.manage`, and nobody can undo it. The API refuses both with
                `staff_role.system`; showing the buttons and letting it refuse would teach the
                operator that controls on this screen sometimes do nothing, and that lesson
                generalises to every other button here.

                Assigning somebody TO it is still normal and happens on «الموظفون», which the note
                says — so the absence of controls does not read as the role being frozen out.
              */}
              {role.isSystem ? (
                <p className="mt-2.5 text-[11.5px] leading-relaxed text-faint2">
                  {copy.systemRoleNote}
                </p>
              ) : (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => start(role)}
                    className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-ok/50 hover:text-ok lg:min-h-0"
                  >
                    {copy.edit}
                  </button>

                  {/*
                  Held by somebody → say so instead of offering a button the API will refuse.

                  `employeeCount` is on the row for exactly this. The alternative — offer it, let
                  the server answer `staff_role.in_use` — teaches the operator that controls on
                  this screen sometimes do nothing.
                */}
                  {role.employeeCount > 0 ? (
                    <span className="text-[11.5px] leading-relaxed text-gold-ink">
                      {copy.inUse}
                    </span>
                  ) : confirming === role.id ? (
                    <>
                      <span className="text-[11.5px] leading-relaxed text-bad">
                        {fill(copy.confirmRemove, { name: role.name })}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            'DELETE',
                            `/api/staff-roles/${encodeURIComponent(role.id)}`,
                          )
                        }
                        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-bad px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-60 lg:min-h-0"
                      >
                        {busy ? copy.removing : copy.confirmRemove2}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 text-xs text-muted lg:min-h-0"
                      >
                        {copy.cancel}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(role.id)}
                      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:border-bad/50 hover:text-bad lg:min-h-0"
                    >
                      {copy.remove}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
