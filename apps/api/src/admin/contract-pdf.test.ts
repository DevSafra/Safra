import type { Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { createContractRenderer, withFixedTimestamps } from './contract-pdf.js';

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

/**
 * The same contract must print to the same bytes (2026-10-07).
 *
 * Chromium stamps the current second into every PDF, so two prints of one contract differed and so
 * did their hashes. The stamp is now overwritten in place with a fixed moment of the same length.
 */
describe('withFixedTimestamps', () => {
  const pdfAt = (stamp: string) =>
    Buffer.from(
      `%PDF-1.4\n<</Producer (Skia/PDF m151)\n/CreationDate (D:${stamp}+00'00')\n/ModDate (D:${stamp}+00'00')>>\nendobj\n\xe2\x80\x99 binary`,
      'latin1',
    );

  it('makes two prints a second apart identical', () => {
    expect(withFixedTimestamps(pdfAt('20261007150119'))).toStrictEqual(
      withFixedTimestamps(pdfAt('20261007150121')),
    );
  });

  it('keeps every byte offset: same length, and only the digits change', () => {
    const before = pdfAt('20261007150119');
    const after = withFixedTimestamps(before);

    expect(after.length).toBe(before.length);
    expect(after.toString('latin1')).toBe(
      before.toString('latin1').replaceAll('20261007150119', '20000101000000'),
    );
  });

  it('leaves a PDF with no stamp exactly as it was', () => {
    const plain = Buffer.from('%PDF-1.4\n<</Producer (x)>>', 'latin1');

    expect(withFixedTimestamps(plain)).toBe(plain);
  });
});

/**
 * Page chrome is opt-in (2026-10-07).
 *
 * The voucher prints through this renderer too, and the contract's running footer was briefly
 * applied to every document. A render that passes no chrome must ask Chromium for exactly what it
 * did before chrome existed.
 */
describe('page chrome', () => {
  function recordingBrowser(calls: Record<string, unknown>[]): Browser {
    return {
      isConnected: () => true,
      close: () => Promise.resolve(),
      newContext: () =>
        Promise.resolve({
          newPage: () =>
            Promise.resolve({
              setContent: () => Promise.resolve(),
              emulateMedia: () => Promise.resolve(),
              pdf: (options: Record<string, unknown>) => {
                calls.push(options);

                return Promise.resolve(Buffer.from('%PDF'));
              },
            }),
          close: () => Promise.resolve(),
        }),
    } as unknown as Browser;
  }

  it('prints a document with no chrome exactly as before, and the contract with its own', async () => {
    const calls: Record<string, unknown>[] = [];
    const renderer = createContractRenderer(() =>
      Promise.resolve(recordingBrowser(calls)),
    );

    await renderer.render('<p>voucher</p>');
    await renderer.render('<p>contract</p>', { header: '<b>h</b>', footer: '<b>f</b>' });

    expect(calls[0]).toStrictEqual({ format: 'A4', printBackground: true });
    expect(calls[1]).toMatchObject({
      displayHeaderFooter: true,
      preferCSSPageSize: true,
      headerTemplate: '<b>h</b>',
      footerTemplate: '<b>f</b>',
    });
  });
});
