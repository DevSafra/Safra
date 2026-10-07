import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opening the emailed link must not spend the token — go-live audit, 2026-10-06.
 *
 * The page confirmed while it rendered, and link-scanning mail proxies (Outlook Safe Links and its
 * kind) fetch every link in a message before the person sees it. The token was single-use, so the
 * scanner confirmed the address and the person's own click met «this link no longer works».
 *
 * Rendering is now asked directly: a GET of the page with a well-formed token reaches nothing
 * upstream. The confirmation is the POST behind the button, covered by its route's own test.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
  setRequestLocale: () => undefined,
}));

/*
  The page's old upstream call read the visitor's headers first, which needs a live request. Stubbed
  so that a page which DID call upstream fails on the assertion below, not on a missing request.
*/
vi.mock('@/lib/visitor', () => ({ visitorHeaders: () => Promise.resolve({}) }));

/* The suite compiles JSX with the classic runtime, which reads `React` from scope. */
Object.assign(globalThis, { React });

const { default: VerifyEmailPage } = await import('./page.js');

const TOKEN = 'a'.repeat(43);

describe('GET /[locale]/verify-email', () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the confirmation without calling the API', async () => {
    const page = await VerifyEmailPage({
      params: Promise.resolve({ locale: 'ar' }),
      searchParams: Promise.resolve({ token: TOKEN }),
    });

    expect(page, 'something was rendered').toBeTruthy();
    expect(fetchSpy, 'a page load must not spend the token').not.toHaveBeenCalled();
  });

  /** The opposite case, so «not called» is not simply a page that never reaches its own logic. */
  it('hands the token to the button that confirms it', async () => {
    const page = await VerifyEmailPage({
      params: Promise.resolve({ locale: 'ar' }),
      searchParams: Promise.resolve({ token: TOKEN }),
    });

    expect(JSON.stringify(page)).toContain(TOKEN);
  });
});
