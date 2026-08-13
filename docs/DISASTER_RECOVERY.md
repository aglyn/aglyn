<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Firestore disaster recovery (AGL-1490)

Restore procedure for the production Firestore database
(`aglyn-main` / `(default)`, `nam5`, ~6.3 MB as of 2026-08-13).
**Rehearsed end-to-end on 2026-08-13** — every number below marked *measured*
comes from that rehearsal; anything else is labeled a guess.

Related: `docs/FIRESTORE_MANUAL_CONFIG.md` (how the protections were set up),
`docs/UPTIME_AND_SLA.md`.

## What protects production (verified 2026-08-13)

| Protection | Setting | What it gives you |
| --- | --- | --- |
| Point-in-time recovery | ENABLED, 7-day window (`versionRetentionPeriod: 604800s`) | Clone the DB at any minute-granularity timestamp in the last 7 days |
| Scheduled backups | Weekly, Sunday, 98-day (14-week) retention | Restore a Sunday snapshot up to 14 weeks back — **only backups whose `state` is `READY`** |
| Delete protection | ENABLED on `(default)` | Blocks accidental/hostile database deletion |
| Off-project copy | **NONE** | Nothing survives loss of the `aglyn-main` project itself (see gaps) |

**Backups can fail silently.** The 2026-08-02 backup sat at
`state: NOT_AVAILABLE` (unusable) with no error surfaced anywhere and no
alert; the API exposes no reason field. Before you rely on a backup, check:

```bash
gcloud firestore backups list --project=aglyn-main --location='-' \
  --format="table(name, snapshotTime, state, expireTime)"
```

## The structural fact that shapes every procedure

`gcloud firestore databases restore` (and `... clone`) **cannot write into an
existing database** — each creates a NEW database in the project. You cannot
restore "into" `(default)`, and delete protection (correctly) stops you from
deleting `(default)` to free the name. Recovery is therefore always:

1. restore/clone into a new named database,
2. verify it,
3. either point the platform at it (`FIRESTORE_DATABASE_ID`, below) or copy
   the data back into `(default)` (export/import, below).

Server-side code needs **no code change** for step 3a: every Admin-SDK
Firestore accessor (both facades — `@aglyn/shared-util-fbserver` and
`libs/tenant/data/admin/.../firebase-admin.ts` — and every `tools/` script)
reads `FIRESTORE_DATABASE_ID` at call time. Unset (the norm) targets
`(default)` exactly as before.

## RPO by scenario

| Scenario | Tool | RPO | Caveats |
| --- | --- | --- | --- |
| Bad deploy / bad script / corruption noticed within 7 days | PITR clone | ~0 (any minute in the window) | Pick the pre-damage timestamp |
| Damage older than 7 days | Weekly backup restore | Up to 7 days (Sunday snapshots), 14 weeks back | Only `READY` backups; 1 of the first 2 ever taken was not |
| `aglyn-main` project lost (deletion, billing kill, account compromise) | — | **Total loss.** No off-project copy exists | The remaining gap; see below |

## RTO (measured 2026-08-13)

- Backup restore of the 6.3 MB database into a new database: **19 min 9 s**
  (operation `startTime` 19:35:41Z → `endTime` 19:54:51Z, *measured*). The
  operation sat at 30% for most of that — restore time has a floor that is
  NOT proportional to data size; expect it to grow with data.
- Content verification (collection counts + spot reads): ~2 minutes.
- Cutover by env var: a Vercel env change + redeploy of the affected apps —
  not rehearsed against production; **guess: 15–30 minutes** including
  redeploys.
- Total realistic RTO for the rehearsed path: **guess: under 1 hour** at
  today's data size, dominated by the restore operation and redeploys.

## Procedure A — restore the weekly backup (REHEARSED)

```bash
# 1. Find the newest READY backup (NAME is the full resource path):
gcloud firestore backups list --project=aglyn-main --location='-' \
  --format="table(name, snapshotTime, state)"

# 2. Restore it into a NEW database. Name the database for the incident,
#    e.g. restore-<date>. Database ids are permanent — choose deliberately.
gcloud firestore databases restore \
  --source-backup=projects/aglyn-main/locations/nam5/backups/<BACKUP_ID> \
  --destination-database=restore-<date> \
  --project=aglyn-main

# 3. The command returns a long-running operation. Poll until done: true.
gcloud firestore operations list --project=aglyn-main \
  --database=restore-<date>

# 4. Verify contents (READS only; the inventory script honors
#    FIRESTORE_DATABASE_ID as of AGL-1490):
FIRESTORE_DATABASE_ID=restore-<date> \
  FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
  node tools/scripts/firestore-inventory.mjs
# Compare against the same script run WITHOUT FIRESTORE_DATABASE_ID.
# Expect counts to match the snapshot time, not the present.
```

Notes from the rehearsal:

- The restored database is created immediately (visible in `databases list`)
  but is not usable until the operation completes.
- The restored database inherits `DELETE_PROTECTION_ENABLED` and has PITR
  **disabled** — if it is to become long-lived, re-enable PITR:
  `gcloud firestore databases update --database=restore-<date> --enable-pitr`.
- Progress reporting is coarse (`progressPercentage` in the operation).

## Procedure B — PITR clone (lowest RPO, damage < 7 days old)

Not rehearsed (the rehearsal used Procedure A; the mechanics are the same
shape — new database, then verify/cutover):

```bash
gcloud firestore databases clone \
  --source-database=projects/aglyn-main/databases/'(default)' \
  --snapshot-time=<RFC3339, minute granularity, within the last 7 days> \
  --destination-database=restore-<date> \
  --project=aglyn-main
```

For surgical recovery (a handful of documents), stale reads at a pre-damage
timestamp against `(default)` avoid creating a database at all — Admin SDK
`readTime` queries — but that is manual work, not a procedure.

## Procedure C — pointing the platform at the restored database

`FIRESTORE_DATABASE_ID=restore-<date>` makes every **server-side** accessor
(console/tenant/marketing API routes, all `tools/` scripts) target the named
database:

- Vercel: set `FIRESTORE_DATABASE_ID` on the affected projects and redeploy.
- Local/scripts: export it in the shell or `.env`.

**What the env var does NOT cover (know this before cutting over):**

- **Browser clients.** The web SDK accessors
  (`libs/shared/util/fbclient`, `libs/tenant/feature/instance`) are
  hard-wired to `(default)`. Client-visible data (live listeners, co-editing)
  keeps reading `(default)` until data is copied back.
- **Security rules / indexes.** Rules and composite indexes deploy
  per-database; a freshly restored database has the backup's indexes but
  deploys of rules target `(default)` unless `firebase.json` is changed.
  Irrelevant for Admin-SDK access (bypasses rules), load-bearing if clients
  ever point at it.
- `pluginJobsBeat` (the only Cloud Function) does not touch Firestore
  directly — it calls a tenant API route, which is covered.

So the env override is the **inspection and stop-the-bleeding lever**; full
user-facing recovery means copying the restored data back into `(default)`:

```bash
# Requires a GCS bucket (none exists today — see gaps) and the
# "Cloud Datastore Import Export Admin" role on the Firestore service agent.
gcloud firestore export gs://<bucket>/recovery-<date> \
  --database=restore-<date> --project=aglyn-main
gcloud firestore import gs://<bucket>/recovery-<date> \
  --database='(default)' --project=aglyn-main
```

**Import semantics are merge-by-id, not replace:** documents with the same id
are overwritten to snapshot state; documents created in `(default)` AFTER the
snapshot are left in place and must be cleaned up manually if unwanted. This
leg is NOT rehearsed (no bucket exists).

## Cleaning up a rehearsal/scratch database (REHEARSED)

Restored databases inherit delete protection, so deletion is two steps —
double-check `--database` on both commands; there is no undo:

```bash
gcloud firestore databases update --database=restore-<date> \
  --project=aglyn-main --no-delete-protection
gcloud firestore databases delete --database=restore-<date> \
  --project=aglyn-main
```

A deleted database id stays reserved for a few minutes; rehearsal names are
dated so this never matters.

## Rehearsal log — 2026-08-13

- Source: backup `eb4d21e3-…d09c9d8e` (snapshot 2026-08-09T12:10:03Z, READY).
- Destination: `restore-rehearsal-2026-08-13`.
- Restore wall clock: **19 min 9 s** (op 19:35:41Z → 19:54:51Z; command
  issued 19:35:37Z).
- Verification (Admin SDK via `FIRESTORE_DATABASE_ID`, reads only):
  **18 of 20** root-collection counts identical to production; both
  differences are post-snapshot drift, i.e. the restore is a faithful
  2026-08-09 image:
  - `adminAudit` 67 restored vs 69 prod — two audit entries written after
    the snapshot;
  - `webauthnChallenges` absent in the restore — ephemeral challenge docs,
    collection was empty at snapshot time (empty collections don't exist);
  - doc-level spot checks (2 docs × 6 collections) identical except
    `hosts/-MtN17_…`, where the restored doc still carries a stray `$id`
    field that a post-snapshot write removed from prod.
- Scratch DB deleted the same day (delete-protection disable + delete).
  Gotcha: for several minutes after the restore operation reports
  `SUCCESSFUL`, deletion fails `FAILED_PRECONDITION: … in the middle of
  restore` — retry until it clears.

## Remaining gaps (open, honest)

1. **No off-project copy.** Everything lives inside `aglyn-main`. The
   one-command fix, once a bucket exists in a SEPARATE project:
   `gcloud firestore export gs://<other-project-bucket>/$(date +%F) --database='(default)' --project=aglyn-main`.
   Cost at today's size: one read per exported document (tens of thousands
   of reads ≈ cents) plus ~6.3 MB of GCS storage ≈ **well under $1/month** —
   noise against the $20/month budget. Needs: bucket + service-agent IAM +
   a Cloud Scheduler job if automated.
2. **No alert on backup state.** A backup can be `NOT_AVAILABLE`
   indefinitely with zero signal (2026-08-02 proved it). Until alerting
   exists, the weekly ops habit is the `backups list` command above.
3. **Export/import leg unrehearsed** (blocked on gap 1's bucket).
4. **Client-side database override not built** — browser SDK is pinned to
   `(default)`; acceptable while the copy-back path is the documented end
   state.
