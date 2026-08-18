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
| Independent GCS export | Weekly (Mondays 05:00 UTC), `gs://aglyn-main-firestore-exports`, 90-day lifecycle | A portable snapshot **not** subject to the managed-backup `NOT_AVAILABLE` flip; restorable by import into any database (Procedure D). Added 2026-08-17 (AGL-1843) |
| Off-project copy | **NONE** | Nothing survives loss of the `aglyn-main` project itself — the export bucket lives IN `aglyn-main` (see gaps) |

**Backups can fail silently — and a READY backup can STOP being restorable.**
(AGL-1490, AGL-1843.) As of 2026-08-17, **every backup this project has taken
has flipped `READY` → `state: NOT_AVAILABLE` at roughly one week old**: the
2026-08-02 backup (never READY as far as anyone observed), and the 2026-08-09
backup — which was READY at age 4 days and was the *successfully restored
source of the 2026-08-13 rehearsal* — was NOT_AVAILABLE by age 8 days. Both
have `expireTime` months out, so this is not retention expiry. The flip window
(~day 7) coincides with the 7-day PITR `versionRetentionPeriod`; cause is
unestablished — the API exposes no reason field anywhere (list, describe, and
raw REST all return only `name/database/databaseUid/snapshotTime/expireTime/state`).
Until a Google support case resolves it, assume the **effective restorable
depth is the single newest backup (≤ 7 days old)**, not 14 weeks — that is
why the weekly GCS export exists (see "The weekly GCS export" below): a copy
whose lifetime we control, watched by the same health endpoint. Before you
rely on a backup, check:

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
| Damage older than 7 days | Weekly backup restore | Up to 7 days (Sunday snapshots); nominally 14 weeks back | Only `READY` backups — and as of 2026-08-17 every backup has gone `NOT_AVAILABLE` at ~1 week old (AGL-1843), so in practice this row currently collapses into the PITR window |
| Damage older than 7 days, backup flipped | GCS export import (Procedure D) | Up to 7 days (Monday exports); 90-day lifecycle depth | Import is merge-by-id into a NEW database; export files do not expire out from under you the way a backup's `state` can |
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
  (`libs/tenant/feature/instance`) are
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
# The export bucket exists since 2026-08-17 (AGL-1843) and the IAM is in
# place — see "The weekly GCS export" below.
gcloud firestore export gs://aglyn-main-firestore-exports/recovery-<date> \
  --database=restore-<date> --project=aglyn-main
gcloud firestore import gs://aglyn-main-firestore-exports/recovery-<date> \
  --database='(default)' --project=aglyn-main
```

**Import semantics are merge-by-id, not replace:** documents with the same id
are overwritten to snapshot state; documents created in `(default)` AFTER the
snapshot are left in place and must be cleaned up manually if unwanted. This
leg is NOT rehearsed (no bucket exists).

## The weekly GCS export (AGL-1843) — what runs, how to run it by hand

Set up 2026-08-17 because of the `NOT_AVAILABLE` flip: managed backups were
the only restore points and they were dying at ~day 7. The export is a copy
whose lifetime we control.

**What exists (all verified 2026-08-17):**

- Bucket `gs://aglyn-main-firestore-exports` — `US` multi-region (matches
  `nam5`), uniform bucket-level access, public-access prevention enforced,
  lifecycle: delete objects at age 90 days (~13 weekly exports of depth).
- IAM: `firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com` holds
  project-level `roles/datastore.importExportAdmin` (granted 2026-08-17; its
  pre-existing project-level `roles/storage.admin` covers the bucket). The
  Firestore service agent
  `service-543499566626@gcp-sa-firestore.iam.gserviceaccount.com` holds
  `roles/storage.admin` on the bucket — that agent, not the caller, writes
  the objects.
- Trigger: `scheduled-crons.yml` POSTs `/api/admin/firestore-export`
  (cron-secret auth) Mondays 05:00 UTC — the day after the Sunday managed
  backup, so the two restore points are staggered. The route only STARTS the
  long-running export; `/api/health/backups` (`checks.exports`) watches that
  the newest completed export stays under 8 days old, so a run that starts
  and never finishes still alerts.
- First export ran 2026-08-17 end to end as the service account (REST
  `exportDocuments`): 2,166 documents / 4.3 MiB in **1m42s** (*measured*),
  completion marker
  `<prefix>/<prefix>.overall_export_metadata` present.

**Manual run** (either path):

```bash
# As yourself, via gcloud (needs Owner or datastore.importExportAdmin):
gcloud firestore export \
  "gs://aglyn-main-firestore-exports/$(date -u +%Y-%m-%dT%H-%M-%SZ)" \
  --database='(default)' --project=aglyn-main

# Or exactly what the scheduler does (also the workflow_dispatch option on
# the "Scheduled console crons" GitHub workflow):
curl -X POST https://app.aglyn.com/api/admin/firestore-export \
  -H "x-cron-secret: $CRON_SECRET"
```

Cost per run at today's size: one read per exported document (thousands of
reads ≈ cents) + ~4 MiB stored. Noise against the $20/month budget.

## Procedure D — restore from a GCS export (import leg NOT rehearsed)

Exports restore by **import**, and unlike `databases restore`, import CAN
target an existing database — but its semantics are **merge-by-id, not
replace** (same caveat as Procedure C): documents with matching ids are
overwritten to snapshot state, documents created after the snapshot remain.
For a clean image, import into a NEW empty database; overwrite-import into
`(default)` only when merge semantics are what you want.

```bash
# 1. Pick the export (each prefix is one complete export; the
#    *.overall_export_metadata marker inside proves it FINISHED):
gcloud storage ls gs://aglyn-main-firestore-exports/

# 2a. Clean image: create a fresh database, then import into it.
gcloud firestore databases create --database=restore-<date> \
  --location=nam5 --project=aglyn-main
gcloud firestore import gs://aglyn-main-firestore-exports/<PREFIX> \
  --database=restore-<date> --project=aglyn-main

# 2b. Merge into (default) — overwrites matching ids, keeps post-snapshot
#     documents. Understand that before running it.
gcloud firestore import gs://aglyn-main-firestore-exports/<PREFIX> \
  --database='(default)' --project=aglyn-main

# 3. Import is a long-running operation; poll and then verify exactly as in
#    Procedure A steps 3–4.
```

Two honest caveats, both measured elsewhere but not here: the import leg has
**never been rehearsed** (gap 3), and an imported database rebuilds indexes
after the data lands — budget time beyond the copy itself.

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

1. **No off-project copy.** The weekly export (AGL-1843) creates an
   independent copy, but its bucket lives inside `aglyn-main` — loss of the
   project still loses everything. The remaining move is deliberately left
   as a human decision (it means creating and paying for a second GCP
   project): create a bucket in a SEPARATE project, grant this project's
   Firestore service agent write on it, and either point
   `FIRESTORE_EXPORT_BUCKET` (console env) at it or add a second export/copy
   step. The exact steps are written on AGL-1843. Everything else about the
   export path — IAM, route, cron, health check — carries over unchanged;
   only the bucket's project changes.
2. **Alert on backup state — CLOSED 2026-08-13 (AGL-1502).**
   `GET https://app.aglyn.com/api/health/backups` returns 503 when any
   backup is in a failed state, no READY backup exists, or the newest READY
   backup is older than 8 days (weekly cadence + one day of slack). A GCP
   Monitoring uptime check probes it every 15 minutes and emails
   zach@aglyn.com on failure — see `docs/UPTIME_AND_SLA.md` §"Production
   monitoring". The 2026-08-02 `NOT_AVAILABLE` backup keeps this alert red
   until it is deleted or expires (2026-11-08); that is deliberate — half
   the restore points being gone is the condition that must page someone.
3. **Import leg unrehearsed.** The export leg is real as of 2026-08-17
   (run end to end, completion marker verified, 1m42s), but no import from
   an export has ever been performed — Procedure D's copy-back numbers are
   guesses until one is rehearsed into a scratch database.
4. **Client-side database override not built** — browser SDK is pinned to
   `(default)`; acceptable while the copy-back path is the documented end
   state.
