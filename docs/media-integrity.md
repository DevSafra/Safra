# Media URL integrity

Why a photograph can be stored correctly and still be invisible, what has been closed, and what
remains.

---

## The failure mode

A media URL is composed from configuration and handed to a browser. Whether it serves bytes depends
on the bucket policy, the CDN, and the Content-Security-Policy — none of which the application can
observe. **Every layer reports success and the picture is blank**, and the 403 or 404 happens in
somebody else's browser on a request this API never sees.

On 2026-08-08, three misconfigurations were live simultaneously in development, and the only symptom
was blank tiles:

1. The bucket was not anonymously readable.
2. `NEXT_PUBLIC_MEDIA_URL` pointed at the API's local-disk route while the API stored to S3.
3. No app's CSP named the media host.

None of them was found by inspection. All three were found by the first browser test that looked at
a thumbnail.

---

## What has been closed

| Risk                       | Control                                                            | Where                                          |
| -------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| Bucket not readable        | Boot probe: fetches a key that cannot exist; 404 passes, 403 fails | `MediaReachabilityService`                     |
| — reported                 | `media` field on `/health/ready`                                   | `health.controller.ts`                         |
| — enforced                 | `MEDIA_REQUIRE_PUBLIC=true` refuses to start                       | `.env.example` sets it                         |
| — fixed locally            | `pnpm media:bootstrap` grants read on `properties/` only           | `bootstrap-media.ts`                           |
| CSP omits the host         | `img-src` derives from the configured base                         | `mediaOrigins()`, `@safra/session`             |
| CSP too broad              | Blanket `https:` replaced with named origins                       | same                                           |
| **Two apps drifting**      | One shared builder for both Next apps                              | `mediaBase()` / `mediaUrl()`, `@safra/session` |
| Wrong variant requested    | Width chosen from `variantWidths`, never upscaled                  | `mediaUrl()`                                   |
| A picture that never loads | Browser test asserts `naturalWidth > 0`                            | `e2e/partner-images.spec.ts`                   |

The boot probe deliberately fetches a **missing** key. That means it works on an empty bucket, on a
fresh deployment, and before any partner has uploaded anything — which is exactly when a
misconfiguration is cheapest to fix.

---

## What remains, exactly

**There are two independent places a media URL is composed, and nothing in the code can force them
to agree.**

| Composer                          | Reads                                                | Used by                                                         |
| --------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| `mediaBase()` in `@safra/session` | `NEXT_PUBLIC_MEDIA_URL`, else `API_URL/api/v1/media` | Customer app, partner portal                                    |
| `StorageService.publicUrl()`      | `S3_PUBLIC_URL`, else `S3_ENDPOINT/S3_BUCKET`        | The API's `urls` field on `GET /partner/properties/:ref/images` |

They live in different processes with different environment variables. **A deployment that sets one
and not the other produces a partner image manager that works and a customer gallery that does not,
or the reverse** — and both halves pass their own tests.

### The exposure, stated plainly

`NEXT_PUBLIC_MEDIA_URL` **must name the same origin as** `S3_PUBLIC_URL`. Nothing checks it. It is
a deployment-configuration invariant, and today it is held by a line in `.env.example` and this
paragraph.

### Recommended controls, in order of value

1. **A deployment-time assertion.** The infrastructure that renders both apps' env and the API's env
   should fail the deploy when the two origins differ. One comparison, in whatever renders the
   config — this is the control that actually closes it, and it belongs to whoever owns deployment.
2. **Collapse to one composer.** Delete the API's `urls` field and have the partner manager use
   `mediaBase()` like everything else, or the reverse. **Preferred long-term**, deliberately not
   done now: the `urls` field is the only account of a media address that a non-SAFRA client could
   consume, and removing it is a decision about the API's contract rather than a tidy-up.
3. **Extend the boot probe to the CDN hostname**, not only the origin. Today it probes what the API
   composes; in production, browsers fetch what the apps compose. Closing this needs the API to know
   `NEXT_PUBLIC_MEDIA_URL` — a one-line env addition, and the reason it is not done yet is that it
   would be a variable the API reads and never uses for anything else, which invites deletion.
4. **A synthetic check from outside**: fetch one real property image every five minutes from an
   external prober. This is the only control that sees what a customer sees, and it belongs with
   alerting (`docs/alerting.md`, signal 8).

### Residual risk after all four

Small and bounded: a CDN cache holding a stale 403 after a policy fix. Mitigated by purging on
deploy, which is a runbook line rather than a code change.

---

## Why `properties/` and nothing else is public

The bucket holds identity documents under `identity/`. The policy `bootstrap-media.ts` writes grants
`s3:GetObject` on `properties/*` **only**, and deliberately does not grant `ListBucket` — with
listing, anybody could enumerate every media key on the platform, and the keys are the only thing
between a stranger and every document ever uploaded.

Verified after every policy change:

```
properties object → 200
bucket listing    → 403
identity/ object  → 403
```
