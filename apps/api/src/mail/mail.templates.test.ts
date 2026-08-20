import { describe, expect, it } from 'vitest';

import { LOCALES } from '@safra/i18n';

import {
  emailVerificationMail,
  partnerLoginCodeMail,
  passwordResetMail,
  staffInvitationMail,
  supportRepliedMail,
} from './mail.templates.js';

/**
 * Transactional email rendering, in every locale.
 *
 * ## The failure this exists to catch
 *
 * Moving the copy into `@safra/i18n` first shipped every body with LITERAL `\n` — two
 * characters — instead of newlines, because the extraction read `\n` out of a template literal
 * as source text and re-escaped it. Every paragraph break in every email in every language was
 * broken, and nothing failed: the subject was right, the link was right, and no test rendered
 * a body.
 *
 * So these assertions are deliberately about the RENDERED string rather than about the
 * catalogue, which the completeness tests already cover.
 */
describe('transactional email', () => {
  const RENDERERS = [
    {
      name: 'passwordReset',
      render: (locale: string) =>
        passwordResetMail({
          to: 'customer@example.com',
          url: 'https://safra.example/reset?token=abc',
          locale,
          expiresInMinutes: 30,
        }),
      shows: '30',
    },
    {
      name: 'emailVerification',
      render: (locale: string) =>
        emailVerificationMail({
          to: 'customer@example.com',
          url: 'https://safra.example/verify?token=xyz',
          locale,
          expiresInHours: 48,
        }),
      shows: '48',
    },
    {
      name: 'staffInvitation',
      render: (locale: string) =>
        staffInvitationMail({
          to: 'agent@safra.com',
          url: 'https://safra.example/invite?token=q',
          locale,
          /* A CODE. What the reader sees is asserted per locale below, not here. */
          role: 'operations_manager',
          expiresInHours: 48,
        }),
      shows: '48',
    },
    {
      name: 'supportReplied',
      render: (locale: string) =>
        supportRepliedMail({
          to: 'customer@example.com',
          locale,
          reference: 'CNV-000042',
          url: 'https://safra.example/ar/account/support/CNV-000042',
        }),
      shows: 'CNV-000042',
    },
  ] as const;

  for (const { name, render, shows } of RENDERERS) {
    for (const locale of LOCALES) {
      describe(`${name} [${locale}]`, () => {
        it('carries the link, the subject and the interpolated value', () => {
          const mail = render(locale);

          expect(mail.subject).not.toBe('');
          expect(mail.text).toContain('https://safra.example/');
          expect(mail.text).toContain(shows);
        });

        /** The whole point of a plain-text email: the paragraphs are the formatting. */
        it('breaks into paragraphs with real newlines', () => {
          const mail = render(locale);

          expect(mail.text).toContain('\n\n');
          expect(mail.text).not.toContain('\\n');
        });

        /**
         * No placeholder survives.
         *
         * `fill` leaves an unfilled `{name}` in place rather than printing `undefined`, which is
         * right for us and wrong for the customer looking at it. A template that gains a
         * placeholder its caller does not pass fails here.
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
   * The invited person's ROLE reads in the invited person's language.
   *
   * REGRESSION (2026-08-14): the caller passed `role.replace(/_/g, ' ')`, so every invitation in
   * every language named the role in English — «تمت دعوتك … بصفة: operations manager». Asserted
   * per locale, because a single shared expectation is exactly what could not catch this.
   */
  describe('the staff invitation names the role in the reader’s language', () => {
    const invite = (locale: string, role = 'operations_manager') =>
      staffInvitationMail({
        to: 'agent@safra.com',
        url: 'https://safra.example/invite?token=q',
        locale,
        role,
        expiresInHours: 48,
      }).text;

    it.each([
      ['ar', 'مدير عمليات'],
      ['en', 'Operations manager'],
      ['de', 'Betriebsleitung'],
    ])('names it in %s', (locale, word) => {
      expect(invite(locale)).toContain(word);
    });

    /* And never the code, which is what the old caller produced with its underscores removed. */
    it.each(['ar', 'en', 'de'])('never prints the raw code in %s', (locale) => {
      expect(invite(locale)).not.toContain('operations_manager');
      expect(invite(locale)).not.toContain('operations manager');
    });

    /**
     * A role with no word falls back to the code rather than to a blank.
     *
     * `user_role` can gain a value before the three catalogues do, and an invitation reading
     * «بصفة: » would be a broken sentence where «بصفة: data_officer» is an obvious gap.
     */
    it('falls back to the code for a role with no translation', () => {
      expect(invite('ar', 'data_officer')).toContain('data_officer');
    });
  });

  /** `preferred_locale` is an unconstrained text column, so this is reachable from data. */
  it('falls back to Arabic for an unrecognised locale', () => {
    const unknown = passwordResetMail({
      to: 'a@b.co',
      url: 'https://safra.example/r',
      locale: 'fr',
      expiresInMinutes: 30,
    });
    const arabic = passwordResetMail({
      to: 'a@b.co',
      url: 'https://safra.example/r',
      locale: 'ar',
      expiresInMinutes: 30,
    });

    expect(unknown.text).toBe(arabic.text);
    expect(unknown.subject).toBe(arabic.subject);
  });

  /** Three languages must not render the same subject — that would mean one is untranslated. */
  it('renders a different subject per locale', () => {
    const subjects = LOCALES.map(
      (locale) =>
        passwordResetMail({
          to: 'a@b.co',
          url: 'https://safra.example/r',
          locale,
          expiresInMinutes: 30,
        }).subject,
    );

    expect(new Set(subjects).size).toBe(LOCALES.length);
  });
});

/**
 * A mail whose BODY is a credential must say so.
 *
 * With no SMTP transport configured — every environment without one — `MailService` writes the
 * whole body to the log so a developer can follow the link inside it. That is a deliberate
 * convenience and it is safe for a link, which is single-use and expiring. It is NOT safe for a
 * mail whose body IS the secret: a live sign-in code in a log file is a credential in a log file,
 * which rule 1 forbids outright.
 *
 * `sensitive` is the flag that withholds it, and this is what keeps somebody from adding another
 * code-bearing mail without it.
 */
describe('mails that carry a secret', () => {
  it('withholds the partner sign-in code from the log', () => {
    const mail = partnerLoginCodeMail({
      to: 'partner@safra.test',
      code: '123456',
      locale: 'ar',
      expiresInMinutes: 10,
    });

    expect(mail.sensitive).toBe(true);
  });

  /** The code is still in the body — withholding it from a LOG is not withholding it from the mail. */
  it('still sends the code to the partner', () => {
    const mail = partnerLoginCodeMail({
      to: 'partner@safra.test',
      code: '123456',
      locale: 'ar',
      expiresInMinutes: 10,
    });

    expect(mail.text).toContain('123456');
  });
});
