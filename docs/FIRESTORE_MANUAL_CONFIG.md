<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Firestore manual configuration (gcloud / console only)

Some Firestore config is **not** managed by `firebase deploy` and lives only in
the project (console/gcloud). It is invisible to code review and can drift from
intent silently — that is exactly how the `versions.nodes` index exemption got
deleted (AGL-866). This file is the source of truth for that config so it stays
reproducible. Prod project: **`aglyn-main`**, database **`(default)`**.

## What `firebase deploy` DOES manage (so it lives in the repo, not here)

`firebase deploy --only firestore:indexes` reconciles BOTH composite indexes AND
single-field overrides/exemptions from `cloud/firebase-firestore.indexes.json`,
and **deletes anything in the project that isn't in that file** (composite
indexes and `fieldOverrides` alike). `firestore:rules` replaces the ruleset from
`cloud/firebase-firestore.deploy.rules`, the comment-stripped artifact of
`cloud/firebase-firestore.rules` (AGL-3544; regenerate it with
`npm run generate:rules-deploy`). So:

- Composite indexes → `firebase-firestore.indexes.json` `indexes`
- Single-field index exemptions (e.g. the large `nodes`/snapshot blobs) →
  `firebase-firestore.indexes.json` `fieldOverrides` with `indexes: []`
- Security rules → `firebase-firestore.rules` (edited), deployed as
  `firebase-firestore.deploy.rules` (generated)

**Always diff BOTH `indexes` and `fieldOverrides` against the live project before
an index deploy.** That diff is now a command (AGL-1804):

```sh
npm run check:index-drift          # read-only; exit 0 clean, 1 drift, 2 cannot-check
```

It runs daily and on every push touching the index file
(`.github/workflows/index-drift.yml`), and separates the two directions because
they need **opposite** responses:

- **PROD-ONLY** — live, not in the file. **Do not deploy**: the deploy would
  delete it. Copy the live entry into the file first;
  `firebase firestore:indexes --project aglyn-main` prints it in this file's own
  shape. This is the AGL-866 / AGL-1801 direction, and the damage is caused by
  the deploy, not by the mismatch.
- **FILE-ONLY** — in the file, not deployed. The deploy is owed, and until it
  runs every query needing that index throws `FAILED_PRECONDITION` (AGL-1793 /
  AGL-1802: three crons that had never run). Re-run the check afterwards —
  index builds are async, and "deployed" is not "ready".

⚠️ **A green run means the project matches the file. It does NOT mean every
query is served.** A composite index is not a prefix substitute: `bookings`
carried a COLLECTION_GROUP `status + expiresAtMs` index and still could not
serve a `startsAtMs`-only query (AGL-1802). Per-query coverage is the job of the
`*-indexes.spec.ts` guards, and of AGL-1814.

## What `firebase deploy` does NOT manage (documented + applied here)

### 1. TTL policies (AGL-870)

Firestore auto-deletes a doc after the timestamp in a TTL-enabled field. Requires
a **Timestamp** field (not a number/ms). Deletion is best-effort within ~72h of
expiry, so application logic must still treat expired docs as stale — TTL is
cleanup, not a correctness guarantee.

⚠️ **Enabling TTL is a gcloud action, but the field it creates is still a
`fieldOverrides` entry — so it MUST also be written into
`firebase-firestore.indexes.json` (AGL-1793).** Enabling TTL gives the field an
explicit index config, which makes it an override in the project; and this file's
own rule above is that an index deploy **deletes any override not in the repo
file**. So a TTL field that lives only in gcloud is armed to be destroyed by the
next unrelated index deploy. That is not hypothetical — `mediaTombstones.expiresAt`
was applied here in AGL-1467 and never added to the file, and sat that way until
AGL-1793 diffed the live project. `firebase firestore:indexes` round-trips the
flag as `"ttl": true`, which is exactly the form to paste in. **Add the row to the
table below AND the `fieldOverrides` entry, in the same change.**
`npm run check:index-drift` treats TTL as deploy-managed for this reason and
reports a live-but-unfiled TTL policy as **PROD-ONLY**, i.e. as about to be
deleted.

⚠️ **A TTL policy is invisible to the obvious Admin-API query.** `ListFields`
only returns explicitly-configured fields, and the documented filter for that is
`indexConfig.usesAncestorConfig=false` — but a TTL field reports
`usesAncestorConfig: **true**` (it inherits the database default index config;
both of ours do). Measured on `aglyn-main`: that filter returns 15 fields, the
`... OR ttlConfig:*` form returns 17. A checker built on the narrow filter does
not merely miss the TTL policies — it files them under FILE-ONLY and advises
running the deploy, which is the one action that can destroy them.

| collectionGroup | field | why |
|---|---|---|
| `rateLimits` | `expiresAt` | ephemeral rate-limit windows (AGL-794/795); expired windows should be reaped, not accumulate |
| `mediaTombstones` | `expiresAt` | DAM undo records (AGL-1467). Each holds a deleted media document **verbatim** — alt text, description, tags, custom metadata, `visibleTo` scope tokens — plus the storage generations needed to restore it. Bounded to the bucket's **7-day soft-delete window**, because a tombstone that outlives the bytes it addresses can only ever produce a failed restore while still being a copy of customer data (the AGL-1443 shape). The subcollection sits under `hosts/{hostId}` and `orgs/{orgId}`, so an erasure takes it via `recursiveDelete` with no extra sweep. |
| `cspViolationDaily` | `expiresAt` | Durable CSP-violation counters (AGL-1799) written by the console and tenant `/api/csp-report` collectors — one doc per (day × app × directive × disposition × blocked origin), never report bodies. 60-day retention (`CSP_AGGREGATE_RETENTION_DAYS` in `libs/tenant/data/admin/src/lib/server/csp-aggregate.ts`); the evidence AGL-1702/AGL-1726 gate their enforcing flips on. **TTL `ACTIVE`, re-verified 2026-08-18.** |
| `analytics` | `expiresAt` | Per-day pageview/serve/redirect counters on hosts and orgs (AGL-1844). **400 days** (`ANALYTICS_DAY_RETENTION_DAYS` in `libs/tenant/data/admin/src/lib/server/analytics-retention.ts`) — wide enough for the console's 90-day range, a usage-metering dispute a year later, and a year-over-year comparison no surface renders yet. TTL `ACTIVE`. |
| `screenAnalytics` | `expiresAt` | The same counters per screen, same 400 days, same policy. TTL `ACTIVE`. |
| `funnelJourneys` | `expiresAt` | One recorded site visit (AGL-3605) at `hosts/{hostId}/funnelJourneys/{visitId}`: its steps in order — page paths, form, service, product and overlay ids, custom event names — with server times, and where it arrived from (UTM labels, referring host). Keyed by a random per-tab id; a visit a form submission ended carries the submitter's address (`personEmail`), an anonymous one identifies nobody. **90 days** (`FUNNEL_JOURNEY_RETENTION_DAYS` in `libs/plugins/funnels/src/lib/model/funnels.types.ts`); the site collector's journey beacon stamps `journeyExpiresAt(now)` on every write. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `funnelResults` | `expiresAt` | A funnel's computed result over a range (AGL-3605): counts, shares, durations and source labels. Kept as a cache for up to a day by the results route, which stamps two days out so the document outlives its use and then goes. **OWED: not yet enabled.** |
| `assistExchanges` | `expiresAt` | The **verbatim** half of an Aglyn Assist exchange (AGL-1972) — the question, the answer and the asking `uid`. **180 days** (`ASSIST_EXCHANGE_RETENTION_DAYS` in `libs/plugins/ai/src/lib/usage/assist-usage.ts`). The number is only affordable because the analytic half was split into `assistSignals`, which carries `docsPaths`, the thumbs rating, tokens and cost, has NO expiry and no `uid` — so the docs-gap data loop keeps its corpus while the prose expires. Both are org subcollections, so `recursiveDelete(orgRef)` still takes them on erasure. TTL `ACTIVE`, enabled and verified 2026-08-19. |
| `aiCrmAnswers` | `expiresAt` | A CRM job's answer (AGL-2917), at `orgs/{orgId}/aiCrmAnswers/{jobId}`: a record's summary and proposed next step, an email draft, or an import's column matches, written from a person's CRM record, with the record's id and the asking `uid`. **14 days** (`AI_CRM_ANSWER_RETENTION_DAYS` in `libs/plugins/ai/src/lib/model/ai-crm.ts`) — `createAiJobCrmStep` in `libs/plugins/ai/src/lib/jobs/ai-job-crm-step.ts` stamps `aiCrmAnswerExpiry(now)`. A person erasure does not sweep it, so the period is what bounds a copy of an erased person. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `aiJobs` | `expiresAt` | An AI generation job (AGL-2904): the customer's **brief verbatim**, the step ledger, the outputs it named and the creating `uid`, under `orgs/{orgId}`. **180 days**, the exchange's clock — `createAiJob` in `libs/plugins/ai/src/lib/jobs/ai-jobs.ts` stamps `assistExchangeExpiry(now)`. The drafts a job writes are ordinary content and are not touched by this policy. TTL `ACTIVE`, enabled and verified 2026-09-14. |
| `aiInsights` | `expiresAt` | An insight job's answer (AGL-2915), at `orgs/{orgId}/aiInsights/{jobId}`: the question verbatim, the tables of aggregates the job read (counts, sums, rates and labels such as page paths and product names, never a record) and the insights written about them. **180 days**, the job's own clock — `runAiJobInsightStep` in `libs/plugins/ai/src/lib/jobs/ai-job-insight-step.ts` stamps the job's `expiresAt`. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `months` | `expiresAt` | A person's monthly AI usage (AGL-2928), one document per uid per month at `orgs/{orgId}/aiUsageByUser/{uid}/months/{YYYY-MM}`: credits, spend, request and refusal counts, a split by kind and by site. Integers keyed by a uid, no prose. **Thirteen months** past the month the document describes (`AI_USAGE_BY_USER_RETENTION_MONTHS` in `libs/plugins/ai/src/lib/model/ai-usage-by-user.ts`) — a year of month-over-month comparison for a workspace admin, plus the month in progress. The collection-group name is the generic `months`; nothing else in the schema writes a subcollection by that name, and the `uid` field carries a collection-group index beside this so an account erasure can sweep a person's months out of workspaces they had already left. TTL `ACTIVE`, enabled and verified 2026-09-14. |
| `churnSurveyDetails` | `expiresAt` | The churn survey's free text (AGL-1978), split out of `orgs/{orgId}/retention` into its own document so it can expire without taking the closed-set `reason` with it — the reason breakdown is the whole point of the funnel (AGL-1859/AGL-1863) and must not be reaped. **365 days** (`CHURN_SURVEY_DETAIL_RETENTION_DAYS` in `apps/console/app/api/_lib/retention.ts`), because churn analysis is annual. TTL `ACTIVE`, enabled and verified 2026-08-19. |
| `apiIdempotency` | `expiresAt` | REST/POS/marketplace replay keys (AGL-618, AGL-1978). **30 days** (`API_IDEMPOTENCY_RETENTION_DAYS` in `libs/aglyn/src/lib/app-utils/api-idempotency.ts`). Not merely a key: a settled claim stores the **original response body**, which for the REST API is the created record's `values` — so this collection was a permanent second copy of every record created through the API, surviving the record's own deletion. Top-level and `orgId`-keyed, so `eraseOrgIdempotencyKeys` sweeps it on erasure; the TTL is what bounds it for a **live** org. The published contract in `apps/docs/api/conventions.md` moved from "never expire" to the 30-day window in the same change. TTL `ACTIVE`, enabled and verified 2026-08-19. |
| `authHandoffs` | `expiresAt` | Cross-domain console session handoff records (AGL-1902). Each holds the SHA-256 of **two** secrets that together buy a session, plus the `uid` it would be minted for — so an unexpired leftover is the one document in the database worth stealing. Expiry is enforced in code on redemption as well; the TTL is what bounds the row itself, and it is the only thing bounding it on a self-host install. Top-level, single-use, both hashes nulled on consume. TTL `ACTIVE`, enabled and verified 2026-08-20. |
| `packageImports` | `expiresAt` | A site package import's record (AGL-3533, AGL-3543) at `hosts/{hostId}/packageImports/{importId}`: who imported what, each item's decision and target. **8 days** — the 7-day undo window and a day (`PACKAGE_LEDGER_RETENTION_MS` in `apps/console/app/api/_lib/site-package-ledger.ts`); the import route stamps `packageLedgerExpiry(...)` when it files the record and again when the import applies. Undo itself closes at 7 days in code (`packageImportUndoable`). **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `snapshots` | `expiresAt` | The undo snapshot beneath a package import (AGL-3543), `packageImports/{importId}/snapshots/{n}`: every replaced or merged item's previous content **verbatim**, as JSON pieces of up to 900,000 characters — a whole-site restore into itself snapshots the whole site. Same 8 days; `writeLedgerPieces` stamps each piece, since TTL does not cascade from the record. The collection-group name is the generic `snapshots`; nothing else in the schema writes a subcollection by that name. **OWED: not yet enabled.** |
| `writtenPaths` | `expiresAt` | The document paths a package import wrote per item (AGL-3543), `packageImports/{importId}/writtenPaths/{n}`, which undo deletes. Same 8 days, same writer. **OWED: not yet enabled.** |
| `imports` | `expiresAt` | An email list's import ledger (AGL-3529, AGL-3549) at `orgs/{orgId}/lists/{listId}/imports/{jobId}`: up to 25 sample shared-mailbox addresses **verbatim**, the column names that read as a bought list, the consent sample's counts, and who stated permission (`attestedByUid`). **15 days** — the 7 days a planned import may wait to be applied, its 7-day undo window, and a day (`LIST_IMPORT_LEDGER_RETENTION_MS` in `libs/plugins/email/src/lib/transfer/list-members.server.ts`); every dry run re-stamps `listImportLedgerExpiry(Date.now())`. The collection-group name is the generic `imports`; nothing else in the schema writes a subcollection by that name. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `orderWebhookDeliveries` | `expiresAt` | One signed order-webhook delivery (AGL-3611) at `hosts/{hostId}/orderWebhookDeliveries/{deliveryId}`: the event, its attempts and the request body **verbatim** (up to `ORDER_WEBHOOK_BODY_MAX`), which is the order as the API publishes it — buyer email and shipping address included. **30 days** (`ORDER_WEBHOOK_LOG_RETENTION_MS` in `libs/plugins/commerce/src/lib/server/order-webhooks.ts`); every attempt re-stamps `expiresAt(now)`. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `printJobs` | `expiresAt` | A cloud receipt printer's job (AGL-3619) at `hosts/{hostId}/printJobs/{jobId}`: the receipt or shift report it prints, the register and cashier names on it, and the printer's result. **7 days** (`PRINT_JOB_RETENTION_MS` in `libs/plugins/commerce/src/lib/model/commerce-printers.ts`); `enqueuePrintJob` stamps it when the job is queued. A job is never delivered past its `deliverByMs`, minutes after it is written, so the week is only the jobs list's history. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `shippingQuoteCache` | `expiresAt` | Live carrier rates (AGL-3612), top-level: a checkout quote keyed by a SHA-256 of the site, the destination address and the parcels — the address itself is not stored — for **10 minutes** (`QUOTE_CACHE_TTL_MS` in `libs/plugins/shipping/src/lib/server/quote-cache.ts`), and a label quote held for purchase as `q_{shipmentId}` for **30 minutes** (`QUOTE_HOLD_MS` in `libs/plugins/shipping/src/lib/server/labels.ts`). Both are refused by age on read, so a missing policy costs storage, not a stale price. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `zapierHookDeliveries` | `expiresAt` | That one event reached one Zapier REST hook (AGL-3643), top-level: the outbox event's id, the hook's id, the org and when — **no customer data**. **3 days** (`ZAPIER_DELIVERY_MARKER_RETENTION_MS` in `libs/plugins/zapier/src/lib/constants.ts`), longer than the outbox's whole retry ladder; `markDelivered` stamps `deliveryMarkerExpiry(...)` when the hook takes the event. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `adConversionConsents` | `expiresAt` | A checkout's advertising consent (AGL-3694), top-level, written only where the shopper granted advertising on a site with an Ad conversions connection: the consent status, the page, the ad vendors' browser ids, the IP address and the user agent. **14 days** (`CONSENT_TTL_MS` in `libs/plugins/ad-conversions/src/lib/constants.ts`), stamped by `recordOrderConsent`; deleted earlier when its order is reported. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `adConversionEvents` | `expiresAt` | A purchase or lead owed to one Ad conversions connection (AGL-3694), top-level: hashed user data, the IP address and user agent while it is pending, a tombstone without them once sent. **14 days** (`EVENT_TTL_MS` in the same file), stamped when the event is owed. **OWED: not yet enabled** — run the command below after the index deploy that carries the declaration. |
| `stockPhotoSearches` | `expiresAt` | What a stock photo library answered one search (AGL-3660), top-level, keyed by a SHA-256 of the provider and the request's canonical parameters (never the API key): the hits — the library's photo ids, sizes, page and image addresses, contributor names and tags. **No workspace's data**: the search words are a site's kind and a section's subject. **24 hours** (`STOCK_PHOTO_SEARCH_CACHE_MS` in `libs/plugins/stock-photos/src/lib/constants.ts`), which Pixabay's API terms ask of every request; `createFirestoreSearchCache` stamps it and treats an entry past it as absent on read. Its `photos` array is exempt from single-field indexing. |

Not TTL targets (deliberately): `apiKeys.expiresAt` (validity field — keep expired
keys as records), `orgSlugs.movedTo` tombstones (intentional persistent
redirects, AGL-585), session sign-out tombstones (live in the `__session`
cookie, not Firestore), `bookings.expiresAtMs` (a number, not a Timestamp).

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=mediaTombstones --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=cspViolationDaily --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=analytics --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=screenAnalytics --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3605 — OWED, after the index deploy that declares them:
gcloud firestore fields ttls update expiresAt \
  --collection-group=funnelJourneys --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=funnelResults --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-1972 / AGL-1978 — run 2026-08-19, now ACTIVE:
gcloud firestore fields ttls update expiresAt \
  --collection-group=assistExchanges --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=churnSurveyDetails --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=apiIdempotency --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=authHandoffs --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-2917 — OWED, run after the index deploy that declares it:
gcloud firestore fields ttls update expiresAt \
  --collection-group=aiCrmAnswers --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-2904 — run 2026-09-14, now ACTIVE:
gcloud firestore fields ttls update expiresAt \
  --collection-group=aiJobs --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-2915 — OWED, run after the index deploy that declares it:
gcloud firestore fields ttls update expiresAt \
  --collection-group=aiInsights --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-2928 — run 2026-09-14, now ACTIVE:
gcloud firestore fields ttls update expiresAt \
  --collection-group=months --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3543 — OWED, run after the index deploy that declares them:
gcloud firestore fields ttls update expiresAt \
  --collection-group=imports --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=packageImports --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=snapshots --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=writtenPaths --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3611 / AGL-3612 / AGL-3619 — OWED, run after the index deploy that declares them:
gcloud firestore fields ttls update expiresAt \
  --collection-group=orderWebhookDeliveries --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=printJobs --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=shippingQuoteCache --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3643 — OWED, run after the index deploy that declares it:
gcloud firestore fields ttls update expiresAt \
  --collection-group=zapierHookDeliveries --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3694 — OWED, run after the index deploy that declares them:
gcloud firestore fields ttls update expiresAt \
  --collection-group=adConversionConsents --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=adConversionEvents --enable-ttl \
  --project=aglyn-main --database='(default)'
# AGL-3660 — OWED, run after the index deploy that declares it:
gcloud firestore fields ttls update expiresAt \
  --collection-group=stockPhotoSearches --enable-ttl \
  --project=aglyn-main --database='(default)'
# verify:
gcloud firestore fields ttls list --project=aglyn-main --database='(default)'
```

✅ **The three AGL-1972/AGL-1978 policies were enabled on 2026-08-19** and
`gcloud firestore fields ttls list` now reports eight `ACTIVE` policies.
Historically they were declared and written but not enabled: The `fieldOverrides` entries are in the index file and the
writers stamp `expiresAt`, so nothing is at risk from a deploy — but until the
three commands above are run, the documents accrue an expiry timestamp that
nothing acts on, and `docs/DATA_RETENTION.md` must not describe those periods
as enforced. That is the AGL-1496 shape (a policy written and never applied)
and it is recorded here rather than assumed away. `assistExchanges` is the
urgent one: it starts accruing verbatim customer prose on the first question
asked after `release_assist` flips.

Note the ordering hazard in the other direction too: enabling a TTL **before**
its `fieldOverrides` entry is committed leaves the policy live-but-unfiled,
which `npm run check:index-drift` reports as PROD-ONLY and which the next index
deploy deletes. Commit first, then enable — which is the order this change is
in.

`mediaTombstones` does **not** depend on the sweep for correctness, and must not:
TTL is best-effort within ~72h, which is 43% of the window it is bounding.
`restoreMediaFromTombstone` treats an expired tombstone as absent, refuses with a
real message, and deletes it on sight. The policy is what stops them
accumulating; the code is what makes the boundary exact.

### 2. Scheduled backups (AGL-871) — APPLIED 2026-07-26

Point-in-time recovery is ENABLED (7-day window) AND a weekly scheduled backup
exists (Sunday, 14-week retention). The command below is what created it, kept
for reference / self-hosters:

```bash
gcloud firestore backups schedules create \
  --database='(default)' --project=aglyn-main \
  --recurrence=weekly --day-of-week=SUNDAY --retention=14w
# (--day-of-week is REQUIRED for weekly; optionally add a daily with shorter retention)
gcloud firestore backups schedules list --database='(default)' --project=aglyn-main
```

A backup existing is not a recovery capability: check backup **state** (a
backup can silently sit at `NOT_AVAILABLE` — the 2026-08-02 one did, AGL-1490)
and see `docs/DISASTER_RECOVERY.md` for the rehearsed restore procedure.

```bash
gcloud firestore backups list --project=aglyn-main --location='-' \
  --format="table(snapshotTime, state, expireTime)"
```

### 3. Delete protection (AGL-872) — APPLIED 2026-07-26

The prod database has `DELETE_PROTECTION_ENABLED`. The command below is what
enabled it, kept for reference / self-hosters:

```bash
gcloud firestore databases update --database='(default)' \
  --project=aglyn-main --delete-protection
# verify:
gcloud firestore databases describe --database='(default)' --project=aglyn-main \
  --format="value(deleteProtectionState)"
```

### Current database settings (applied 2026-07-26)

- Location `nam5` (US multi-region), Native mode, Pessimistic concurrency
- Point-in-time recovery: **ENABLED** (7-day window)
- Delete protection: **ENABLED** (AGL-872)
- TTL policies: **eleven `ACTIVE`** — `rateLimits` (AGL-870), `mediaTombstones` (AGL-1467), `cspViolationDaily` (AGL-1799), `analytics` and `screenAnalytics` (AGL-1844), plus `assistExchanges` (AGL-1972), `churnSurveyDetails` and `apiIdempotency` (AGL-1978) enabled 2026-08-19, `authHandoffs` (AGL-1902) enabled 2026-08-20, and `aiJobs` (AGL-2904) and `months` (AGL-2928) enabled 2026-09-14; all eleven read back `ACTIVE` on 2026-09-14 (`set-firestore-ttl.mjs --dry-run`, then `gcloud firestore fields ttls list --project=aglyn-main --database='(default)'`). The retention schedule they implement is [`docs/DATA_RETENTION.md`](DATA_RETENTION.md); `apps/console/specs/retention-ttl-config.spec.ts` fails the build if a declaration, a doc row or a writer goes missing — it cannot see gcloud, which is why the owed state is written down here
- Backup schedules: **weekly (Sunday), 14-week retention** (AGL-871)
