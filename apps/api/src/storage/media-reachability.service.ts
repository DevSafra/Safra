import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';

/**
 * Checking, at boot, that the media addresses we hand out are actually fetchable.
 *
 * ## The failure this exists to catch
 *
 * `StorageService.publicUrl` composes an address from configuration and gives it to the browser.
 * Whether that address serves the bytes depends on the bucket policy and the CDN, which live
 * outside this codebase — so the application cannot know, and until 2026-08-08 nothing asked.
 *
 * Three misconfigurations were live simultaneously in development and the platform's only symptom
 * was blank tiles: a private bucket, a `NEXT_PUBLIC_MEDIA_URL` pointing at the API's local-disk
 * route while the API stored to S3, and a CSP that named no media host. Every upload succeeded,
 * every URL was correct, and every photograph was invisible. **A 403 happens in somebody else's
 * browser, on a request this API never sees, and appears in no log we own.**
 *
 * ## How it decides, without needing an object to exist
 *
 * It fetches a key that is deliberately absent and reads the STATUS:
 *
 * - **404** — the store answered and said the object is missing. That is the correct answer for a
 *   readable bucket, and it is the pass.
 * - **403** — the store refused to say. The bucket is not anonymously readable, so every real
 *   media URL will be refused the same way.
 * - **anything else, or nothing** — the host is unreachable or is not the store we think it is.
 *
 * Probing a missing key rather than a real one means this works on an empty bucket, on a fresh
 * deployment, and before any partner has uploaded anything — which is exactly when a
 * misconfiguration is cheapest to fix.
 *
 * ## Why it warns rather than refusing to boot, by default
 *
 * An API that refused to start because a CDN was slow to propagate would turn a cosmetic problem
 * into an outage, and media is not on the critical path for booking or payment. So the default is
 * a loud startup error plus a `degraded` flag on readiness, which a deployment can gate on
 * deliberately.
 *
 * `MEDIA_REQUIRE_PUBLIC=true` makes it fatal. That is the right setting once a deployment target
 * exists and the bucket is provisioned by infrastructure rather than by hand — at which point a
 * failing probe means somebody changed the policy, and a failed deploy is the correct outcome.
 */
@Injectable()
export class MediaReachabilityService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaReachabilityService.name);

  /** Set once at boot and read by the readiness probe. `unknown` until the check has run. */
  private state: 'ok' | 'unreadable' | 'unreachable' | 'unknown' | 'skipped' = 'unknown';

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onApplicationBootstrap(): Promise<void> {
    this.state = await this.probe();

    if (this.state === 'ok' || this.state === 'skipped') return;

    const message =
      this.state === 'unreadable'
        ? 'The media bucket is not anonymously readable, so every property photograph will be a broken image in the browser. Run `pnpm media:bootstrap` locally, or grant public read on the properties/ prefix.'
        : 'The media host did not answer, so every property photograph will be a broken image in the browser. Check NEXT_PUBLIC_MEDIA_URL / S3_PUBLIC_URL.';

    this.logger.error(message);

    if (this.env.MEDIA_REQUIRE_PUBLIC) {
      throw new Error(`Refusing to start: ${message}`);
    }
  }

  /** What the readiness probe reports. Never throws. */
  status(): 'ok' | 'unreadable' | 'unreachable' | 'unknown' | 'skipped' {
    return this.state;
  }

  private async probe(): Promise<'ok' | 'unreadable' | 'unreachable' | 'skipped'> {
    const base = this.publicBase();

    /* Local disk storage serves through the API itself; there is no bucket policy to get wrong. */
    if (!base) return 'skipped';

    /*
      A key shaped like a real one but certain not to exist. The all-zero UUID is not a value the
      pipeline generates, and the prefix matters: the policy grants read on `properties/` only, so
      probing anywhere else would answer 403 on a correctly configured bucket.
    */
    const probeUrl = `${base.replace(/\/$/, '')}/properties/PROBE/00000000-0000-0000-0000-000000000000-400.avif`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);

      const response = await fetch(probeUrl, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.status === 404) return 'ok';
      if (response.status === 403 || response.status === 401) return 'unreadable';

      /*
        A 200 would mean the probe key exists, which it cannot — so the host is answering for
        something other than our bucket. Treated as unreachable: the address is wrong either way.
      */
      return 'unreachable';
    } catch {
      return 'unreachable';
    }
  }

  /**
   * Where a browser will fetch media from.
   *
   * The same precedence the apps use — an explicit public URL, otherwise the endpoint and bucket.
   * Returns null when there is no object store, which is the local-disk case.
   */
  private publicBase(): string | null {
    if (!this.env.S3_ACCESS_KEY_ID || !this.env.S3_BUCKET) return null;

    if (this.env.S3_PUBLIC_URL) return this.env.S3_PUBLIC_URL;
    if (this.env.S3_ENDPOINT) return `${this.env.S3_ENDPOINT}/${this.env.S3_BUCKET}`;

    return null;
  }
}
