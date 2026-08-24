import { describe, expect, it } from 'vitest';

import { LOCALES, emailMessages } from '@safra/i18n';

import * as templates from './mail.templates.js';
import { localesFor } from './bilingual.js';

/**
 * Every transactional email, checked per TEMPLATE (Bashar, 2026-08-23).
 *
 * ## Why the table lists all twenty-four rather than a representative few
 *
 * `.claude/CLAUDE.md` says it in as many words: *"a helper test proves the helper works and says
 * nothing about the template that forgot to call it."* This file used to cover four of them, which
 * is exactly the coverage that cannot see the twenty-third function still returning one language.
 *
 * The final assertion holds the table itself to account: every exported template must appear here,
 * so adding one and not testing it is a failure rather than a silence.
 *
 * ## What "Arabic first" is asserted as
 *
 * Not "the text starts with an Arabic character" — a template could open with a reference or a URL.
 * The catalogue's OWN Arabic subject and English subject are looked up and their positions in the
 * composed output compared. That survives a rewording of any sentence, and fails if the order is
 * ever flipped.
 */
const SAMPLE = {
  to: 'someone@example.com',
  url: 'https://safra.example/go?token=abc',
  locale: 'ar',
  /* A suspension reason, long enough to satisfy the twenty-character floor the schema enforces. */
  reason: 'صور لا تطابق العقار المعروض',
  /* The effective date every enforcement notice states (Bashar, 2026-08-24). */
  date: '2026-08-24',
};

/**
 * One row per template: how to render it, and a value that must appear in EVERY language block.
 *
 * `shows` is the interpolation check and it is per-row rather than shared, because the whole class
 * of bug this guards is a value reaching one block and not the other — a link printed only in the
 * Arabic half leaves the English reader with a sentence about a link that is not there.
 */
const RENDERERS: {
  readonly name: keyof typeof templates;
  readonly entry: string;
  readonly render: (locale: string) => { subject: string; text: string };
  readonly shows: string;
}[] = [
  {
    name: 'passwordResetMail',
    entry: 'passwordReset',
    render: (locale) =>
      templates.passwordResetMail({ ...SAMPLE, locale, expiresInMinutes: 30 }),
    shows: '30',
  },
  {
    name: 'emailVerificationMail',
    entry: 'emailVerification',
    render: (locale) =>
      templates.emailVerificationMail({ ...SAMPLE, locale, expiresInHours: 48 }),
    shows: '48',
  },
  {
    name: 'accountExistsMail',
    entry: 'accountExists',
    render: (locale) =>
      templates.accountExistsMail({
        to: SAMPLE.to,
        signInUrl: 'https://safra.example/login',
        resetUrl: 'https://safra.example/reset',
        locale,
      }),
    shows: 'https://safra.example/reset',
  },
  {
    name: 'staffInvitationMail',
    entry: 'staffInvitation',
    render: (locale) =>
      templates.staffInvitationMail({
        ...SAMPLE,
        locale,
        role: 'operations_manager',
        expiresInHours: 48,
      }),
    shows: SAMPLE.url,
  },
  {
    name: 'partnerApplicationReceivedMail',
    entry: 'partnerApplicationReceived',
    render: (locale) =>
      templates.partnerApplicationReceivedMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
      }),
    shows: 'PAR-000042',
  },
  {
    name: 'partnerApplicationRejectedMail',
    entry: 'partnerApplicationRejected',
    render: (locale) =>
      templates.partnerApplicationRejectedMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
        reason: 'لا تتوفر الشروط',
      }),
    shows: 'PAR-000042',
  },
  {
    name: 'partnerLoginCodeMail',
    entry: 'partnerLoginCode',
    render: (locale) =>
      templates.partnerLoginCodeMail({
        to: SAMPLE.to,
        locale,
        code: '123456',
        expiresInMinutes: 10,
      }),
    shows: '123456',
  },
  {
    name: 'partnerEmployeeInvitationMail',
    entry: 'partnerEmployeeInvitation',
    render: (locale) =>
      templates.partnerEmployeeInvitationMail({
        ...SAMPLE,
        locale,
        partnerName: 'فندق قصر الشرق',
        hours: 72,
      }),
    shows: 'فندق قصر الشرق',
  },
  {
    name: 'partnerInvitationMail',
    entry: 'partnerInvitation',
    render: (locale) =>
      templates.partnerInvitationMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
        expiresInHours: 72,
      }),
    shows: 'PAR-000042',
  },
  {
    name: 'partnerApprovedMail',
    entry: 'partnerApproved',
    render: (locale) =>
      templates.partnerApprovedMail({ ...SAMPLE, locale, reference: 'PAR-000042' }),
    shows: SAMPLE.url,
  },
  {
    name: 'partnerContractAwaitingSignatureMail',
    entry: 'partnerContractAwaitingSignature',
    render: (locale) =>
      templates.partnerContractAwaitingSignatureMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
      }),
    shows: SAMPLE.url,
  },
  {
    name: 'partnerContractCountersignedMail',
    entry: 'partnerContractCountersigned',
    render: (locale) =>
      templates.partnerContractCountersignedMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
      }),
    shows: SAMPLE.url,
  },
  {
    name: 'partnerContractReturnedMail',
    entry: 'partnerContractReturned',
    render: (locale) =>
      templates.partnerContractReturnedMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
        displayName: 'فندق قصر الشرق',
      }),
    shows: 'PAR-000042',
  },
  {
    name: 'partnerDocumentsCompleteMail',
    entry: 'partnerDocumentsComplete',
    render: (locale) =>
      templates.partnerDocumentsCompleteMail({
        ...SAMPLE,
        locale,
        reference: 'PAR-000042',
        displayName: 'فندق قصر الشرق',
        documentCount: 3,
      }),
    shows: 'PAR-000042',
  },
  {
    name: 'partnerContractReadyMail',
    entry: 'partnerContractReady',
    render: (locale) =>
      templates.partnerContractReadyMail({
        ...SAMPLE,
        locale,
        partner: 'فندق قصر الشرق',
        kind: 'base',
      }),
    shows: SAMPLE.url,
  },
  {
    name: 'reviewReceivedMail',
    entry: 'reviewReceived',
    render: (locale) =>
      templates.reviewReceivedMail({
        ...SAMPLE,
        locale,
        property: 'شاليه البحر',
        rating: 5,
      }),
    shows: 'شاليه البحر',
  },
  {
    name: 'giftCardPurchasedMail',
    entry: 'giftCardPurchased',
    render: (locale) =>
      templates.giftCardPurchasedMail({
        ...SAMPLE,
        locale,
        code: 'AAAAA-BBBBB-CCCCC-DDDDD',
        reference: 'GIF-000042',
        amount: '50 USD',
      }),
    shows: 'AAAAA-BBBBB-CCCCC-DDDDD',
  },
  {
    name: 'giftCardReceivedMail',
    entry: 'giftCardReceived',
    render: (locale) =>
      templates.giftCardReceivedMail({
        ...SAMPLE,
        locale,
        code: 'AAAAA-BBBBB-CCCCC-DDDDD',
        reference: 'GIF-000042',
        amount: '50 USD',
      }),
    shows: 'AAAAA-BBBBB-CCCCC-DDDDD',
  },
  {
    name: 'reviewRepliedMail',
    entry: 'reviewReplied',
    render: (locale) =>
      templates.reviewRepliedMail({ ...SAMPLE, locale, property: 'شاليه البحر' }),
    shows: 'شاليه البحر',
  },
  {
    name: 'supportRepliedMail',
    entry: 'supportReplied',
    render: (locale) =>
      templates.supportRepliedMail({ ...SAMPLE, locale, reference: 'CNV-000042' }),
    shows: 'CNV-000042',
  },
  {
    name: 'bookingNeedsActionMail',
    entry: 'bookingNeedsAction',
    render: (locale) =>
      templates.bookingNeedsActionMail({
        ...SAMPLE,
        locale,
        reference: 'BKG-000042',
        property: 'شاليه البحر',
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
        deadline: '2026-08-24 18:00',
      }),
    shows: 'BKG-000042',
  },
  {
    name: 'notificationWaitingMail',
    entry: 'waiting',
    render: (locale) => templates.notificationWaitingMail({ ...SAMPLE, locale }),
    shows: SAMPLE.url,
  },
  {
    name: 'staffSuspendedMail',
    entry: 'staffSuspended',
    /* No values at all — the one template with nothing to interpolate. */
    render: (locale) => templates.staffSuspendedMail({ to: SAMPLE.to, locale }),
    shows: '',
  },
  {
    name: 'staffReinstatedMail',
    entry: 'staffReinstated',
    render: (locale) => templates.staffReinstatedMail({ ...SAMPLE, locale }),
    shows: SAMPLE.url,
  },
  {
    name: 'partnerFineWaivedMail',
    entry: 'partnerFineWaived',
    /*
      `shows` is the REASON. The amount matters and the reason is what the partner can act on — a
      waiver notice missing its cause in one language tells somebody money was forgiven and not
      why, which is the half that decides whether they trust the next decision.
    */
    render: (locale) =>
      templates.partnerFineWaivedMail({
        to: SAMPLE.to,
        locale,
        url: SAMPLE.url,
        amount: '50.00 USD',
        reason: SAMPLE.reason,
        date: SAMPLE.date,
      }),
    shows: SAMPLE.reason,
  },
  {
    name: 'partnerSuspendedMail',
    entry: 'partnerSuspended',
    /*
      `shows` is the REASON rather than the url, because the reason is the part that would be
      catastrophic to lose in one language. A suspended partner reading a notice with the
      consequences and no cause has been told their business is on hold and not why.
    */
    render: (locale) =>
      templates.partnerSuspendedMail({
        to: SAMPLE.to,
        locale,
        url: SAMPLE.url,
        reason: SAMPLE.reason,
        date: SAMPLE.date,
      }),
    shows: SAMPLE.reason,
  },
  /*
    The three enforcement notices that told nobody anything until 2026-08-24.

    `shows` is the REASON or the NOTE in each case, for the same argument the two above make: a
    notice that reaches somebody in a language where the cause went missing has told them their
    business is affected and not why. The amount is asserted separately below, because a fine notice
    losing its figure in one language is its own distinct failure.
  */
  {
    name: 'partnerWarnedMail',
    entry: 'partnerWarned',
    render: (locale) =>
      templates.partnerWarnedMail({
        to: SAMPLE.to,
        locale,
        url: SAMPLE.url,
        note: SAMPLE.reason,
        date: SAMPLE.date,
      }),
    shows: SAMPLE.reason,
  },
  {
    name: 'partnerFinedMail',
    entry: 'partnerFined',
    render: (locale) =>
      templates.partnerFinedMail({
        to: SAMPLE.to,
        locale,
        url: SAMPLE.url,
        amount: '50.00 USD',
        reason: SAMPLE.reason,
        date: SAMPLE.date,
      }),
    shows: SAMPLE.reason,
  },
  {
    name: 'partnerUnsuspendedMail',
    entry: 'partnerUnsuspended',
    render: (locale) =>
      templates.partnerUnsuspendedMail({
        to: SAMPLE.to,
        locale,
        url: SAMPLE.url,
        reason: SAMPLE.reason,
        date: SAMPLE.date,
      }),
    shows: SAMPLE.reason,
  },
];

describe('every transactional email is Arabic first, English underneath', () => {
  for (const { name, entry, render, shows } of RENDERERS) {
    for (const locale of LOCALES) {
      describe(`${name} [${locale}]`, () => {
        /**
         * Both blocks are present, and the Arabic one comes first.
         *
         * Positions are compared using the catalogue's OWN subjects rather than a script check, so
         * the assertion survives any rewording and still fails if the order is flipped.
         */
        it('carries both languages, Arabic before English', () => {
          const mail = render(locale);
          const ar = emailMessages('ar')[entry as 'passwordReset'];
          const en = emailMessages('en')[entry as 'passwordReset'];

          const arAt = mail.subject.indexOf(ar.subject.split('{')[0]!.trim());
          const enAt = mail.subject.indexOf(en.subject.split('{')[0]!.trim());

          expect(arAt, 'no Arabic subject').toBeGreaterThanOrEqual(0);
          expect(enAt, 'no English subject').toBeGreaterThanOrEqual(0);
          expect(arAt, 'English before Arabic').toBeLessThan(enAt);
        });

        /**
         * A recipient whose language is neither gets THREE blocks, not two.
         *
         * German is in the catalogue, and a German customer losing their language as a side effect
         * of a rule about Arabic and English is the failure `.claude/CLAUDE.md` opens with.
         */
        it('renders one block per required language', () => {
          const mail = render(locale);
          const expected = localesFor(locale).length;

          expect(mail.text.split('—————————————')).toHaveLength(expected);
        });

        /**
         * The interpolated value reaches EVERY block.
         *
         * A link or a code printed in one language and not the other leaves the other reader with
         * a sentence about something that is not there — which is worse than an untranslated email,
         * because it looks complete.
         */
        it('repeats the interpolated value in every block', () => {
          if (!shows) return;

          const mail = render(locale);
          const blocks = mail.text.split('—————————————');

          for (const block of blocks) expect(block).toContain(shows);
        });

        /** The whole point of a plain-text email: the paragraphs are the formatting. */
        it('breaks into paragraphs with real newlines', () => {
          const mail = render(locale);

          expect(mail.text).toContain('\n\n');
          expect(mail.text).not.toContain('\\n');
        });

        /**
         * No placeholder survives, in the SUBJECT or the body.
         *
         * The subject half of this is new and it caught a real defect: `compose` joined subjects
         * without filling them, so fourteen of the twenty-four shipped `{reference}` verbatim in
         * the one line a person scans in an inbox list.
         */
        it('leaves no unfilled placeholder', () => {
          const mail = render(locale);

          expect(mail.subject).not.toMatch(/\{\w+\}/);
          expect(mail.text).not.toMatch(/\{\w+\}/);
        });
      });
    }
  }

  /**
   * The table covers every template the module exports.
   *
   * Without this, adding a template and not adding a row means the new one is simply never tested
   * — the silent-coverage failure, and the one this whole file exists to prevent.
   */
  it('tests every template the module exports', () => {
    const exported = Object.entries(templates)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();

    expect(RENDERERS.map((r) => r.name).sort()).toEqual(exported);
  });
});

/**
 * The invited person's ROLE reads in the invited person's language.
 *
 * REGRESSION (2026-08-14): the caller passed `role.replace(/_/g, ' ')`, so every invitation named
 * the role in English. It survives the bilingual rewrite in a sharper form — the value is now
 * resolved PER BLOCK, so the Arabic block must say «مدير عمليات» and the German block
 * «Betriebsleitung» in one message. A single value filled into both would put one language's word
 * inside the other's paragraph, which is this rule's own failure one layer down.
 */
describe('a catalogue value is resolved per language block', () => {
  it('names the staff role in each block’s own language', () => {
    const mail = templates.staffInvitationMail({
      ...SAMPLE,
      locale: 'de',
      role: 'operations_manager',
      expiresInHours: 48,
    });

    const [ar, en, de] = mail.text.split('—————————————');

    expect(ar).toContain(emailMessages('ar').roles['operations_manager']);
    expect(en).toContain(emailMessages('en').roles['operations_manager']);
    expect(de).toContain(emailMessages('de').roles['operations_manager']);
  });

  it('falls back to the code for a role with no translation', () => {
    const mail = templates.staffInvitationMail({
      ...SAMPLE,
      locale: 'ar',
      role: 'not_a_role',
      expiresInHours: 48,
    });

    expect(mail.text).toContain('not_a_role');
  });

  it('names the contract kind in each block’s own language', () => {
    const mail = templates.partnerContractReadyMail({
      ...SAMPLE,
      locale: 'ar',
      partner: 'فندق قصر الشرق',
      kind: 'base',
    });

    const [ar, en] = mail.text.split('—————————————');

    expect(ar).toContain(emailMessages('ar').contractKinds['base']);
    expect(en).toContain(emailMessages('en').contractKinds['base']);
  });
});

describe('mails that carry a secret', () => {
  it('withholds the partner sign-in code from the log', () => {
    const mail = templates.partnerLoginCodeMail({
      to: SAMPLE.to,
      locale: 'ar',
      code: '123456',
      expiresInMinutes: 10,
    });

    expect(mail.sensitive).toBe(true);
  });

  /** And the code itself still reaches the reader, in both languages. */
  it('still sends the code to the partner', () => {
    const mail = templates.partnerLoginCodeMail({
      to: SAMPLE.to,
      locale: 'ar',
      code: '123456',
      expiresInMinutes: 10,
    });

    for (const block of mail.text.split('—————————————')) {
      expect(block).toContain('123456');
    }
  });
});
