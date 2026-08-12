import { describe, expect, it } from 'vitest';

import { ERROR } from './error-codes.js';
import { supportOpenSchema, supportQuerySchema, supportReplySchema } from './support.js';

/**
 * الدعم's contract.
 *
 * The length rule is tested HERE rather than against the service, and the distinction is the project's
 * own: input is validated at the BOUNDARY with a schema, so the schema is where the rule lives and the
 * service is entitled to trust what reaches it. A service-level copy would be a second rule to keep in
 * step, and the first thing to drift.
 */
const ENOUGH = 'The heating did not work for two nights and nobody answered.';

describe('supportOpenSchema', () => {
  it('accepts a message with enough in it to act on', () => {
    const result = supportOpenSchema.safeParse({ body: ENOUGH });

    expect(result.success && result.data.body).toBe(ENOUGH);
  });

  /**
   * A floor of ten characters, with its own error code.
   *
   * "help" is not a support request anybody can act on, and a generic "invalid" on a free-text box tells
   * somebody nothing about what to change — hence `support.message_too_short` rather than a shared code.
   */
  it.each(['', 'help', 'broken', '   short   '])('refuses %j', (body) => {
    const result = supportOpenSchema.safeParse({ body });

    expect(result.success).toBe(false);
  });

  it('names the too-short code so the form can explain itself', () => {
    const result = supportOpenSchema.safeParse({ body: 'help' });

    expect(JSON.stringify(result.error?.issues)).toContain(
      ERROR.SUPPORT_MESSAGE_TOO_SHORT,
    );
  });

  /* Trimmed, so whitespace cannot buy the ten characters. */
  it('measures the message after trimming', () => {
    expect(supportOpenSchema.safeParse({ body: `   ${'a'.repeat(9)}   ` }).success).toBe(
      false,
    );
    expect(supportOpenSchema.safeParse({ body: `  ${'a'.repeat(10)}  ` }).success).toBe(
      true,
    );
  });

  /* A ceiling too: an unbounded body is a row nobody can read and a redaction pass nobody budgeted. */
  it('refuses a body past the ceiling', () => {
    expect(supportOpenSchema.safeParse({ body: 'a'.repeat(4001) }).success).toBe(false);
    expect(supportOpenSchema.safeParse({ body: 'a'.repeat(4000) }).success).toBe(true);
  });

  /**
   * No subject line, and `.strict()` is what says so.
   *
   * A summary field sounds helpful and is not: a second thing to read, a second thing to translate, and
   * a second place for the contact details the body is redacted for.
   */
  it('refuses a subject line rather than ignoring one', () => {
    expect(
      supportOpenSchema.safeParse({ body: ENOUGH, subject: 'Heating' }).success,
    ).toBe(false);
  });

  it('refuses an attempt to name the ticket owner', () => {
    expect(
      supportOpenSchema.safeParse({ body: ENOUGH, customerProfileId: 'somebody-else' })
        .success,
    ).toBe(false);
  });
});

describe('supportReplySchema', () => {
  /* Replying is the same shape as opening — one rule, so a reply cannot be shorter than a first message. */
  it('is the same rule as opening', () => {
    expect(supportReplySchema.safeParse({ body: 'help' }).success).toBe(false);
    expect(supportReplySchema.safeParse({ body: ENOUGH }).success).toBe(true);
  });
});

describe('supportQuerySchema', () => {
  it('is cursor-paged with the shared default', () => {
    const result = supportQuerySchema.safeParse({});

    expect(result.success && result.data.limit).toBe(20);
  });

  /* Customer-facing, so no page number — `OFFSET` is the console's documented exception. */
  it('refuses a page number', () => {
    expect(supportQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });
});
