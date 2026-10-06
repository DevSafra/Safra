import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { MailService } from './mail.service.js';
import { sendBestEffort } from './best-effort.js';

/**
 * The request-path wrapper around a `send` that throws.
 *
 * What matters: it never throws, it reports whether the mail left, and the line it writes names the
 * subject and not the recipient or the body (a reset link, a sign-in code, a gift card code).
 */
describe('sendBestEffort', () => {
  const message = {
    to: 'someone@example.test',
    subject: 'Reset your password',
    text: 'https://safra.test/reset?token=abc123',
  };

  it('resolves false, rather than throwing, when the send fails', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = {
      send: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')),
    } as unknown as MailService;

    await expect(sendBestEffort(failing, message)).resolves.toBe(false);

    const written = warn.mock.calls.flat().join(' ');

    expect(written).toContain('Reset your password');
    expect(written).not.toContain('someone@example.test');
    expect(written).not.toContain('abc123');

    warn.mockRestore();
  });

  it('resolves true when the mail left', async () => {
    const working = { send: () => Promise.resolve() } as unknown as MailService;

    await expect(sendBestEffort(working, message)).resolves.toBe(true);
  });
});
