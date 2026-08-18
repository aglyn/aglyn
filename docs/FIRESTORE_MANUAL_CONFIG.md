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
`cloud/firebase-firestore.rules`. So:

- Composite indexes → `firebase-firestore.indexes.json` `indexes`
- Single-field index exemptions (e.g. the large `nodes`/snapshot blobs) →
  `firebase-firestore.indexes.json` `fieldOverrides` with `indexes: []`
- Security rules → `firebase-firestore.rules`

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
| `assistExchanges` | `expiresAt` | The **verbatim** half of an Aglyn Assist exchange (AGL-1972) — the question, the answer and the asking `uid`. **180 days** (`ASSIST_EXCHANGE_RETENTION_DAYS` in `apps/console/app/api/_lib/assist-usage.ts`). The number is only affordable because the analytic half was split into `assistSignals`, which carries `docsPaths`, the thumbs rating, tokens and cost, has NO expiry and no `uid` — so the docs-gap data loop keeps its corpus while the prose expires. Both are org subcollections, so `recursiveDelete(orgRef)` still takes them on erasure. ⚠️ **Not yet enabled in gcloud** — run the command below. |
| `churnSurveyDetails` | `expiresAt` | The churn survey's free text (AGL-1978), split out of `orgs/{orgId}/retention` into its own document so it can expire without taking the closed-set `reason` with it — the reason breakdown is the whole point of the funnel (AGL-1859/AGL-1863) and must not be reaped. **365 days** (`CHURN_SURVEY_DETAIL_RETENTION_DAYS` in `apps/console/app/api/_lib/retention.ts`), because churn analysis is annual. ⚠️ **Not yet enabled in gcloud** — run the command below. |
| `apiIdempotency` | `expiresAt` | REST/POS/marketplace replay keys (AGL-618, AGL-1978). **30 days** (`API_IDEMPOTENCY_RETENTION_DAYS` in `libs/aglyn/src/lib/app-utils/api-idempotency.ts`). Not merely a key: a settled claim stores the **original response body**, which for the REST API is the created record's `values` — so this collection was a permanent second copy of every record created through the API, surviving the record's own deletion. Top-level and `orgId`-keyed, so `eraseOrgIdempotencyKeys` sweeps it on erasure; the TTL is what bounds it for a **live** org. The published contract in `apps/docs/api/conventions.md` moved from "never expire" to the 30-day window in the same change. ⚠️ **Not yet enabled in gcloud** — run the command below. |

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
# AGL-1972 / AGL-1978 — OWED, not yet run:
gcloud firestore fields ttls update expiresAt \
  --collection-group=assistExchanges --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=churnSurveyDetails --enable-ttl \
  --project=aglyn-main --database='(default)'
gcloud firestore fields ttls update expiresAt \
  --collection-group=apiIdempotency --enable-ttl \
  --project=aglyn-main --database='(default)'
# verify:
gcloud firestore fields ttls list --project=aglyn-main --database='(default)'
```

⚠️ **The three AGL-1972/AGL-1978 policies are declared and written but NOT yet
enabled in gcloud.** The `fieldOverrides` entries are in the index file and the
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
- TTL policies: **five `ACTIVE`, three declared and OWED** — active: `rateLimits` (AGL-870), `mediaTombstones` (AGL-1467), `cspViolationDaily` (AGL-1799), `analytics` and `screenAnalytics` (AGL-1844), re-verified 2026-08-18 with `gcloud firestore fields ttls list --project=aglyn-main --database='(default)'`. Declared in the index file, writers stamping, gcloud command not yet run: `assistExchanges` (AGL-1972), `churnSurveyDetails` and `apiIdempotency` (AGL-1978). The retention schedule they implement is [`docs/DATA_RETENTION.md`](DATA_RETENTION.md); `apps/console/specs/retention-ttl-config.spec.ts` fails the build if a declaration, a doc row or a writer goes missing — it cannot see gcloud, which is why the owed state is written down here
- Backup schedules: **weekly (Sunday), 14-week retention** (AGL-871)
