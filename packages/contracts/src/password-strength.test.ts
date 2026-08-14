import { describe, expect, it } from 'vitest';

import { ERROR } from './error-codes.js';
import { passwordSchema, registerSchema } from './auth.js';
import {
  normalise,
  passwordEchoesIdentity,
  passwordWeakness,
} from './password-strength.js';

/**
 * The password policy, from both sides: what it must refuse and what it must not.
 *
 * ## Why the second half matters as much as the first
 *
 * A strength check that refuses too much is not a safer check, it is a check people work around —
 * and the workaround is a password in a notes app. So the accepted cases below are assertions in
 * their own right: four ordinary words, an Arabic phrase, and a passphrase with punctuation must
 * all pass, because those are what somebody following the hint actually types.
 *
 * ## The policy this replaced
 *
 * Twelve characters and nothing else. `aaaaaaaaaaaa` and `123456789012` were accepted on a platform
 * holding wallet balances and payout accounts (2026-08-14). The "length beats composition" half of
 * NIST SP 800-63B was adopted and the blocklist half was not.
 */
const refused = (password: string) => passwordSchema.safeParse(password);

describe('what the policy refuses', () => {
  it.each([
    /*
      Every sample here SATISFIES the composition checklist — uppercase, lowercase, digit, symbol,
      twelve characters — so that what it fails on is the check under test. The checklist runs
      first, and `aaaaaaaaaaaa` would otherwise be refused for having no capital letter, which
      would prove nothing about predictability.
    */
    ['a single character held down', 'Aaaaaaaaaa1!'],
    ['two characters alternating', 'Ababababab1!'],
    ['the digits in order', 'Ab1234567!xy'],
    ['the alphabet in order', 'Aabcdefg1!xz'],
    ['a keyboard row', 'Aqwerty1!xzk'],
    ['a keyboard row backwards', 'Aytrewq1!xzk'],
    ['runs of repeated digits', 'A1111bbbb2!x'],
  ])('refuses %s', (_, password) => {
    const result = refused(password);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ERROR.VALIDATION_PASSWORD_PREDICTABLE);
  });

  it.each([
    /* Composition-complete, so the blocklist is what refuses them — which is the point. */
    ['the word itself, doubled to reach the length', 'Passwordpassword1!'],
    ['the word with a year', 'Password123!'],
    ['the word in leetspeak with decoration', 'P@ssw0rd!2024'],
    ['a year in front instead of behind', '2024Password!'],
    ['the name of this service', 'Safrasafra12!'],
    /*
      A phrase with real character variety, deliberately: «حبيبيحبيبيحبيبي» is refused too, but as
      PREDICTABLE — three distinct letters — which is a different check and would prove nothing
      about the Arabic blocklist.
    */
    ['a common Arabic phrase', 'السلامعليكم1!'],
  ])('refuses %s', (_, password) => {
    const result = refused(password);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ERROR.VALIDATION_PASSWORD_COMMON);
  });

  /* Still enforced, and still first — a short password is refused for being short. */
  it('refuses a short password before anything else', () => {
    const result = refused('xk4!');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(ERROR.VALIDATION_PASSWORD_TOO_SHORT);
  });
});

describe('what the policy accepts', () => {
  it.each([
    ['four unrelated words, which is what the hint suggests', 'Correct Horse Battery 9!'],
    ['an ordinary sentence', 'My Cat Sleeps Loudly 7!'],
    /* Arabic satisfies both case rules by having no case at all — see `PASSWORD_RULES`. */
    ['an Arabic phrase', 'مطر أزرق فوق الجبل ٩!'],
    ['a passphrase with punctuation and digits', 'Tr0ub4dor&3xyz'],
    ['a hyphenated phrase containing a common word', 'A-Testbed-Password-1'],
  ])('accepts %s', (_, password) => {
    expect(refused(password).success).toBe(true);
  });

  /**
   * The checklist and the blocklist together.
   *
   * Composition alone would be WEAKER than what was here: `Password1!` ticks every box. The
   * blocklist is what keeps the checklist honest, and this suite asserts both halves rather than
   * treating the visible one as the policy.
   */
  it('accepts a long passphrase that meets the checklist', () => {
    expect(refused('Kitchen Window Brass 4!').success).toBe(true);
  });
});

describe('normalise', () => {
  /* The step order that was wrong: folding leetspeak first turns 2024 into `2o2a`. */
  it('strips the decoration before folding leetspeak', () => {
    expect(normalise('Password1234')).toBe('password');
    expect(normalise('P@ssw0rd!2024')).toBe('password');
    expect(normalise('2024password')).toBe('password');
  });

  /* Arabic used to be stripped entirely, which skipped the blocklist on an Arabic-first site. */
  it('keeps Arabic script', () => {
    expect(normalise('مرحبا')).toBe('مرحبا');
  });

  it('leaves an ordinary passphrase recognisable', () => {
    expect(normalise('correct horse battery staple')).toBe('correcthorsebatterystaple');
  });
});

describe('a password that echoes who you are', () => {
  const register = (password: string) =>
    registerSchema.safeParse({
      email: 'bashar@example.test',
      password,
      fullName: 'Bashar Waez',
      phone: '+963912345678',
      /* Required since 2026-08-14 — the subject here is the password, not this field. */
      gender: 'undisclosed' as const,
    });

  it('refuses one built from the email address', () => {
    const result = register('Bashar-Example-9!');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      ERROR.VALIDATION_PASSWORD_CONTAINS_IDENTITY,
    );
  });

  it('refuses one built from the name', () => {
    expect(register('Waez Waez Waez 9!').success).toBe(false);
  });

  /* The message must land under the field somebody has to change, not at the top of the form. */
  it('attaches the refusal to the password field', () => {
    expect(register('Bashar-Example-9!').error?.issues[0]?.path).toEqual(['password']);
  });

  it('accepts one unrelated to either', () => {
    expect(register('Kitchen Window Brass 4!').success).toBe(true);
  });

  /**
   * A short fragment is a coincidence.
   *
   * "ali" appears inside "quality", and refusing every password containing three letters of
   * somebody's name would refuse most real passphrases — which is the failure mode that teaches
   * people to write passwords down.
   */
  it('ignores a fragment too short to mean anything', () => {
    expect(
      passwordEchoesIdentity('Quality Brass Lamp 4!', { email: 'ali@example.test' }),
    ).toBe(false);
  });
});

describe('passwordWeakness', () => {
  /*
    Length is the schema's job; duplicating it here would be two places to change one number.

    The sample is SHORT but varied — `xk4!` would fail on having four distinct characters, which is
    a different rule and would prove nothing about length.
  */
  it('says nothing about length', () => {
    expect(passwordWeakness('xk4!zqm')).toBeNull();
  });
});
