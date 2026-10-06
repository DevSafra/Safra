import type { Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { createContractRenderer } from './contract-pdf.js';

/**
 * The renderer's pool, with a browser launcher that FAILS.
 *
 * REGRESSION (2026-10-06): the slot was taken before the `try`, and so were the launch and the
 * context. A failed launch kept its slot for the life of the process and its rejected promise was
 * cached, so after two failures every contract, voucher and receipt waited for ever, and a Chromium
 * that came back was never asked. No real browser here: the defect is in the bookkeeping around it.
 */

/** A browser that renders `%PDF` and nothing else, standing in for Chromium. */
function fakeBrowser(): Browser {
  return {
    isConnected: () => true,
    close: () => Promise.resolve(),
    newContext: () =>
      Promise.resolve({
        newPage: () =>
          Promise.resolve({
            setContent: () => Promise.resolve(),
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

describe('createContractRenderer', () => {
  it('gives the slot back when the browser fails to launch', async () => {
    const launcher = flakyLauncher(2);
    const renderer = createContractRenderer(launcher.launch, 2);

    await expect(renderer.render('<p>1</p>')).rejects.toThrow(
      'Executable does not exist',
    );
    await expect(renderer.render('<p>2</p>')).rejects.toThrow(
      'Executable does not exist',
    );

    /* Both slots of two were taken by failures. A leak would leave this waiting for ever. */
    await expect(within(renderer.render('<p>3</p>'))).resolves.toEqual(
      Buffer.from('%PDF'),
    );
  });

  it('tries the launch again rather than remembering a failure', async () => {
    const launcher = flakyLauncher(1);
    const renderer = createContractRenderer(launcher.launch, 2);

    await expect(renderer.render('<p>1</p>')).rejects.toThrow();
    await expect(renderer.render('<p>2</p>')).resolves.toEqual(Buffer.from('%PDF'));

    expect(launcher.calls).toBe(2);
  });

  it('gives the slot back when the context cannot be opened', async () => {
    const broken = {
      isConnected: () => true,
      close: () => Promise.resolve(),
      newContext: () => Promise.reject(new Error('context refused')),
    } as unknown as Browser;

    const renderer = createContractRenderer(() => Promise.resolve(broken), 1);

    await expect(renderer.render('<p>1</p>')).rejects.toThrow('context refused');
    await expect(within(renderer.render('<p>2</p>'))).rejects.toThrow('context refused');
  });

  it('never runs more renders at once than its limit', async () => {
    let running = 0;
    let peak = 0;

    const slow = {
      isConnected: () => true,
      close: () => Promise.resolve(),
      newContext: () =>
        Promise.resolve({
          newPage: () =>
            Promise.resolve({
              setContent: async () => {
                running += 1;
                peak = Math.max(peak, running);
                await new Promise((resolve) => setTimeout(resolve, 5));
                running -= 1;
              },
              emulateMedia: () => Promise.resolve(),
              pdf: () => Promise.resolve(Buffer.from('%PDF')),
            }),
          close: () => Promise.resolve(),
        }),
    } as unknown as Browser;

    const renderer = createContractRenderer(() => Promise.resolve(slow), 2);

    await Promise.all(
      Array.from({ length: 8 }, (_, n) => renderer.render(`<p>${n}</p>`)),
    );

    expect(peak).toBe(2);
  });
});
