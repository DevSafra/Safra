import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import { MailService } from './mail.service.js';

/**
 * The branch that runs when no SMTP transport is configured.
 *
 * It prints the whole body so a developer can click a reset link out of the console. That is right
 * for a link and wrong for a gift card code: `gift_cards` stores only a hash precisely so no
 * plaintext exists at rest, and a log file is at rest. `sensitive` is how a mail says so.
 *
 * Asserted here rather than in a browser because the branch cannot run in production — `loadEnv`
 * refuses — so this is the only place it can be held to account.
 */
describe('MailService with no transport', () => {
  const service = (): MailService =>
    new MailService({ MAIL_FROM: 'safra@example.test' } as unknown as Env);

  it('prints an ordinary body, so a reset link stays clickable', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await service().send({
      to: 'someone@example.test',
      subject: 'Reset your password',
      text: 'https://safra.test/reset?token=abc123',
    });

    expect(log.mock.calls.flat().join(' ')).toContain(
      'https://safra.test/reset?token=abc123',
    );

    log.mockRestore();
  });

  it('withholds a body that carries a secret, and says that it did', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    /*
      A code that CANNOT be a real one.

      `GIFT_CODE_ALPHABET` is `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no I, L, O or U, because they
      misread as 1 and 0. A fixture built from exactly those four can never collide with something
      the generator issued. An earlier draft of this test pasted a code from a card actually bought
      against the local testbed, which is the mistake this file exists to argue against.
    */
    await service().send({
      to: 'someone@example.test',
      subject: 'Your gift card GIF-000123',
      text: 'Card code:\nIIIII-LLLLL-OOOOO-UUUUU',
      sensitive: true,
    });

    const written = log.mock.calls.flat().join(' ');

    /* The code is the whole point of the assertion. */
    expect(written).not.toContain('IIIII-LLLLL-OOOOO-UUUUU');
    /* But the mail is still evidence that something was sent, and to whom. */
    expect(written).toContain('someone@example.test');
    expect(written).toContain('Your gift card GIF-000123');
    expect(written).toContain('withheld');

    log.mockRestore();
  });
});
