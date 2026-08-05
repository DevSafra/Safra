import { describe, expect, it } from 'vitest';

import { LOCALES } from '@safra/i18n';

import {
  emailVerificationMail,
  passwordResetMail,
  staffInvitationMail,
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
          roleLabel: 'مدير عمليات',
          expiresInHours: 48,
        }),
      shows: 'مدير عمليات',
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
