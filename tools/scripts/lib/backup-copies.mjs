/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// The pure half of the backup-copy guard (AGL-1882).
//
// ## The question this answers
//
// Not "do backups exist" — `/api/health/backups` already answers that, and it
// answered "ok" on 2026-08-19 while the true state was **every copy of
// production data inside one GCP project**. A compromised service account, a
// billing suspension, or a project deletion takes the data and every copy of
// it in one move, and no probe that looks *inside* that project can see it
// coming. AGL-1490's rehearsal (measured RTO 19m09s) proved the restore path
// works; it proved nothing about the copies surviving loss of the project.
//
// So the invariant here is deliberately one the existing health endpoint
// cannot express: **at least one durable copy of production data lives in a
// GCP project that is NOT the production project**, and it is fresh.
//
// ## Why the test is projectNumber, never the bucket name
//
// `gs://aglyn-main-firestore-exports` reads like an export target and IS one;
// it is also inside `aglyn-main`. Names are a naming convention, not a
// containment fact. Every copy the checker considers is resolved through
// `GET /storage/v1/b/<bucket>?fields=projectNumber` and compared against the
// production project's own number, so "off-project" means what it says and a
// rename cannot fake it. The negative control for that comparison is real and
// cheap: point `FIRESTORE_EXPORT_BUCKET` at a bucket in a sibling project and
// the verdict flips, with no name pattern involved.
//
// ## The second thing it watches: stores nobody classified
//
// The weekly export covers **Firestore only**. The Cloud Storage buckets —
// customer media, `adminAudit-archive/`, plugin bundles — are copied by
// nothing, in-project or out (AGL-2422). That is a fact about today, and the
// way it stays visible is `PRODUCTION_DATA_STORES` below: every bucket in the
// production project, what it holds, and what copies it. The checker diffs
// that declaration against the LIVE bucket list, so a new bucket appearing in
// production goes red until somebody writes down whether it needs a copy —
// and a declared bucket that vanishes goes red the other way, so the list
// cannot rot into fiction the way a comment does.

/**
 * Weekly cadence (Mondays 05:00 UTC, `scheduled-crons.yml`) plus one day of
 * slack.
 *
 * MIRRORS `MAX_EXPORT_AGE_DAYS` in `libs/aglyn/src/lib/app-utils/health-report.ts`
 * — the same budget the public health endpoint applies to the in-project
 * export, because an off-project copy that lags the in-project one is not a
 * second restore point, it is a slower first one. The agreement between the
 * two constants is asserted in `backup-copies.test.mjs` rather than trusted:
 * one of them moving alone is exactly the drift nobody would notice.
 */
export const MAX_EXPORT_AGE_DAYS = 8

/**
 * How far the object mirror may lag its source before that is a finding
 * (AGL-2422).
 *
 * Deliberately NOT a wall-clock freshness budget, because object timestamps
 * cannot express one. A sync that runs nightly over a bucket nobody wrote to
 * copies nothing, so the mirror's newest object stays exactly as old as the
 * source's and a "newest object younger than N days" rule would go red on a
 * perfectly healthy mirror of a quiet bucket. What object times CAN prove is
 * **completeness**: the destination object's `updated` is its copy time, so
 * once a sync has caught up the mirror's newest is at or after the source's.
 * A sync that stopped running is therefore invisible until something is
 * written — and visible the moment it is, which is also the only moment it
 * costs anything. Two days is one nightly run plus a day of slack, and it
 * doubles as the tolerance for a write that landed while the sync was in
 * flight.
 */
export const MAX_MIRROR_LAG_DAYS = 2

/**
 * Every bucket that exists in the production project, and what copies it.
 *
 * A statement of fact, not permission to add more. `copiedBy` is the honest
 * answer today, and `'none'` appears three times on purpose: writing "nothing
 * copies customer media" into a file a guard reads is the difference between
 * a known gap and a surprise during an incident.
 *
 * `{projectNumber}` is substituted with the production project's number, so
 * the generated Cloud Functions buckets can be declared without pinning this
 * file to one project id.
 *
 * `mirrorPrefix` marks a store as **primary data that a copy must exist for**
 * — the AGL-2422 set. It names the prefix that store occupies inside the
 * single off-project mirror bucket (`STORAGE_MIRROR_BUCKET`); one bucket with
 * a prefix per source, rather than a bucket each, because the lifecycle, the
 * IAM and the versioning setting that make the mirror safe are then written
 * once instead of drifting apart. A store WITHOUT `mirrorPrefix` is one
 * nobody has to copy, and the `why` says why.
 *
 * @type {ReadonlyArray<{
 *   bucket: string,
 *   holds: string,
 *   copiedBy: 'firestore-export' | 'is-the-copy' | 'none' | 'nothing-to-copy' | 'storage-mirror',
 *   why: string,
 *   mirrorPrefix?: string,
 * }>}
 */
export const PRODUCTION_DATA_STORES = [
  {
    bucket: '{projectId}.appspot.com',
    holds:
      'Live customer media under orgs/{orgId}/ (35.7 MiB), the legacy pre-AGL-237 hosts/{hostId}/media/ path (11.2 MiB, still served), users/{uid}/ avatars, plus the adminAudit-archive/ and erasures/ retention prefixes (both empty on 2026-08-20)',
    copiedBy: 'none',
    why: 'AGL-2422. 451 objects / ~47 MiB of primary data with no copy anywhere — no object versioning, no mirror; the only safety net is the bucket default 7-day soft delete, which a lifecycle-rule mistake outlives. The weekly Firestore export does not touch Storage. NOTE the holds line names hosts/ and users/ deliberately: it read as orgs/ only until 2026-08-20, and hosts/ is a QUARTER of the bucket — a mirror scoped from that description would have silently omitted it.',
    mirrorPrefix: 'media/',
  },
  {
    bucket: '{projectId}-plugin-artifacts',
    holds: 'Published plugin bundles the marketplace serves (7 objects)',
    copiedBy: 'none',
    why: 'AGL-2422. Invisible to the Firebase console (it is a plain GCS bucket, not the Firebase default), so it is absent from every Firebase-shaped review. Small (~28 KiB) but not reconstructible — a publisher-signed artifact cannot be rebuilt from source on our side.',
    mirrorPrefix: 'plugin-artifacts/',
  },
  {
    bucket: '{projectId}-firestore-exports',
    holds: 'Weekly Firestore exportDocuments snapshots (90-day lifecycle)',
    copiedBy: 'is-the-copy',
    why: 'AGL-1843. This IS the independent Firestore copy — and it lives in the production project, which is the whole of AGL-1882.',
  },
  {
    bucket: 'staging.{projectId}.appspot.com',
    holds: 'App Engine deployment staging artifacts',
    copiedBy: 'nothing-to-copy',
    why: 'Google-managed build staging, 15-day lifecycle. Holds no production data.',
  },
  {
    bucket: 'gcf-v2-sources-{projectNumber}-us-central1',
    holds: 'Cloud Functions v2 source archives',
    copiedBy: 'nothing-to-copy',
    why: 'Function source, reproducible from git (cloud/functions). Losing it costs a redeploy, not data.',
  },
  {
    bucket:
      'gcf-v2-uploads-{projectNumber}.us-central1.cloudfunctions.appspot.com',
    holds: 'Cloud Functions v2 upload staging',
    copiedBy: 'nothing-to-copy',
    why: 'Google-managed deploy scratch space. Holds no production data.',
  },
]

/**
 * Findings the checker is allowed to report without failing — each one a gap
 * somebody has SEEN, with the issue that owns it and the date the excuse dies.
 *
 * This exists so the guard is neither a muted alarm nor an amnesiac. A check
 * that is red every single day until one person does one thing gets ignored,
 * and then it is worth nothing on the day something ELSE breaks. A check that
 * simply omits the known gap forgets it. So the gap is reported in full, in
 * the output, every run — and on `expires` it becomes an ordinary red with no
 * further edit, which is the only kind of deadline a file can keep.
 *
 * `--strict` ignores this list entirely: that is the "is it actually fixed
 * yet" invocation, and the acceptance test for AGL-1882.
 *
 * @type {ReadonlyArray<{ code: string, issue: string, expires: string, why: string }>}
 */
export const ACKNOWLEDGED = [
  {
    code: 'no-off-project-copy',
    issue: 'AGL-1882',
    expires: '2026-09-01',
    why: 'Closing this means creating a bucket in a second GCP project — a cloud-resource change only Zach can make (docs/DISASTER_RECOVERY.md, gap 1, has the exact commands). Expires on the public-beta date because launching with paying customers and zero off-project copies is a different decision from carrying the gap pre-revenue.',
  },
  {
    code: 'no-storage-mirror',
    issue: 'AGL-2422',
    expires: '2026-09-01',
    why: 'Same shape and the same sitting as AGL-1882: the mirror bucket is a cloud resource, and docs/DISASTER_RECOVERY.md gap 6 carries the ordered commands. Everything on this side of the line is done — set STORAGE_MIRROR_BUCKET and this check starts proving the mirror is complete instead of reporting its absence. Expires on the public-beta date for the same reason the other one does: media we cannot restore is a promise we cannot make to somebody paying us.',
  },
]

/**
 * @typedef {{
 *   role: string,
 *   bucket: string,
 *   projectNumber: string | null,
 *   location: string | null,
 *   completedExports: number,
 *   newestCompletedAt: string | null,
 * }} CopyBucket
 */

/**
 * @typedef {{ code: string, title: string, detail: string }} Finding
 */

/**
 * One source store measured against its prefix inside the mirror bucket.
 *
 * `truncated` is not a detail. Both listings are paginated and capped, and a
 * count comparison that silently stopped early would report "mirror complete"
 * for the one bucket big enough to matter. When either side is truncated the
 * comparison is reported as unproven and never as clean.
 *
 * @typedef {{
 *   name: string,
 *   prefix: string,
 *   sourceObjects: number,
 *   sourceNewest: string | null,
 *   sourceTruncated: boolean,
 *   mirrorObjects: number,
 *   mirrorNewest: string | null,
 *   mirrorTruncated: boolean,
 * }} MirroredStore
 */

/**
 * @typedef {{
 *   bucket: string,
 *   projectNumber: string | null,
 *   location: string | null,
 *   versioningEnabled: boolean,
 *   stores: MirroredStore[],
 * }} StorageMirror
 */

const DAY_MS = 86_400_000

/** Substitute the production project's identifiers into a declared name. */
export function resolveStoreName(bucket, { projectId, projectNumber }) {
  return bucket
    .replaceAll('{projectId}', projectId)
    .replaceAll('{projectNumber}', projectNumber)
}

/**
 * Age in days, one decimal — the same rounding the health endpoint uses so
 * the two numbers can be compared by eye during an incident.
 */
export function ageInDays(iso, now) {
  const time = Date.parse(iso ?? '')
  if (!Number.isFinite(time)) return null
  return Math.round(((now - time) / DAY_MS) * 10) / 10
}

/**
 * The whole verdict, from already-fetched facts. No I/O, so every branch below
 * is reachable from a test — including the green one, which no amount of
 * running this against production could currently produce.
 *
 * @param {{
 *   projectId: string,
 *   productionProjectNumber: string,
 *   copies: CopyBucket[],
 *   liveBuckets: { name: string, projectNumber?: string, location?: string }[],
 *   storageMirror?: StorageMirror | null,
 *   now?: number,
 *   strict?: boolean,
 * }} input
 */
export function assessBackupCopies({
  projectId,
  productionProjectNumber,
  copies,
  liveBuckets,
  storageMirror = null,
  now = Date.now(),
  strict = false,
}) {
  /** @type {Finding[]} */
  const findings = []

  const offProject = copies.filter(
    (copy) =>
      copy.projectNumber !== null &&
      copy.projectNumber !== productionProjectNumber,
  )
  const inProject = copies.filter(
    (copy) => copy.projectNumber === productionProjectNumber,
  )

  if (offProject.length === 0) {
    findings.push({
      code: 'no-off-project-copy',
      title: 'Every copy of production data is inside the production project',
      detail: [
        `Checked ${copies.length} copy bucket(s); all resolve to project number`,
        `${productionProjectNumber} (${projectId}), the same project that serves`,
        'production. A compromised service account, a billing suspension or a',
        'project deletion removes the data AND every copy in one action, and the',
        'measured 19m09s restore (AGL-1490) does not apply to any of them.',
      ].join(' '),
    })
  }

  // Freshness is asked of the OFF-PROJECT copies only. The in-project export's
  // age is already watched by /api/health/backups; re-reporting it here would
  // add a second alarm for one condition and no coverage for this one.
  for (const copy of offProject) {
    if (copy.completedExports === 0) {
      findings.push({
        code: 'off-project-copy-empty',
        title: `Off-project bucket gs://${copy.bucket} holds no completed export`,
        detail:
          'The bucket is genuinely outside the production project, but nothing ' +
          'has finished writing into it — no *.overall_export_metadata marker. ' +
          'An empty off-project bucket restores nothing; this is the shape a ' +
          'half-finished cutover leaves behind.',
      })
      continue
    }
    const age = ageInDays(copy.newestCompletedAt, now)
    if (age === null || age > MAX_EXPORT_AGE_DAYS) {
      findings.push({
        code: 'off-project-copy-stale',
        title: `Off-project copy in gs://${copy.bucket} is stale`,
        detail:
          `Newest completed export is ${age === null ? 'of unreadable age' : `${age} days old`}` +
          `, past the ${MAX_EXPORT_AGE_DAYS}-day budget (weekly cadence + a day of slack). ` +
          'A copy that stopped being written is not a second restore point.',
      })
    }
  }

  // The declared inventory, diffed against live in both directions.
  const declared = PRODUCTION_DATA_STORES.map((store) => ({
    ...store,
    name: resolveStoreName(store.bucket, {
      projectId,
      projectNumber: productionProjectNumber,
    }),
  }))
  const declaredNames = new Set(declared.map((store) => store.name))
  const liveNames = new Set(liveBuckets.map((bucket) => bucket.name))

  const undeclared = [...liveNames].filter((name) => !declaredNames.has(name))
  const missing = declared
    .filter((store) => !liveNames.has(store.name))
    .map((store) => store.name)

  if (undeclared.length > 0) {
    findings.push({
      code: 'undeclared-data-store',
      title: `${undeclared.length} bucket(s) in ${projectId} that nobody classified`,
      detail: [
        undeclared.map((name) => `gs://${name}`).join(', '),
        '— add each to PRODUCTION_DATA_STORES in tools/scripts/lib/backup-copies.mjs',
        'with what it holds and what copies it. A bucket appearing in production',
        'without anyone answering "does this need a backup" is how the plugin-artifact',
        'bucket spent a month invisible to every Firebase-shaped review.',
      ].join(' '),
    })
  }

  if (missing.length > 0) {
    findings.push({
      code: 'declared-store-missing',
      title: `${missing.length} declared store(s) no longer exist`,
      detail: [
        missing.map((name) => `gs://${name}`).join(', '),
        '— either the bucket was deleted (in which case say so somewhere before',
        'removing the line) or this declaration was always wrong. Both are worth',
        'a human; neither is worth silence.',
      ].join(' '),
    })
  }

  // ── The Cloud Storage half (AGL-2422) ────────────────────────────────────
  //
  // Everything above is about the FIRESTORE export: where it lives and how old
  // it is. `exportDocuments` copies documents and touches no bucket contents,
  // so none of it says anything at all about the ~47 MiB of customer media,
  // the audit archive, or the plugin bundles. The stores that need a copy are
  // exactly the ones declaring `mirrorPrefix`, and the invariant asked of the
  // mirror is COMPLETENESS rather than existence: a mirror bucket that is
  // present, off-project and missing half the objects restores half a
  // workspace, and reads identically to a healthy one from any distance.
  const mirroredStores = declared.filter((store) => store.mirrorPrefix)

  if (mirroredStores.length > 0 && !storageMirror) {
    findings.push({
      code: 'no-storage-mirror',
      title: `${mirroredStores.length} store(s) of primary data are copied by nothing`,
      detail: [
        mirroredStores.map((store) => `gs://${store.name}`).join(', '),
        '— no STORAGE_MIRROR_BUCKET is configured, so these have no copy at all:',
        'not off-project, not in-project. The only safety net is the bucket-default',
        '7-day soft delete, which is the default on every bucket and which a',
        'mis-scoped lifecycle rule outlives comfortably. A Firestore restore into',
        'a bucket that lost its objects reports SUCCESS and yields a consistent',
        'database of broken media references.',
      ].join(' '),
    })
  }

  if (storageMirror) {
    if (storageMirror.projectNumber === productionProjectNumber) {
      findings.push({
        code: 'storage-mirror-in-production-project',
        title: `The object mirror gs://${storageMirror.bucket} is inside the production project`,
        detail: [
          `It resolves to project number ${storageMirror.projectNumber}, the same`,
          'project that serves production. A copy there survives a bad script and a',
          'stray delete; it does not survive the loss of the project, which is the',
          'failure AGL-1882 is about and the one a mirror is usually bought for.',
          'The name is not the test — this is projectNumber, so no rename can fake it.',
        ].join(' '),
      })
    }

    if (!storageMirror.versioningEnabled) {
      findings.push({
        code: 'storage-mirror-unversioned',
        title: `The object mirror gs://${storageMirror.bucket} has no object versioning`,
        detail: [
          'A mirror that propagates deletes has no undo without versioning: the run',
          'that copies a mistaken deletion into the mirror is the run that destroys',
          'the last copy, and it looks exactly like a successful sync. A mirror that',
          'does NOT propagate deletes has the opposite problem — an erased',
          "customer's media stays in it forever, which is a DPA §11 answer nobody",
          'wants to give. Versioning plus a noncurrent-version expiry',
          '(cloud/storage-mirror-lifecycle.json) is what makes the delete-propagating',
          'shape safe, and it must be ON BEFORE the first sync, never after.',
        ].join(' '),
      })
    }

    // A store declared as needing a copy that the mirror measurement does not
    // MENTION is the quietest failure available here: every store it did
    // measure is complete, so the run is green, and the omitted one is the
    // whole loss. The declaration is the authority; the measurement is checked
    // against it, never the other way round.
    const measured = new Set(storageMirror.stores.map((store) => store.name))
    const unmeasured = mirroredStores.filter(
      (store) => !measured.has(store.name),
    )
    if (unmeasured.length > 0) {
      findings.push({
        code: 'storage-mirror-store-unmeasured',
        title: `${unmeasured.length} store(s) needing a copy were never compared with the mirror`,
        detail: [
          unmeasured.map((store) => `gs://${store.name}`).join(', '),
          '— PRODUCTION_DATA_STORES says these need a mirror and nothing measured',
          'whether they have one. Every store that WAS measured could be complete,',
          'making this run green while the omitted store is copied by nothing.',
          'Extend the sync AND the comparison together, or drop the mirrorPrefix',
          'and say in `why` what covers the store instead.',
        ].join(' '),
      })
    }

    for (const store of storageMirror.stores) {
      if (store.sourceTruncated || store.mirrorTruncated) {
        findings.push({
          code: 'storage-mirror-comparison-truncated',
          title: `Could not finish comparing gs://${store.name} with its mirror`,
          detail: [
            `Object listing hit the page cap on the ${store.sourceTruncated ? 'source' : ''}`,
            `${store.sourceTruncated && store.mirrorTruncated ? ' and ' : ''}${store.mirrorTruncated ? 'mirror' : ''} side,`,
            'so the object counts below are floors and the completeness comparison',
            'proves nothing. This is reported as a finding rather than folded into',
            'the counts on purpose: a truncated listing that renders as "mirror',
            'complete" is the exact false green this whole check exists to avoid.',
            'Raise the cap or compare with `gcloud storage rsync --dry-run`.',
          ].join(' '),
        })
        continue
      }

      if (store.mirrorObjects < store.sourceObjects) {
        findings.push({
          code: 'storage-mirror-incomplete',
          title: `The mirror of gs://${store.name} is missing objects`,
          detail: [
            `Source holds ${store.sourceObjects} object(s); the mirror prefix`,
            `${store.prefix} in gs://${storageMirror.bucket} holds ${store.mirrorObjects}.`,
            'A partial mirror restores a partial workspace. The mirror may legitimately',
            'hold MORE than the source — an object the source lifecycle expired is still',
            'in the copy, which is the point — so only the deficit is a finding.',
          ].join(' '),
        })
        continue
      }

      // Freshness, expressed the only way object metadata can express it: the
      // destination object's `updated` is its COPY time, so a caught-up mirror
      // is at or after its source. See MAX_MIRROR_LAG_DAYS for why there is no
      // wall-clock budget here.
      if (store.sourceObjects === 0) continue
      const sourceTime = Date.parse(store.sourceNewest ?? '')
      const mirrorTime = Date.parse(store.mirrorNewest ?? '')
      if (!Number.isFinite(sourceTime)) continue
      const lagDays = Number.isFinite(mirrorTime)
        ? Math.round(((sourceTime - mirrorTime) / DAY_MS) * 10) / 10
        : null
      if (lagDays === null || lagDays > MAX_MIRROR_LAG_DAYS) {
        findings.push({
          code: 'storage-mirror-stale',
          title: `The mirror of gs://${store.name} has stopped keeping up`,
          detail: [
            lagDays === null
              ? 'The mirror prefix holds no object with a readable timestamp, while the source does.'
              : `The mirror's newest object predates the source's by ${lagDays} days, past the ${MAX_MIRROR_LAG_DAYS}-day budget.`,
            'Object counts match or exceed, so this is not a missing object — it is a',
            'sync that ran and then stopped, with the objects it had already copied',
            'left behind to look like a healthy mirror. Check the transfer job ran,',
            'and check it still has write access to the mirror bucket.',
          ].join(' '),
        })
      }
    }
  }

  const acknowledged = strict
    ? []
    : findings.filter((finding) =>
        ACKNOWLEDGED.some(
          (entry) =>
            entry.code === finding.code && Date.parse(entry.expires) > now,
        ),
      )
  const acknowledgedCodes = new Set(acknowledged.map((f) => f.code))
  const failing = findings.filter(
    (finding) => !acknowledgedCodes.has(finding.code),
  )

  return {
    ok: failing.length === 0,
    findings,
    failing,
    acknowledged,
    inventory: {
      offProject,
      inProject,
      declared,
      undeclared,
      missing,
      mirroredStores,
      storageMirror,
    },
  }
}
