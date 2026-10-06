import type * as Crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

import { ThrottlerStorageService } from '@nestjs/throttler';
import express, { type Request, type Response } from 'express';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/*
  The BUILDER, from the package the three sites use — not a copy of its header names. If either
  side renames a header, these tests stop vouching for anybody and fail.
*/
import { internalCallerHeaders } from '../../../../../packages/session/src/internal-caller.js';
import { CodedThrottlerGuard } from '../throttle/coded-throttler.guard.js';
import {
  INTERNAL_CALLER_HEADER,
  VISITOR_ADDRESS_HEADER,
  internalCallerMiddleware,
} from './internal-caller.js';

/*
  `timingSafeEqual` wrapped, not replaced, so the comparison still runs and the test can see that it
  was the one doing it. Express and Nest are external to Vite and keep the real module.
*/
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();

  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import('node:crypto');

const SECRET = 's'.repeat(48);

/**
 * Which bucket a visitor lands in, asked of the real thing.
 *
 * A real Express app with `trust proxy` set as `main.ts` sets it, the middleware under test, and the
 * real `CodedThrottlerGuard` over the in-memory store at ONE request a minute. So «a second request
 * is refused» means exactly «it was counted in the same bucket as the first», through the same
 * `req.ip` getter, tracker and key the API uses — nothing here restates how a tracker is derived.
 */
async function startApi(secret: string | undefined): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const storage = new ThrottlerStorageService();
  const guard = new CodedThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 1 }] },
    storage,
    { getAllAndOverride: () => undefined } as never,
  );
  await guard.onModuleInit();

  const app = express();
  app.set('trust proxy', 1);
  app.use(internalCallerMiddleware(secret));
  app.get('/probe', (request: Request, response: Response) => {
    const context = {
      getHandler: () => function probe() {},
      getClass: () => class ProbeController {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as never;

    guard.canActivate(context).then(
      () => {
        response.json({ ip: request.ip, headers: Object.keys(request.headers) });
      },
      () => {
        response.status(429).json({ ip: request.ip });
      },
    );
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/probe`,
    close: async () => {
      storage.onApplicationShutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** What one of the three sites sends for a visitor whose edge recorded `address`. */
function fromSite(address: string): Record<string, string> {
  return internalCallerHeaders(new Headers({ 'x-forwarded-for': address }));
}

describe('a server-side call made for a visitor', () => {
  let api: Awaited<ReturnType<typeof startApi>>;

  beforeAll(async () => {
    vi.stubEnv('INTERNAL_CALLER_SECRET', SECRET);
    api = await startApi(SECRET);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await api.close();
  });

  /*
    The defect: every visitor of a web instance arrived as the instance and shared its bucket. Here
    both arrive from the SAME socket, as two visitors of one web server do, and must not.
  */
  it('puts two visitors of one site in two buckets', async () => {
    const first = await fetch(api.url, { headers: fromSite('198.51.100.7') });
    const second = await fetch(api.url, { headers: fromSite('203.0.113.9') });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ip: '203.0.113.9' });
  });

  /* And it is still a limit: the same visitor again is counted against themselves. */
  it('still counts the same visitor in the same bucket', async () => {
    await fetch(api.url, { headers: fromSite('192.0.2.44') });
    const again = await fetch(api.url, { headers: fromSite('192.0.2.44') });

    expect(again.status).toBe(429);
  });

  it('takes neither header any further than the middleware', async () => {
    const response = await fetch(api.url, { headers: fromSite('192.0.2.45') });
    const { headers } = (await response.json()) as { headers: string[] };

    expect(headers).not.toContain(INTERNAL_CALLER_HEADER);
    expect(headers).not.toContain(VISITOR_ADDRESS_HEADER);
  });
});

describe('a caller without the secret', () => {
  let api: Awaited<ReturnType<typeof startApi>>;

  /* A fresh limiter per case: each one spends the socket's single request. */
  beforeEach(async () => {
    api = await startApi(SECRET);
  });

  afterEach(async () => {
    await api.close();
  });

  /*
    The spoofing attempt: an internet client choosing a fresh address per request to walk around the
    limiter, or a victim's address to spend THEIR budget. Both requests come from this test's one
    socket, so if the header were honoured they would land in two buckets; ignored, the second is
    refused.
  */
  it.each([
    ['a wrong secret', 'w'.repeat(48)],
    ['a secret of a different length', 'short'],
    ['an empty secret', ''],
  ])('ignores the visitor header with %s', async (_label, presented) => {
    const first = await fetch(api.url, {
      headers: {
        [INTERNAL_CALLER_HEADER]: presented,
        [VISITOR_ADDRESS_HEADER]: '198.51.100.1',
      },
    });
    const second = await fetch(api.url, {
      headers: {
        [INTERNAL_CALLER_HEADER]: presented,
        [VISITOR_ADDRESS_HEADER]: '198.51.100.2',
      },
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ip: '127.0.0.1' });
    expect(second.status).toBe(429);
  });

  it('ignores the visitor header with no secret at all', async () => {
    const first = await fetch(api.url, {
      headers: { [VISITOR_ADDRESS_HEADER]: '198.51.100.3' },
    });
    const second = await fetch(api.url, {
      headers: { [VISITOR_ADDRESS_HEADER]: '198.51.100.4' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  /* The secret vouches for the caller, not for what it forwarded: a non-address is not a key. */
  it('ignores a forwarded value that is not an address, even with the secret', async () => {
    const response = await fetch(api.url, {
      headers: {
        [INTERNAL_CALLER_HEADER]: SECRET,
        [VISITOR_ADDRESS_HEADER]: 'not-an-ip',
      },
    });

    expect(await response.json()).toMatchObject({ ip: '127.0.0.1' });
  });
});

describe('an API with no secret configured', () => {
  /* Local development without the variable: exactly the old behaviour, whatever a caller sends. */
  it('vouches for nobody', async () => {
    const api = await startApi(undefined);

    try {
      const response = await fetch(api.url, {
        headers: {
          [INTERNAL_CALLER_HEADER]: SECRET,
          [VISITOR_ADDRESS_HEADER]: '198.51.100.5',
        },
      });

      expect(await response.json()).toMatchObject({ ip: '127.0.0.1' });
    } finally {
      await api.close();
    }
  });
});

describe('comparing the secret', () => {
  beforeEach(() => {
    vi.mocked(timingSafeEqual).mockClear();
  });

  /*
    A `===` on the strings returns at the first differing character, so how long a guess takes says
    how much of it was right. `timingSafeEqual` over two digests of the same length does not, and
    does not reveal the secret's length either — a short guess is compared as 32 bytes like any other.
  */
  it('is constant-time, over equal-length digests, whatever was presented', async () => {
    const api = await startApi(SECRET);

    try {
      for (const presented of ['short', 'w'.repeat(48), SECRET]) {
        await fetch(api.url, {
          headers: {
            [INTERNAL_CALLER_HEADER]: presented,
            [VISITOR_ADDRESS_HEADER]: '192.0.2.1',
          },
        });
      }
    } finally {
      await api.close();
    }

    const calls = vi.mocked(timingSafeEqual).mock.calls;

    expect(calls).toHaveLength(3);
    for (const [expected, presented] of calls) {
      expect((expected as Buffer).length).toBe(32);
      expect((presented as Buffer).length).toBe(32);
    }
  });
});
