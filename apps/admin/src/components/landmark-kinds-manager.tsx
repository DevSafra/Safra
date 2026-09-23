'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Modal, useConfirm } from '@safra/ui';

import type { LandmarkKind } from '@/lib/api';
import { LandmarkMark } from '@/components/landmark-mark';
import { StatusPill } from '@/components/admin-table';
import { apiErrorOf, t } from '@/lib/strings';

/**
 * فئات المعالم — the categories, and with them the ICONS.
 *
 * ## Unpaginated, and that is the documented exception
 *
 * Eight rows, bounded by the business rather than by usage — the same reasoning
 * `geo-bounds.integration.test.ts` records for countries and currencies. A platform with fifty
 * categories of place has a taxonomy problem, not a paging problem, and
 * `landmark-bounds.integration.test.ts` fails if this outgrows a screen rather than leaving
 * somebody to discover it.
 *
 * ## The icon is edited as PATH DATA, and the preview is the real component
 *
 * One `d` per line, drawn through `LandmarkMark` — the same component the customer site uses —
 * so what an operator sees while typing is exactly what a guest gets. A preview rendered by
 * anything else is a second implementation that agrees until it does not.
 */
export function LandmarkKindsManager({
  kinds,
}: {
  readonly kinds: readonly LandmarkKind[];
}) {
  const [editing, setEditing] = useState<LandmarkKind | 'new' | null>(null);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-16 font-bold text-text">{t.sections.landmarks.kindsTitle}</h2>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="min-h-10 cursor-pointer rounded-lg border border-line px-3 text-13 font-bold text-text transition-colors hover:border-gold lg:min-h-0 lg:py-1.5"
        >
          {t.sections.landmarks.addKind}
        </button>
      </div>
      <p className="mt-1 text-13 text-muted">{t.sections.landmarks.kindsNote}</p>

      {/*
        A wide table keeps its width and scrolls INSIDE its own box. Squeezing six columns of
        Arabic into 320px is not responsive, it is unreadable.
      */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-start">
          <thead>
            <tr className="border-b border-line text-12 text-muted">
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.kindIcon}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.kindCode}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.nameAr}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.kindLandmarks}
              </th>
              <th className="p-2 text-start font-normal">
                {t.sections.landmarks.colStatus}
              </th>
              <th className="p-2 text-start font-normal" />
            </tr>
          </thead>
          <tbody>
            {kinds.map((kind) => (
              <tr key={kind.code} className="border-b border-line/60 text-14 text-text">
                <td className="p-2">
                  {kind.iconPaths.length > 0 ? (
                    <LandmarkMark paths={kind.iconPaths} className="text-gold-read" />
                  ) : (
                    <span className="text-12 text-faint">
                      {t.sections.landmarks.iconEmpty}
                    </span>
                  )}
                </td>
                <td className="p-2 font-mono text-13 text-faint">{kind.code}</td>
                <td className="p-2">{kind.nameAr}</td>
                <td className="p-2 tabular-nums">{kind.landmarks}</td>
                <td className="p-2">
                  <StatusPill tone={kind.isActive ? 'ok' : 'faint'}>
                    {kind.isActive
                      ? t.sections.landmarks.active
                      : t.sections.landmarks.inactive}
                  </StatusPill>
                </td>
                <td className="p-2 text-end">
                  <button
                    type="button"
                    onClick={() => setEditing(kind)}
                    className="min-h-10 cursor-pointer text-13 font-bold text-gold-read underline-offset-4 hover:underline lg:min-h-0"
                  >
                    {t.sections.landmarks.edit}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <KindEditor
          kind={editing === 'new' ? null : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

/** The create/edit sheet for one kind. */
function KindEditor({
  kind,
  onDone,
}: {
  readonly kind: LandmarkKind | null;
  readonly onDone: () => void;
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();

  const [code, setCode] = useState(kind?.code ?? '');
  const [nameAr, setNameAr] = useState(kind?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(kind?.nameEn ?? '');
  const [nameDe, setNameDe] = useState(kind?.nameDe ?? '');
  /* One `d` per LINE. A textarea is the shape of the data: a list of strokes. */
  const [icon, setIcon] = useState((kind?.iconPaths ?? []).join('\n'));
  const [isActive, setActive] = useState(kind?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paths = icon
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    const body = kind
      ? { nameAr, nameEn, nameDe, iconPaths: paths, isActive }
      : { code, nameAr, nameEn, nameDe, iconPaths: paths };

    try {
      const response = await fetch(
        kind
          ? `/api/landmarks/kinds/${encodeURIComponent(kind.code)}`
          : '/api/landmarks/kinds',
        {
          method: kind ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        /*
          `apiErrorOf`, never `payload.message`. The API answers a CODE and an English sentence
          for the logs; printing that sentence is how English refusals reached an Arabic-only
          console four times before `no-english-refusals.test.ts` started sweeping for it.
        */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);
        return;
      }

      router.refresh();
      onDone();
    } catch {
      setError(t.sections.landmarks.failed);
      setBusy(false);
    }
  }

  async function archive(): Promise<void> {
    if (!kind || busy) return;

    const go = await ask({
      title: t.sections.landmarks.archiveKindTitle,
      message: t.sections.landmarks.archiveKindBody,
      confirmLabel: t.sections.landmarks.archive,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/landmarks/kinds/${encodeURIComponent(kind.code)}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        /*
          `apiErrorOf`, never `payload.message`. The API answers a CODE and an English sentence
          for the logs; printing that sentence is how English refusals reached an Arabic-only
          console four times before `no-english-refusals.test.ts` started sweeping for it.
        */
        setError(apiErrorOf(await response.json().catch(() => null)));
        setBusy(false);
        return;
      }

      router.refresh();
      onDone();
    } catch {
      setError(t.sections.landmarks.failed);
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        onClose={onDone}
        title={
          kind ? t.sections.landmarks.editKindTitle : t.sections.landmarks.addKindTitle
        }
      >
        <div className="grid gap-3">
          {kind ? null : (
            <Field
              label={t.sections.landmarks.kindCode}
              hint={t.sections.landmarks.kindCodeHint}
              value={code}
              onChange={setCode}
            />
          )}
          <Field
            label={t.sections.landmarks.nameAr}
            value={nameAr}
            onChange={setNameAr}
          />
          <Field
            label={t.sections.landmarks.nameEn}
            value={nameEn}
            onChange={setNameEn}
          />
          <Field
            label={t.sections.landmarks.nameDe}
            value={nameDe}
            onChange={setNameDe}
          />

          <label className="grid gap-1 text-13 text-muted">
            {t.sections.landmarks.iconPaths}
            {/*
              No `dir` at all, which gives the page's own direction — the rule for a field a
              person types into. Path data is a Latin RUN and the bidi algorithm lays one out
              correctly inside an RTL field without being told; `dir="ltr"` would move the
              field's start edge away from its own label.
            */}
            <textarea
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-field p-2 font-mono text-13 text-text"
            />
            <span className="text-12 text-faint">
              {t.sections.landmarks.iconPathsHint}
            </span>
          </label>

          <div className="flex items-center gap-3">
            <span className="text-13 text-muted">{t.sections.landmarks.iconPreview}</span>
            {/*
              The SAME component the customer site draws with, so the preview cannot disagree
              with the shipped icon. A preview rendered by anything else is a second
              implementation that agrees until it does not.
            */}
            {paths.length > 0 ? (
              <LandmarkMark paths={paths} size="2rem" className="text-gold-read" />
            ) : (
              <span className="text-12 text-faint">{t.sections.landmarks.iconEmpty}</span>
            )}
          </div>

          {kind ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-14 text-text">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setActive(event.target.checked)}
                className="size-4 shrink-0 accent-gold"
              />
              {t.sections.landmarks.kindActiveLabel}
            </label>
          ) : null}

          {error ? <p className="text-13 text-bad">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="min-h-10 cursor-pointer rounded-lg bg-gold px-4 text-13 font-extrabold text-ink disabled:opacity-50 lg:min-h-0 lg:py-2"
            >
              {t.sections.dialog.confirm}
            </button>
            {kind ? (
              <button
                type="button"
                onClick={() => void archive()}
                disabled={busy}
                className="min-h-10 cursor-pointer rounded-lg border border-bad/50 px-4 text-13 font-bold text-bad disabled:opacity-50 lg:min-h-0 lg:py-2"
              >
                {t.sections.landmarks.archive}
              </button>
            ) : null}
          </div>
        </div>
      </Modal>
      {dialog}
    </>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}) {
  return (
    <label className="grid gap-1 text-13 text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-lg border border-line bg-field px-3 text-14 text-text"
      />
      {hint ? <span className="text-12 text-faint">{hint}</span> : null}
    </label>
  );
}
