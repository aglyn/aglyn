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
# verify:
gcloud firestore fields ttls list --project=aglyn-main --database='(default)'
```

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
- TTL policies: **`rateLimits.expiresAt`** (AGL-870), **`mediaTombstones.expiresAt`** (AGL-1467 — NOT YET APPLIED; the collection ships with this change)
- Backup schedules: **weekly (Sunday), 14-week retention** (AGL-871)
