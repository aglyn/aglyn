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

// Does ANY copy of production data live outside the production GCP project?
// (AGL-1882.)
//
// `/api/health/backups` answers "are there backups" and answered **ok** on
// 2026-08-19 — one READY managed backup 3.3 days old, one completed GCS export
// 1.9 days old — while the true state was three copies of production data and
// all three inside `aglyn-main`. That endpoint cannot see this: every probe it
// makes is a probe from inside the thing that would be lost. AGL-1490's
// rehearsal measured a 19m09s restore; it measured nothing about surviving the
// loss of the project the backup lives in.
//
//   npm run check:backup-copies             # honours ACKNOWLEDGED gaps
//   npm run check:backup-copies -- --strict # the AGL-1882 acceptance test
//   npm run check:backup-copies -- --json   # machine-readable verdict
//
// WHAT IT READS (all read-only, all metadata; zero documents, zero objects):
//   GET /storage/v1/b?project=<id>          the bucket inventory
//   GET /storage/v1/b/<bucket>              projectNumber + location + lifecycle
//   GET /storage/v1/b/<bucket>/o?matchGlob=**.overall_export_metadata
//                                           one entry per FINISHED export —
//                                           the same marker the health probe
//                                           counts, so the two cannot disagree
//                                           about what "an export" means
//   GET /storage/v1/b/<bucket>/o?prefix=…&fields=items(updated)
//                                           object COUNT and newest copy time
//                                           for each mirrored store. Object
//                                           NAMES are not requested: the
//                                           comparison does not need them, and
//                                           a checker that prints every
//                                           customer's media paths into a CI
//                                           log is a disclosure nobody asked
//                                           for.
//
// WHICH BUCKETS COUNT AS COPIES:
//   FIRESTORE_EXPORT_BUCKET  (default `<projectId>-firestore-exports`) — the
//                            same env var `/api/admin/firestore-export` and
//                            `/api/health/backups` already read, so pointing
//                            the export off-project is one variable and this
//                            check follows it automatically.
//   OFFSITE_BACKUP_BUCKET    an ADDITIONAL copy target, for the shape where
//                            the in-project export stays and a mirror is added
//                            beside it rather than replacing it.
//   STORAGE_MIRROR_BUCKET    the OBJECT mirror (AGL-2422) — a different
//                            question from the two above. Those ask about the
//                            Firestore export; this one asks whether the
//                            ~47 MiB of customer media, the audit archive and
//                            the plugin bundles are copied at all. Unset is a
//                            FINDING, not a skip, because that is the state
//                            today. Once set, the invariant is completeness:
//                            every source object present in the mirror.
//
// Auth — the drift-checkers' exact pattern, no new credential:
//   service account from the root .env (FIREBASE_PROJECT_ID,
//   FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY; self-loaded, already-set env
//   wins). It needs `storage.buckets.list/get` and `storage.objects.list`,
//   which the console SA's project-level `roles/storage.admin` already covers.
//   BACKUP_COPIES_ACCESS_TOKEN skips minting — e.g.
//   `BACKUP_COPIES_ACCESS_TOKEN=$(gcloud auth print-access-token)`, which is
//   also how you read a bucket in a project the service account cannot see.
//
// Exit codes — cannot-check must NEVER masquerade as clean:
//   0  the invariant holds, or the only failures are unexpired ACKNOWLEDGED
//      gaps (which are still printed in full)
//   1  at least one unacknowledged finding
//   2  something could not be READ (missing creds, auth, network, a bucket
//      that 404s or 403s) and nothing else failed. Findings win when both
//      occur — both are red, and a finding is the more actionable signal.
//
// A 404/403 on a configured copy bucket is exit 2, not exit 1 and never 0:
// "the mirror bucket is not there" and "I am not allowed to look at the mirror
// bucket" are different sentences, and only one of them is a backup problem.

import { loadLocalEnv } from './lib/firebase-rules-api.mjs'
import { resolveReadToken } from './lib/firestore-indexes-api.mjs'
import {
  ACKNOWLEDGED,
  MAX_EXPORT_AGE_DAYS,
  PRODUCTION_DATA_STORES,
  ageInDays,
  assessBackupCopies,
  resolveStoreName,
} from './lib/backup-copies.mjs'

loadLocalEnv()

let strict = false
let asJson = false
for (const arg of process.argv.slice(2).filter((a) => a !== '--')) {
  if (arg === '--strict') {
    strict = true
    continue
  }
  if (arg === '--json') {
    asJson = true
    continue
  }
  console.error(
    `Unknown argument '${arg}'. Usage: check-backup-copies [--strict] [--json]`,
  )
  process.exit(2)
}

function cannotCheck(lines) {
  console.error(
    [
      ...lines,
      '',
      'Exiting 2 (cannot-check). Cannot-check is NOT clean: an unread bucket',
      'is not an absent one, and reporting calm here would be the exact',
      'failure this check exists to prevent.',
    ].join('\n'),
  )
  process.exit(2)
}

// resolveReadToken() reads INDEX_CHECK_ACCESS_TOKEN; alias the checker's own
// override onto it so both drift checks keep one token-minting implementation.
if (
  process.env.BACKUP_COPIES_ACCESS_TOKEN &&
  !process.env.INDEX_CHECK_ACCESS_TOKEN
) {
  process.env.INDEX_CHECK_ACCESS_TOKEN = process.env.BACKUP_COPIES_ACCESS_TOKEN
}

const auth = await resolveReadToken()
if (auth.error) {
  cannotCheck([
    `Cannot check: ${auth.error}`,
    '',
    'This check reads the LIVE Cloud Storage inventory to decide whether any',
    'copy of production data sits outside the production project. Without',
    'credentials it cannot see live.',
    '',
    'Locally: the repo .env supplies FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL',
    'and FIREBASE_PRIVATE_KEY (self-loaded); run from a checkout root.',
    'In CI: the same repo secrets rules-drift.yml and index-drift.yml use.',
    'Alternatively set BACKUP_COPIES_ACCESS_TOKEN with FIREBASE_PROJECT_ID.',
  ])
}

const { token, projectId } = auth

async function getJson(url, what) {
  let response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch (error) {
    throw new Error(`${what}: request failed (${error.message})`, {
      cause: error,
    })
  }
  if (!response.ok) {
    throw new Error(`${what}: HTTP ${response.status}`)
  }
  return response.json()
}

// The bucket inventory doubles as the production project's OWN number: every
// bucket the project-scoped listing returns is by definition inside it, so no
// Resource Manager permission is needed to learn the number that the whole
// off-project comparison turns on.
let liveBuckets
try {
  const body = await getJson(
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}` +
      '&fields=items(name,projectNumber,location)&maxResults=1000',
    `listing buckets in ${projectId}`,
  )
  liveBuckets = body.items ?? []
} catch (error) {
  cannotCheck([`Cannot check: ${error.message}`])
}

const productionProjectNumber = liveBuckets.find(
  (bucket) => bucket.projectNumber,
)?.projectNumber
if (!productionProjectNumber) {
  cannotCheck([
    `Cannot check: no bucket in ${projectId} reported a projectNumber, so the`,
    'production project number — the entire basis of the off-project',
    'comparison — is unknown. A project with no buckets at all would also land',
    'here, and that is correct: there is then nothing to call a copy.',
  ])
}

// An UNSET GitHub `vars.*` interpolates to the empty string, not to nothing,
// so `??` is the wrong operator here: it would resolve the export bucket to
// `''` and turn a normal run into a confusing 404. Blank is unset.
const envBucket = (name) => {
  const value = process.env[name]?.trim()
  return value ? value : null
}

/** Every bucket configured to hold a copy, in the order they are checked. */
const configuredExportBucket = envBucket('FIRESTORE_EXPORT_BUCKET')
const copyTargets = [
  {
    role: 'firestore-export',
    bucket: configuredExportBucket ?? `${projectId}-firestore-exports`,
    source: configuredExportBucket ? 'FIRESTORE_EXPORT_BUCKET' : 'default',
  },
]
const offsiteBucket = envBucket('OFFSITE_BACKUP_BUCKET')
if (offsiteBucket) {
  copyTargets.push({
    role: 'offsite-mirror',
    bucket: offsiteBucket,
    source: 'OFFSITE_BACKUP_BUCKET',
  })
}

const copies = []
for (const target of copyTargets) {
  const encoded = encodeURIComponent(target.bucket)
  let meta
  let markers
  try {
    meta = await getJson(
      `https://storage.googleapis.com/storage/v1/b/${encoded}` +
        '?fields=name,projectNumber,location',
      `reading gs://${target.bucket} (from ${target.source})`,
    )
    const listed = await getJson(
      `https://storage.googleapis.com/storage/v1/b/${encoded}/o` +
        '?matchGlob=**.overall_export_metadata&fields=items(name,timeCreated)&maxResults=1000',
      `listing completed exports in gs://${target.bucket}`,
    )
    markers = listed.items ?? []
  } catch (error) {
    cannotCheck([
      `Cannot check: ${error.message}`,
      '',
      'A copy target that cannot be read is not a copy target that is absent.',
      'If this is a 403, the credential lacks storage access on that bucket —',
      'grant it, or re-run with',
      '  BACKUP_COPIES_ACCESS_TOKEN=$(gcloud auth print-access-token)',
      'If this is a 404, the bucket named in the environment does not exist:',
      'fix the variable or create the bucket, but do not let the check pass.',
    ])
  }

  const newestCompletedAt = markers
    .map((marker) => marker.timeCreated)
    .filter((iso) => Number.isFinite(Date.parse(iso ?? '')))
    .sort()
    .at(-1)

  copies.push({
    role: target.role,
    bucket: target.bucket,
    projectNumber: meta.projectNumber ?? null,
    location: meta.location ?? null,
    completedExports: markers.length,
    newestCompletedAt: newestCompletedAt ?? null,
  })
}

// ── The object mirror (AGL-2422) ──────────────────────────────────────────
//
// The export bucket above answers a question about FIRESTORE. Cloud Storage is
// a separate hole: `exportDocuments` touches no bucket contents, so customer
// media, the audit archive and the plugin bundles are copied by nothing at all
// unless a mirror exists. `STORAGE_MIRROR_BUCKET` names one bucket holding all
// of them under a prefix each (`mirrorPrefix` in PRODUCTION_DATA_STORES);
// unset means "no mirror", which is a finding, not a skip.
//
// Objects are listed with `fields=items(updated),nextPageToken` — names are
// deliberately NOT requested. The count and the newest copy time are all the
// comparison needs, and a checker that pulls a list of every customer's media
// paths into CI logs is a data-exposure decision nobody asked for.

/** Pages of 1000. 20 is ~20k objects — two orders of magnitude over today's 451. */
const MAX_LIST_PAGES = 20

/**
 * @returns {Promise<{ objects: number, newest: string | null, truncated: boolean }>}
 */
async function listObjects(bucket, prefix, what) {
  let objects = 0
  let newest = null
  let pageToken = null
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const url =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o` +
      `?prefix=${encodeURIComponent(prefix)}&fields=items(updated),nextPageToken&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const body = await getJson(url, what)
    for (const item of body.items ?? []) {
      objects += 1
      if (item.updated && (newest === null || item.updated > newest)) {
        newest = item.updated
      }
    }
    pageToken = body.nextPageToken ?? null
    if (!pageToken) return { objects, newest, truncated: false }
  }
  // Ran out of pages with a token still in hand: the count is a floor.
  return { objects, newest, truncated: true }
}

const mirrorBucket = envBucket('STORAGE_MIRROR_BUCKET')
let storageMirror = null
if (mirrorBucket) {
  try {
    const meta = await getJson(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(mirrorBucket)}` +
        '?fields=name,projectNumber,location,versioning',
      `reading gs://${mirrorBucket} (from STORAGE_MIRROR_BUCKET)`,
    )
    const stores = []
    for (const store of PRODUCTION_DATA_STORES.filter((s) => s.mirrorPrefix)) {
      const name = resolveStoreName(store.bucket, {
        projectId,
        projectNumber: productionProjectNumber,
      })
      const source = await listObjects(name, '', `listing gs://${name}`)
      const mirrored = await listObjects(
        mirrorBucket,
        store.mirrorPrefix,
        `listing gs://${mirrorBucket}/${store.mirrorPrefix}`,
      )
      stores.push({
        name,
        prefix: store.mirrorPrefix,
        sourceObjects: source.objects,
        sourceNewest: source.newest,
        sourceTruncated: source.truncated,
        mirrorObjects: mirrored.objects,
        mirrorNewest: mirrored.newest,
        mirrorTruncated: mirrored.truncated,
      })
    }
    storageMirror = {
      bucket: mirrorBucket,
      projectNumber: meta.projectNumber ?? null,
      location: meta.location ?? null,
      // An ABSENT `versioning` object means disabled, and so does
      // `{enabled: false}`. Both must read as false; `!!meta.versioning` alone
      // would call a disabled-but-once-configured bucket versioned.
      versioningEnabled: meta.versioning?.enabled === true,
      stores,
    }
  } catch (error) {
    cannotCheck([
      `Cannot check: ${error.message}`,
      '',
      'STORAGE_MIRROR_BUCKET names an object mirror that could not be read. A',
      'mirror that cannot be read is not a mirror that is absent, and it is',
      'certainly not a mirror that is complete.',
      'A 403 means the credential lacks storage access on that bucket — grant it',
      'roles/storage.objectViewer + roles/storage.legacyBucketReader there, or',
      're-run with BACKUP_COPIES_ACCESS_TOKEN=$(gcloud auth print-access-token).',
      'A 404 means the bucket named does not exist: fix the variable or create',
      'the bucket, but do not let the check pass.',
    ])
  }
}

const now = Date.now()
const verdict = assessBackupCopies({
  projectId,
  productionProjectNumber,
  copies,
  liveBuckets,
  storageMirror,
  now,
  strict,
})

if (asJson) {
  console.log(
    JSON.stringify(
      { projectId, productionProjectNumber, strict, ...verdict },
      null,
      2,
    ),
  )
  process.exit(verdict.ok ? 0 : 1)
}

console.log(
  `Backup copies — project ${projectId} (${productionProjectNumber})${strict ? ' [strict]' : ''}\n`,
)

console.log('Copy targets:')
for (const copy of verdict.inventory.offProject.concat(
  verdict.inventory.inProject,
)) {
  const where =
    copy.projectNumber === productionProjectNumber
      ? 'IN the production project'
      : `OFF-PROJECT (project ${copy.projectNumber})`
  const age = ageInDays(copy.newestCompletedAt, now)
  console.log(
    `  gs://${copy.bucket} [${copy.role}] — ${where}, ${copy.location ?? 'unknown location'}, ` +
      `${copy.completedExports} completed export(s)` +
      (age === null
        ? ''
        : `, newest ${age}d old (budget ${MAX_EXPORT_AGE_DAYS}d)`),
  )
}

console.log('\nProduction data stores:')
for (const store of verdict.inventory.declared) {
  console.log(`  gs://${store.name} — ${store.holds}`)
  console.log(
    `      copied by: ${store.copiedBy}` +
      (store.mirrorPrefix ? ` (mirror prefix ${store.mirrorPrefix})` : ''),
  )
}

console.log('\nObject mirror (AGL-2422):')
if (!storageMirror) {
  console.log(
    '  STORAGE_MIRROR_BUCKET is not set — no copy of Cloud Storage exists.\n' +
      `  ${verdict.inventory.mirroredStores.length} store(s) of primary data are copied by nothing:\n` +
      verdict.inventory.mirroredStores
        .map((store) => `    gs://${store.name} → would mirror to ${store.mirrorPrefix}`)
        .join('\n'),
  )
} else {
  const where =
    storageMirror.projectNumber === productionProjectNumber
      ? 'IN the production project'
      : `OFF-PROJECT (project ${storageMirror.projectNumber})`
  console.log(
    `  gs://${storageMirror.bucket} — ${where}, ${storageMirror.location ?? 'unknown location'}, ` +
      `versioning ${storageMirror.versioningEnabled ? 'ON' : 'OFF'}`,
  )
  for (const store of storageMirror.stores) {
    const flag =
      store.sourceTruncated || store.mirrorTruncated
        ? ' [TRUNCATED — counts are floors]'
        : ''
    console.log(
      `    gs://${store.name} → ${store.prefix}: ` +
        `${store.mirrorObjects}/${store.sourceObjects} objects, ` +
        `source newest ${store.sourceNewest ?? 'n/a'}, mirror newest ${store.mirrorNewest ?? 'n/a'}${flag}`,
    )
  }
}

if (verdict.acknowledged.length > 0) {
  console.log('\nACKNOWLEDGED gaps (real, open, not failing this run):')
  for (const finding of verdict.acknowledged) {
    const entry = ACKNOWLEDGED.find((e) => e.code === finding.code)
    console.log(`  [${finding.code}] ${finding.title}`)
    console.log(`      ${finding.detail}`)
    console.log(
      `      owned by ${entry.issue}; this acknowledgement expires ${entry.expires}, after which this run fails with no edit to any file.`,
    )
    console.log(`      ${entry.why}`)
  }
  console.log(
    '\n  Re-run with --strict to see the verdict without the acknowledgement.',
  )
}

if (verdict.failing.length > 0) {
  console.error('\nFINDINGS:')
  for (const finding of verdict.failing) {
    console.error(`  [${finding.code}] ${finding.title}`)
    console.error(`      ${finding.detail}`)
  }
  console.error(
    '\nExiting 1. See docs/DISASTER_RECOVERY.md "Remaining gaps" for the ordered\n' +
      'commands that close the off-project gap.',
  )
  process.exit(1)
}

console.log(
  verdict.acknowledged.length > 0
    ? '\nNo unacknowledged findings.'
    : '\nAt least one fresh copy of production data lives outside the production\n' +
        'project, and every store that needs an object mirror has a complete one.',
)
