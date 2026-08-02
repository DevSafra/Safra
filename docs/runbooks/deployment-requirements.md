# Deployment requirements

**Written 2026-08-02, before the hosting provider was chosen (roadmap item 193).**

Purpose: state what SAFRA needs from a host so the decision can be made against a
concrete list. Nothing here names a provider — every requirement is one that several
can satisfy, and where a choice materially changes the shape of the work, that is
said explicitly.

The container image exists and is verified: `apps/api/Dockerfile` builds, runs as a
non-root user, boots against a real Postgres and Redis, serves both health endpoints,
and shuts down cleanly on SIGTERM. What is missing is somewhere to run it.

---

## 1. Compute

| Requirement              | Detail                                                                                        | Why                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| OCI container runtime    | Any — Kubernetes, ECS, Cloud Run, Fly, a VM with Docker                                       | The image is provider-agnostic                                                                                           |
| Node 22 runtime          | Provided by the image                                                                         | `engines` requires ≥ 22.12                                                                                               |
| ≥ 2 replicas             | Behind a load balancer                                                                        | Every stateful concern already lives in Postgres or Redis; a single replica is a single point of failure with no benefit |
| ~1 GB memory per replica | `NODE_OPTIONS=--max-old-space-size=768` is set for a 1 GB limit — **raise it with the limit** | Node does not read cgroup limits and will grow until the kernel kills it                                                 |
| Graceful shutdown ≥ 30 s | The orchestrator must wait, not `SIGKILL` immediately                                         | In-flight requests drain; verified working                                                                               |
| Health probes            | Liveness `GET /api/v1/health`, readiness `GET /api/v1/health/ready`                           | **Do not point liveness at `/health/ready`** — see §6                                                                    |

## 2. PostgreSQL

| Requirement            | Detail                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Version 17**         | Migrations are generated against it                                                                                          |
| `pg_trgm` extension    | **Mandatory.** Fuzzy name matching for sanctions screening; without it, partner verification cannot run at all               |
| `btree_gist`           | Used by the no-double-booking exclusion constraint                                                                           |
| Point-in-time recovery | Required — see M-3, the highest-severity item in the register                                                                |
| Connection limit ≥ 100 | `DATABASE_POOL_MAX` defaults to 20 per replica; size the server for `replicas × pool + headroom`                             |
| Timezone `UTC`         | Not load-bearing (timestamps are rendered with explicit `AT TIME ZONE 'UTC'`), but anything else makes ad-hoc psql confusing |

**Check `pg_trgm` availability before choosing.** Most managed Postgres offerings
include it; a few restrict extensions. Discovering it is unavailable after migrating is
an expensive surprise, because the alternative is rewriting the matching layer.

## 3. Redis

| Requirement            | Detail                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Redis 7                | Any managed equivalent                                                                                                   |
| Persistence            | **Not required.** It holds rate-limit counters only. Losing them resets limits, which is an inconvenience, not data loss |
| Lua scripting (`EVAL`) | Required — the rate limiter counts atomically in a script                                                                |
| Shared across replicas | The entire point; a per-replica instance reintroduces the bug this replaced                                              |

## 4. Object storage

S3-compatible, for partner identity documents and property images.

| Requirement                | Detail                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| S3 API                     | Any compatible implementation                                                                                                       |
| **Private by default**     | Identity documents are served through the API, which authorises per request. A public bucket would expose them to anyone with a URL |
| `S3_PUBLIC_URL` (optional) | A CDN in front of _image_ objects. Without it, every image request occupies an application worker                                   |
| Versioning + lifecycle     | Recommended. Lifecycle rules are how the S-4 retention policy will be enforced once it exists                                       |

The API **refuses to boot in production** without `S3_ACCESS_KEY_ID` and `S3_BUCKET`,
because the fallback is local disk — invisible to other replicas and lost on redeploy.

## 5. Everything else

- **Secret manager.** ~10 secrets (see `.env.example`). One of them,
  `SANCTIONS_FEED_URL`, carries a credential in its query string.
- **Do NOT rotate `FIELD_ENCRYPTION_KEY`.** Staff TOTP secrets are encrypted with it and
  nothing re-encrypts them, so rotating it locks every staff account out of the console
  at once. Recovery means single-use recovery codes, which is circular if the super
  admin is also locked out. Two-key support is future-work item **S-6**; until it ships,
  attach this warning to the secret itself.
- **TLS termination** with HSTS, and `X-Forwarded-For` set correctly. The app sets
  `trust proxy = 1` — exactly one proxy. **More than one hop requires changing that
  number**, or a client can forge its IP and walk through the rate limiter.
- **SMTP.** Required in production; the API refuses to boot without `SMTP_URL`.
- **Egress to `webgate.ec.europa.eu`** for the daily sanctions refresh. In a locked-down
  network this needs an allow-list entry.
- **Log aggregation** that ingests JSON lines from stdout. Logs are already structured
  and carry `requestId`; the app writes to stdout and does not manage files.
- **A scheduler is NOT needed.** Cron jobs run in-process and take Postgres advisory
  locks so exactly one replica executes each. Do not also configure an external
  scheduler — it would double-run them.

## 6. Two mistakes that are easy to make here

**Pointing liveness at readiness.** Readiness checks the database. A failed _liveness_
probe kills the container, so during a database blip every healthy replica restarts at
once and a recoverable incident becomes an outage. Liveness must stay on `/health`,
which touches nothing.

**Treating a Redis outage as fatal.** Readiness reports `redis: "degraded"` and stays
`200` deliberately. Rate limiting fails open; everything else works. Pulling every
replica from rotation because the cache is down would be self-inflicted downtime.
Alert on it — see S-1 — do not fail the probe on it.

---

## Not yet decided

Recorded so the hosting choice is made with them in view rather than around them.

| Question                         | Bearing on the decision                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Region**                       | Data residency for EU personal data; latency to Levantine users. A German merchant entity argues for an EU region |
| Managed vs. self-hosted Postgres | Managed is strongly preferred — M-3 (PITR + tested restore) is far cheaper with it                                |
| CDN                              | Not required to launch; required before image traffic is meaningful                                               |
| Where migrations run             | A one-shot job before the new replicas start. Running them from the app on boot would race across replicas        |

## Verified on 2026-08-02

```
docker build -f apps/api/Dockerfile -t safra-api .
```

- Image builds, ~376 MB, runs as `node` (uid 1000)
- No source, no dev dependencies, no `.env` in the final layer
- Boots against real Postgres 17 and Redis 7; `/health` → 200,
  `/health/ready` → `{"status":"ready","database":"up","redis":"up"}`
- Docker `HEALTHCHECK` reports `healthy`
- `docker stop` logs `SIGTERM received; draining and shutting down` — the signal
  reaches Node rather than the container being killed
