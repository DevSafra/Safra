import type { Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { createReceiptRenderer } from './receipt-pdf';

/**
 * The receipt renderer's pool, with a browser launcher that FAILS.
 *
 * REGRESSION (2026-10-06): the slot was taken before the `try`, and so were the launch and the
 * context. A failed launch kept its slot for the life of the process and its rejected promise was
 * cached, so after two failures every receipt download waited for ever and a Chromium that came
 * back was never asked. The API's contract renderer has the same suite.
 */

const URL_ = 'https://safra.test/ar/account/invoices/BKG-000001';
const COOKIE = { name: 'safra_session', value: 'not-a-real-session' };

function fakeBrowser(): Browser {
  return {
    isConnected: () => true,
    close: () => Promise.resolve(),
    newContext: () =>
      Promise.resolve({
        addCookies: () => Promise.resolve(),
        newPage: () =>
          Promise.resolve({
            goto: () => Promise.resolve(null),
            emulateMedia: () => Promise.resolve(),
            pdf: () => Promise.resolve(Buffer.from('%PDF')),
          }),
        close: () => Promise.resolve(),
      }),
  } as unknown as Browser;
}

/** Fails the first `failures` launches, then succeeds; counts every attempt. */
function flakyLauncher(failures: number) {
  let calls = 0;

  return {
    get calls() {
      return calls;
    },
    launch: () => {
      calls += 1;

      return calls <= failures
        ? Promise.reject(new Error('Executable does not exist'))
        : Promise.resolve(fakeBrowser());
    },
  };
}

/** Rejects instead of hanging, so a leaked slot fails the test rather than timing it out. */
function within<T>(promise: Promise<T>, ms = 1_000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('render never started: a slot leaked')), ms),
    ),
  ]);
}

describe('createReceiptRenderer', () => {
  it('gives the slot back when the browser fails to launch', async () => {
    const renderer = createReceiptRenderer(flakyLauncher(2).launch, 2);

    await expect(renderer.render(URL_, COOKIE)).rejects.toThrow(
      'Executable does not exist',
    );
    await expect(renderer.render(URL_, COOKIE)).rejects.toThrow(
      'Executable does not exist',
    );

    await expect(within(renderer.render(URL_, COOKIE))).resolves.toEqual(
      Buffer.from('%PDF'),
    );
  });

  it('tries the launch again rather than remembering a failure', async () => {
    const launcher = flakyLauncher(1);
    const renderer = createReceiptRenderer(launcher.launch, 2);

    await expect(renderer.render(URL_, COOKIE)).rejects.toThrow();
    await expect(renderer.render(URL_, COOKIE)).resolves.toEqual(Buffer.from('%PDF'));

    expect(launcher.calls).toBe(2);
  });

  it('gives the slot back when the context cannot be opened', async () => {
    const broken = {
      isConnected: () => true,
      close: () => Promise.resolve(),
      newContext: () => Promise.reject(new Error('context refused')),
    } as unknown as Browser;

    const renderer = createReceiptRenderer(() => Promise.resolve(broken), 1);

    await expect(renderer.render(URL_, COOKIE)).rejects.toThrow('context refused');
    await expect(within(renderer.render(URL_, COOKIE))).rejects.toThrow(
      'context refused',
    );
  });
});
