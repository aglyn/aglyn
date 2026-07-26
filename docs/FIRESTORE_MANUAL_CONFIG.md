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
an index deploy** (`firebase firestore:indexes`, and the Admin `fields` API for
overrides).

## What `firebase deploy` does NOT manage (documented + applied here)

### 1. TTL policies (AGL-870)

Firestore auto-deletes a doc after the timestamp in a TTL-enabled field. Requires
a **Timestamp** field (not a number/ms). Deletion is best-effort within ~72h of
expiry, so application logic must still treat expired docs as stale — TTL is
cleanup, not a correctness guarantee.

| collectionGroup | field | why |
|---|---|---|
| `rateLimits` | `expiresAt` | ephemeral rate-limit windows (AGL-794/795); expired windows should be reaped, not accumulate |

Not TTL targets (deliberately): `apiKeys.expiresAt` (validity field — keep expired
keys as records), `orgSlugs.movedTo` tombstones (intentional persistent
redirects, AGL-585), session sign-out tombstones (live in the `__session`
cookie, not Firestore), `bookings.expiresAtMs` (a number, not a Timestamp).

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=rateLimits --enable-ttl \
  --project=aglyn-main --database='(default)'
# verify:
gcloud firestore fields ttls list --project=aglyn-main --database='(default)'
```

### 2. Scheduled backups (AGL-871)

Point-in-time recovery is ENABLED (7-day window) but there is no longer-horizon
scheduled backup.

```bash
gcloud firestore backups schedules create \
  --database='(default)' --project=aglyn-main \
  --recurrence=weekly --day-of-week=SUNDAY --retention=14w
# (--day-of-week is REQUIRED for weekly; optionally add a daily with shorter retention)
gcloud firestore backups schedules list --database='(default)' --project=aglyn-main
```

### 3. Delete protection (AGL-872)

The prod database currently has `DELETE_PROTECTION_DISABLED`.

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
- TTL policies: **`rateLimits.expiresAt`** (AGL-870)
- Backup schedules: **weekly (Sunday), 14-week retention** (AGL-871)
