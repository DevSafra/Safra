# Runbook — Activating the EU sanctions feed

**Applies to:** partner verification (SRS §8.1, ADR 0002)
**Status of this document:** the endpoint behaviour below was tested against the live EU
service on **2026-08-02**. The URL form and token scheme are the publisher's, and they can
change without notice — re-verify before relying on this during an incident.

---

## 1. What this feed is for, and what happens without it

Every partner must be screened against the EU consolidated financial sanctions list before
they can be approved. The residual EU measures on Syria are asset freezes on named persons
and entities (ADR 0002), so onboarding a Syrian accommodation partner is lawful — provided
the counterparty is not one of the designated ones. Screening is the control that
establishes that, and it is a **hard gate**: a partner cannot be approved without a
recorded screening.

The platform refuses to screen against a list older than **7 days**
(`MAX_SNAPSHOT_AGE_DAYS` in `apps/api/src/sanctions/sanctions.service.ts`). That refusal is
deliberate — screening against a stale list produces a clean result that means nothing.
The practical consequence:

| State of the list | What staff see                                                    |
| ----------------- | ----------------------------------------------------------------- |
| Fresh (≤ 7 days)  | Screening runs; the reviewer sees scored matches                  |
| Stale (> 7 days)  | `503` with an actionable message; **no partner can be approved**  |
| Never imported    | Same refusal; the console shows "not screened" on every queue row |

So an unactivated feed does not degrade quietly. It stops partner onboarding within seven
days of the last import. Treat activation as a launch blocker, not a nice-to-have.

---

## 2. Registration — required, and no longer optional

The list is published by the European Commission through the **Financial Sanctions Files
(FSF)** system. Downloads are token-authenticated. The token is tied to a free account you
register yourself; there is no application, approval step, or fee.

1. Go to <https://webgate.ec.europa.eu/fsd/fsf> and create an account (EU Login).
2. Sign in and open the **Files** section.
3. Find the entry for the **XML 1.1** full sanctions list ("Based on XSD", version 1.1).
4. Copy its download URL. It has the form:

   ```
   https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=<YOUR-TOKEN>
   ```

> **A widely-circulated token exists. Do not use it.**
> The token `dG9rZW4tMjAxNw` (base64 for `token-2017`) appears in a great deal of
> third-party documentation. Tested on 2026-08-02, it returns **HTTP 500** — identical to
> the response for an obviously invalid token — while the FSF service itself is healthy
> (its public RSS endpoint returns 200). A request with **no** token returns 403. That
> token is dead; registration is mandatory.

### Version 1.1, not 1.0

Much of the third-party guidance online points at `xmlFullSanctionsList` (version 1.0).
**That is the wrong file for this platform.** Our parser
(`apps/api/src/sanctions/eu-list.parser.ts`) reads `<sanctionEntity>` elements and their
`<nameAlias>` children, which is the 1.1 schema. Version 1.0 uses a different element
structure and will parse to zero entries.

Zero entries does not import silently — `parseEuSanctionsXml` throws rather than returning
an empty list, precisely because an empty sanctions list that imports cleanly would clear
every partner on the platform. But the failure will read as "the feed is broken" when the
actual cause is the wrong file version, so choose 1.1 deliberately.

---

## 3. Configuration

Set one environment variable on the API:

```bash
SANCTIONS_FEED_URL=https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=<YOUR-TOKEN>
```

Declared in `apps/api/src/config/env.ts` as an optional URL, and listed in `.env.example`
with an empty value.

**The URL contains a credential.** The token is embedded in the query string, so this
variable is a secret:

- It goes in the secret manager, never in a committed file. `.env` is git-ignored;
  `.env.example` carries the empty placeholder only.
- Do not paste the full URL into tickets, chat, or logs. The application never logs the
  URL — failures name the variable, not its value — and that property must be preserved in
  any change to `SanctionsRefreshService`.
- Rotate it by re-issuing from the FSF account and updating the secret. No code change.

There is **no default**. That is intentional: hardcoding a token produces a system that
silently stops refreshing when it expires, with the staleness refusal surfacing days later
and nobody able to connect the two. With the variable absent, the API logs a warning
naming the variable at startup and the cron job does nothing.

---

## 4. How the refresh works

`SanctionsRefreshService` (`apps/api/src/sanctions/sanctions-refresh.service.ts`):

- **Schedule:** daily at 04:00, via `@Cron`. Daily rather than weekly because the staleness
  limit is 7 days — a weekly cadence leaves the platform one missed run from being unable
  to verify anybody.
- **Across replicas:** takes Postgres advisory lock `8_421_003`. A replica that does not
  get the lock skips silently; the work is not lost because another replica is doing it.
- **Timeout:** 60 s, via `AbortController`. A hung download cannot hold the lock or the
  connection open.
- **Rejects a short body:** anything under 10,000 bytes is refused before parsing. The real
  list is megabytes; a few kilobytes means an error page, a login redirect, or an expired
  token — all of which would otherwise parse to zero entries.
- **Never throws:** an unhandled rejection in a scheduled job kills the process. A failed
  refresh logs at `error` level and lets the list age into the staleness refusal, so the
  failure surfaces as a blocked queue rather than a check that quietly stopped running.
- **Deduplicates:** the snapshot is content-hashed. An unchanged list logs "unchanged" and
  does not write a new set of entries.

### Manual import — the fallback

When the token has lapsed or the feed is down, `super_admin` can import a downloaded file:

```
POST /api/v1/admin/sanctions/import
{ "xml": "<...the full XML...>", "source": "eu_consolidated" }
```

Requires `SETTINGS_UPDATE` (`super_admin` only — this replaces the list a legal obligation
is checked against). Throttled to 3 requests per 5 minutes; it parses megabytes and writes
thousands of rows. This path exists so a rotated token cannot block every partner
verification with no recovery short of a deploy.

`source` is required and has no default. Omitting it is a 400 rather than an EU import,
because a default would mean that FORGETTING the field labels a made-up file as the genuine
list — the exact confusion the field exists to prevent, reached by omission instead of by
intent.

### Development fixtures — `local_fixture`

The real list is only obtainable from the EU publisher, so a developer exercising the
screening path locally has to import something they made up. That file goes in under its own
source:

```
POST /api/v1/admin/sanctions/import
{ "xml": "<...a hand-made list...>", "source": "local_fixture" }
```

**Screening never consults it.** `SanctionsService.screen()` asks for `eu_consolidated` and
nothing else, so a fixture cannot answer a compliance question — not because a check rejects
it, but because nothing looks for it. There is no code path in which a fixture becomes
compliance, and none can be added by forgetting a flag.

Two consequences to expect, both intended:

- **Partner verification stays blocked.** The console says «المُستورَد قائمة اختبار للتطوير»
  rather than «لم تُستورد أي قائمة عقوبات», so the refusal is explained instead of looking
  like a broken screen — but it is still a refusal. A screening that answered "no match"
  against a fabricated list would produce a record that LOOKS clean and means nothing, which
  is worse than no screening at all. Same reasoning as the 7-day staleness refusal.
- **Production refuses the import outright.** `importSnapshot` throws when `NODE_ENV` is
  `production`, so the row cannot exist there and nobody ends up looking at a production
  database wondering which of two snapshots is the real one.

`sanctions.integration.test.ts` holds all of this: a fixture does not satisfy screening, does
not answer even for a name it contains, does not shadow a genuine list, and cannot be
imported in production.

**What the source does NOT do: prove the file is genuine.** A `super_admin` can still post a
fabricated body as `eu_consolidated`, and nothing here would notice — the EU export carries no
signature this platform verifies, so the manual path is trusted exactly as far as the person
holding `SETTINGS_UPDATE`. That is the deliberate trade of having a manual path at all, and it
is unchanged. What the source changes is narrower and worth stating precisely: a file imported
AS a fixture can never be used as compliance, so the accident — a developer's test file left
behind and treated as the list — cannot happen. Deceit by a super admin is a different threat
with a different answer, and the answer to it is `SANCTIONS_FEED_URL` plus the audit trail,
not this field.

**Monitoring.** Alert 6 is labelled `{source="eu_consolidated"}` for the same reason. The metric
emits a series per source, so an unlabelled expression would read a fresh fixture's age as
though it were the list and fall silent — see `docs/alerting.md`.

### Checking the current state

```
GET /api/v1/admin/sanctions/status
```

Requires `PARTNER_DOCUMENT_REVIEW`. Returns `imported`, `stale`, `entryCount`, `fetchedAt`,
`publishedAt`, `ageDays`. The admin console surfaces this so a reviewer reads "the list is
9 days old" rather than discovering it as an unexplained refusal on a decision they were
about to make.

---

## 5. Operational ownership

| Responsibility                               | Owner                                 | Cadence                 |
| -------------------------------------------- | ------------------------------------- | ----------------------- |
| Hold the FSF account; rotate the token       | Compliance                            | On expiry / annually    |
| `SANCTIONS_FEED_URL` in the secret manager   | Platform engineering                  | On rotation             |
| Alert on `ageDays > 3`                       | Platform engineering                  | Continuous              |
| Act on a stale-list alert                    | Compliance, escalating to engineering | Within one business day |
| Decide on a screening hit                    | Compliance                            | Per occurrence          |
| Re-verify this runbook against the publisher | Compliance                            | Every 6 months          |

**Alert at 3 days, not 7.** By 7 days onboarding has already stopped. Three days leaves two
missed nightly runs of margin to notice and fix it before staff are blocked.

The single-owner risk is the FSF account: if it belongs to one person's mailbox, their
departure silently expires the token. Register it to a shared compliance address.

### What is not covered

The screening decision is a human one. The platform scores name similarity — a floor of
0.35 to surface, 0.75 flagged as strong — surfaces the candidates, and records what the
reviewer concluded. It does not approve or reject anybody. The reviewer remains
accountable for the determination, and the audit log records who made it.

This list is the **EU consolidated** list only. UK (OFSI), US (OFAC/SDN) and UN lists are
not ingested. That is a deliberate scope decision for a German merchant entity operating
under EU law (ADR 0002), and it is a gap to revisit before taking US or UK customer
payments.

---

## 6. Verification after activation

```bash
# 1. Feed reachable with your token (expect a multi-megabyte body)
curl -sL -o /tmp/eu.xml -w "%{http_code} %{size_download}\n" "$SANCTIONS_FEED_URL"

# 2. Correct schema version (expect thousands, not zero)
grep -c "<sanctionEntity" /tmp/eu.xml

# 3. Import landed
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.safra.example/api/v1/admin/sanctions/status
# expect: {"imported":true,"stale":false,"entryCount":<thousands>,"ageDays":<1}

# 4. End to end: a partner in the queue can now be screened
```

A `500` from step 1 means the token is rejected. A `403` means no token reached the server
— check for shell mangling of the `?token=` query string, which is the usual cause.
