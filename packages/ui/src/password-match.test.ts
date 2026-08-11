import { describe, expect, it } from 'vitest';

import { passwordMismatch, passwordsMatch } from './password-match.js';

/**
 * The confirmation rule, shared by every form that sets a new password.
 *
 * Tested here rather than through a form because the two functions answer DIFFERENT questions and the
 * difference is the whole point: one guards the submit, the other decides whether to show a message.
 * Using either in place of the other produces a form that is wrong in a way a screenshot will not show.
 */
describe('passwordsMatch — the submit guard', () => {
  it('accepts two identical passwords', () => {
    expect(passwordsMatch('a-long-passphrase-1', 'a-long-passphrase-1')).toBe(true);
  });

  it.each([
    ['a-long-passphrase-1', 'a-long-passphrase-2'],
    ['a-long-passphrase-1', 'A-LONG-PASSPHRASE-1'],
    ['a-long-passphrase-1', ''],
  ])('refuses %j against %j', (password, confirmation) => {
    expect(passwordsMatch(password, confirmation)).toBe(false);
  });

  /**
   * Two blanks are not a match.
   *
   * As a submit guard, a bare `password === confirmation` would wave an empty form through and leave the
   * refusal to the input's `required`. A guard that depends on another guard is one refactor from wrong.
   */
  it('refuses two empty fields', () => {
    expect(passwordsMatch('', '')).toBe(false);
  });

  /**
   * Whitespace is never trimmed.
   *
   * Spaces are legitimate characters in a passphrase and `passwordChangeSchema` preserves them, so
   * trimming here would report a match between two values the server stores as different.
   */
  it.each([
    ['  padded  ', 'padded'],
    ['padded', 'padded '],
    [' padded', 'padded'],
  ])('treats %j and %j as different', (password, confirmation) => {
    expect(passwordsMatch(password, confirmation)).toBe(false);
  });

  it('accepts a match that is itself padded', () => {
    expect(passwordsMatch('  a padded passphrase  ', '  a padded passphrase  ')).toBe(
      true,
    );
  });

  /* Unicode is compared as given — no normalisation, because the server does none either. */
  it('compares non-Latin passphrases exactly', () => {
    expect(passwordsMatch('كلمة-مرور-طويلة-١', 'كلمة-مرور-طويلة-١')).toBe(true);
    expect(passwordsMatch('كلمة-مرور-طويلة-١', 'كلمة-مرور-طويلة-٢')).toBe(false);
  });
});

describe('passwordMismatch — whether to show the message', () => {
  /**
   * Silent until the reader has typed into the confirmation.
   *
   * `!passwordsMatch(...)` is true from the first character of the new password, so a form using it
   * would report a mismatch to somebody who has not yet reached the second field.
   */
  it('says nothing while the confirmation is still empty', () => {
    expect(passwordMismatch('a-long-passphrase-1', '')).toBe(false);
    expect(passwordMismatch('', '')).toBe(false);
  });

  it('reports a genuine difference once there is something to compare', () => {
    expect(passwordMismatch('a-long-passphrase-1', 'a')).toBe(true);
    expect(passwordMismatch('a-long-passphrase-1', 'a-long-passphrase-2')).toBe(true);
  });

  it('goes quiet again when they agree', () => {
    expect(passwordMismatch('a-long-passphrase-1', 'a-long-passphrase-1')).toBe(false);
  });

  /* A confirmation typed BEFORE the password is still a mismatch worth reporting. */
  it('reports a filled confirmation against an empty password', () => {
    expect(passwordMismatch('', 'a-long-passphrase-1')).toBe(true);
  });

  /**
   * The two functions are not each other's negation, and this pins that.
   *
   * Exactly one state satisfies neither: a confirmation that is still empty.
   */
  it('is not the negation of passwordsMatch', () => {
    const password = 'a-long-passphrase-1';

    expect(passwordsMatch(password, '')).toBe(false);
    expect(passwordMismatch(password, '')).toBe(false);
  });
});
