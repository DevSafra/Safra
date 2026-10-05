'use client';

import { useRouter } from 'next/navigation';
import { AddButton } from '@/components/add-button';
import { useState } from 'react';

import { useConfirm } from '@safra/ui';

import { AdminTable, StatusPill, type AdminColumn } from '@/components/admin-table';
import { Actions, CheckboxField, Field, Panel, Prose, Row } from '@/components/geo-form';
import type { FaqQuestionRow, GeneralFaqRow } from '@/lib/api';
import { count } from '@/lib/format';
import { apiErrorOf, t } from '@/lib/strings';
import { wholeNumber } from '@/lib/numeric-input';

/**
 * الأسئلة الشائعة — both FAQs, authored here (Bashar, 2026-09-28).
 *
 * ## Why two managers and not one with a toggle
 *
 * They look alike on screen and differ in the one way that matters: a **question** is answered by
 * the PARTNER about their own listing; a **general entry** is answered by SAFRA. An operator who
 * confuses the two publishes an answer in somebody else's voice, so they are two panels with two
 * headings and two notes rather than one panel with a `kind` field — which would read as one thing
 * with a setting.
 *
 * ## Retiring and deleting
 *
 * The pair كتالوج المنصّة draws, for its reasons. Retiring a question stops it being ASKED and
 * leaves every answer already given on the public page, because SAFRA stopping asking is not the
 * partner un-saying it. Deleting is for a question added by mistake, and the API refuses it once
 * anything has answered — which is why `answers` is a column rather than something a reader has to
 * discover from a refusal.
 *
 * ## Unpaginated, like the panels beside it
 *
 * The documented exception `geo-bounds.integration.test.ts` holds: reference data bounded by the
 * business rather than by usage. An FAQ is read top to bottom — past a screenful it has stopped
 * being frequently-asked — and that test names the work if either set outgrows one.
 */
export function FaqQuestionManager({
  questions,
}: {
  readonly questions: readonly FaqQuestionRow[];
}) {
  const c = t.sections.catalogue;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = questions.find((one) => one.id === editing) ?? null;

  const columns: readonly AdminColumn<FaqQuestionRow>[] = [
    {
      key: 'question',
      header: c.faqColQuestion,
      render: (row) => <span className="font-semibold text-text">{row.questionAr}</span>,
    },
    {
      key: 'en',
      header: c.faqQuestionEn,
      render: (row) => (
        <span className="text-text2">{row.questionEn ?? c.faqQuestionEnMissing}</span>
      ),
    },
    {
      key: 'required',
      header: c.faqColRequired,
      render: (row) => (
        /*
          Not a status, but on the same screen as «موقوف»'s faint grey, so «اختياري» takes a hue
          nothing else on الكتالوج uses (audit 2026-10-04: the two read alike).
        */
        <StatusPill tone={row.isRequired ? 'warn' : 'indigo'}>
          {row.isRequired ? c.faqRequired : c.faqOptional}
        </StatusPill>
      ),
    },
    {
      key: 'answers',
      header: c.faqColAnswers,
      render: (row) => <span className="text-text2">{count(row.answers)}</span>,
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
          {row.isActive ? c.active : c.inactive}
        </StatusPill>
      ),
    },
    {
      key: 'edit',
      header: c.edit,
      render: (row) => (
        <button
          type="button"
          data-faq-question-edit={row.id}
          onClick={() => {
            setAdding(false);
            setEditing(editing === row.id ? null : row.id);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-13 text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold-read"
        >
          {c.edit}
        </button>
      ),
    },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-16 font-extrabold text-gold-read">{c.faqTitle}</h2>
        <span className="ms-auto">
          <AddButton
            label={c.faqAdd}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            expanded={adding}
            attribute="data-faq-question-add"
          />
        </span>
      </div>

      <p className="text-13 leading-relaxed text-faint">{c.faqNote}</p>

      {adding ? <QuestionForm onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...questions]}
        template=".9fr .7fr .4fr .35fr .4fr .35fr"
        rowKey={(row) => row.id}
        minWidth={760}
        empty={c.faqEmpty}
      />

      {open ? (
        <QuestionForm key={open.id} question={open} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function QuestionForm({
  question,
  onClose,
}: {
  readonly question?: FaqQuestionRow | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.catalogue;
  const { ask, dialog } = useConfirm();

  const [questionAr, setQuestionAr] = useState(question?.questionAr ?? '');
  const [questionEn, setQuestionEn] = useState(question?.questionEn ?? '');
  const [questionDe, setQuestionDe] = useState(question?.questionDe ?? '');
  const [isRequired, setRequired] = useState(question?.isRequired ?? false);
  const [isActive, setActive] = useState(question?.isActive ?? true);
  const [position, setPosition] = useState(String(question?.position ?? 0));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const body = {
        questionAr,
        questionEn: questionEn || null,
        questionDe: questionDe || null,
        isRequired,
        position: wholeNumber(position) ?? 0,
        ...(question ? { isActive } : {}),
      };

      const response = await fetch(
        question ? `/api/faq/questions/${question.id}` : '/api/faq/questions',
        {
          method: question ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!question) return;

    const go = await ask({
      title: c.remove,
      message: c.faqRetireHint,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/faq/questions/${question.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel
      heading={question ? c.edit : c.faqAdd}
      marker={question?.id ?? 'add'}
      attribute="data-faq-question-form"
    >
      <Row>
        <Field label={c.faqQuestionAr} value={questionAr} onChange={setQuestionAr} />
        <Field
          label={c.faqPosition}
          value={position}
          onChange={setPosition}
          inputMode="numeric"
        />
      </Row>
      <Row>
        <Field label={c.faqQuestionEn} value={questionEn} onChange={setQuestionEn} />
        <Field
          label={c.faqQuestionDe}
          value={questionDe}
          onChange={setQuestionDe}
          hint={c.faqLocaleHint}
        />
      </Row>

      <CheckboxField
        label={c.faqRequiredLabel}
        checked={isRequired}
        onChange={setRequired}
      />

      {question ? (
        <CheckboxField
          label={c.active}
          checked={isActive}
          onChange={setActive}
          hint={c.faqRetireHint}
        />
      ) : null}

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={questionAr.trim() !== ''}
        saveLabel={question ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={question ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(question
          ? {
              deleteLabel: c.remove,
              deletingLabel: c.removing,
              onDelete: () => void remove(),
            }
          : {})}
        onSave={() => void save()}
        onClose={onClose}
      />

      {dialog}
    </Panel>
  );
}

/** SAFRA's own questions and answers, identical on every property page. */
export function GeneralFaqManager({
  entries,
}: {
  readonly entries: readonly GeneralFaqRow[];
}) {
  const c = t.sections.catalogue;

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const open = entries.find((one) => one.id === editing) ?? null;

  const columns: readonly AdminColumn<GeneralFaqRow>[] = [
    {
      key: 'question',
      header: c.faqColQuestion,
      render: (row) => <span className="font-semibold text-text">{row.questionAr}</span>,
    },
    {
      key: 'answer',
      header: c.faqAnswerAr,
      render: (row) => <span className="line-clamp-2 text-text2">{row.answerAr}</span>,
    },
    {
      key: 'status',
      header: c.colStatus,
      render: (row) => (
        <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
          {row.isActive ? c.active : c.inactive}
        </StatusPill>
      ),
    },
    {
      key: 'edit',
      header: c.edit,
      render: (row) => (
        <button
          type="button"
          data-faq-general-edit={row.id}
          onClick={() => {
            setAdding(false);
            setEditing(editing === row.id ? null : row.id);
          }}
          className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-13 text-muted transition-colors hover:border-[rgba(var(--goldA),0.45)] hover:text-gold-read"
        >
          {c.edit}
        </button>
      ),
    },
  ];

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2 className="text-16 font-extrabold text-gold-read">{c.faqGeneralTitle}</h2>
        <span className="ms-auto">
          <AddButton
            label={c.faqGeneralAdd}
            onClick={() => {
              setEditing(null);
              setAdding(!adding);
            }}
            expanded={adding}
            attribute="data-faq-general-add"
          />
        </span>
      </div>

      <p className="text-13 leading-relaxed text-faint">{c.faqGeneralNote}</p>

      {adding ? <GeneralForm onClose={() => setAdding(false)} /> : null}

      <AdminTable
        columns={columns}
        rows={[...entries]}
        template="1fr 1.2fr .4fr .35fr"
        rowKey={(row) => row.id}
        minWidth={760}
        empty={c.faqGeneralEmpty}
      />

      {open ? (
        <GeneralForm key={open.id} entry={open} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function GeneralForm({
  entry,
  onClose,
}: {
  readonly entry?: GeneralFaqRow | undefined;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const c = t.sections.catalogue;
  const { ask, dialog } = useConfirm();

  const [questionAr, setQuestionAr] = useState(entry?.questionAr ?? '');
  const [questionEn, setQuestionEn] = useState(entry?.questionEn ?? '');
  const [questionDe, setQuestionDe] = useState(entry?.questionDe ?? '');
  const [answerAr, setAnswerAr] = useState(entry?.answerAr ?? '');
  const [answerEn, setAnswerEn] = useState(entry?.answerEn ?? '');
  const [answerDe, setAnswerDe] = useState(entry?.answerDe ?? '');
  const [isActive, setActive] = useState(entry?.isActive ?? true);
  const [position, setPosition] = useState(String(entry?.position ?? 0));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const body = {
        questionAr,
        questionEn: questionEn || null,
        questionDe: questionDe || null,
        answerAr,
        answerEn: answerEn || null,
        answerDe: answerDe || null,
        position: wholeNumber(position) ?? 0,
        ...(entry ? { isActive } : {}),
      };

      const response = await fetch(
        entry ? `/api/faq/general/${entry.id}` : '/api/faq/general',
        {
          method: entry ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!entry) return;

    const go = await ask({
      title: c.remove,
      message: c.faqGeneralNote,
      confirmLabel: t.sections.dialog.confirm,
      cancelLabel: t.sections.dialog.cancel,
      tone: 'danger',
    });

    if (!go) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/faq/general/${entry.id}`, { method: 'DELETE' });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel
      heading={entry ? c.edit : c.faqGeneralAdd}
      marker={entry?.id ?? 'add'}
      attribute="data-faq-general-form"
    >
      <Row>
        <Field label={c.faqQuestionAr} value={questionAr} onChange={setQuestionAr} />
        <Field
          label={c.faqPosition}
          value={position}
          onChange={setPosition}
          inputMode="numeric"
        />
      </Row>
      <Row>
        <Field label={c.faqQuestionEn} value={questionEn} onChange={setQuestionEn} />
        <Field label={c.faqQuestionDe} value={questionDe} onChange={setQuestionDe} />
      </Row>

      <Prose label={c.faqAnswerAr} value={answerAr} onChange={setAnswerAr} />
      <Row>
        <Prose label={c.faqAnswerEn} value={answerEn} onChange={setAnswerEn} />
        <Prose
          label={c.faqAnswerDe}
          value={answerDe}
          onChange={setAnswerDe}
          hint={c.faqLocaleHint}
        />
      </Row>

      {entry ? (
        <CheckboxField label={c.active} checked={isActive} onChange={setActive} />
      ) : null}

      <Actions
        busy={busy}
        deleting={deleting}
        error={error}
        ready={questionAr.trim() !== '' && answerAr.trim() !== ''}
        saveLabel={entry ? t.sections.geo.save : t.sections.geo.create}
        busyLabel={entry ? t.sections.geo.saving : t.sections.geo.creating}
        cancelLabel={t.sections.geo.cancel}
        {...(entry
          ? {
              deleteLabel: c.remove,
              deletingLabel: c.removing,
              onDelete: () => void remove(),
            }
          : {})}
        onSave={() => void save()}
        onClose={onClose}
      />

      {dialog}
    </Panel>
  );
}
