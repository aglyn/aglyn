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

// Guards the guard (AGL-1882). Everything downstream trusts this comparator's
// verdict about where production data lives, and a broken comparator that
// reports "off-project copy present" is indistinguishable from one.
//
// The GREEN case matters most here and is the one production cannot produce:
// no off-project copy exists today, so a check that could only ever be run
// against reality would never once execute its own success branch. Half of
// what follows is that branch.
//
//   node --test tools/scripts/lib/backup-copies.test.mjs
//   npm run test:backup-copies

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  ACKNOWLEDGED,
  MAX_EXPORT_AGE_DAYS,
  PRODUCTION_DATA_STORES,
  assessBackupCopies,
  resolveStoreName,
} from './backup-copies.mjs'

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

const PROJECT_ID = 'aglyn-main'
const PROD_NUMBER = '543499566626'
const OTHER_NUMBER = '812221002309'
const NOW = Date.parse('2026-08-19T12:00:00Z')

/** The six buckets PRODUCTION_DATA_STORES declares, as the API returns them. */
const liveBuckets = () =>
  PRODUCTION_DATA_STORES.map((store) => ({
    name: resolveStoreName(store.bucket, {
      projectId: PROJECT_ID,
      projectNumber: PROD_NUMBER,
    }),
    projectNumber: PROD_NUMBER,
    location: 'US',
  }))

/**
 * One source store measured against its prefix in the mirror, healthy by
 * default (AGL-2422).
 */
const mirroredStore = (name, prefix, overrides = {}) => ({
  name,
  prefix,
  sourceObjects: 451,
  sourceNewest: '2026-08-19T10:00:00.000Z',
  sourceTruncated: false,
  mirrorObjects: 451,
  mirrorNewest: '2026-08-19T11:00:00.000Z',
  mirrorTruncated: false,
  ...overrides,
})

/**
 * A complete off-project object mirror covering EVERY store that declares a
 * mirrorPrefix — derived from the declaration rather than hard-coded, so a
 * third primary store arriving in PRODUCTION_DATA_STORES is covered here with
 * no edit, exactly as it is in the checker.
 */
const healthyMirror = (overrides = {}) => ({
  bucket: 'aglyn-dr-storage-mirror',
  projectNumber: OTHER_NUMBER,
  location: 'US',
  versioningEnabled: true,
  stores: PRODUCTION_DATA_STORES.filter((store) => store.mirrorPrefix).map(
    (store) =>
      mirroredStore(
        resolveStoreName(store.bucket, {
          projectId: PROJECT_ID,
          projectNumber: PROD_NUMBER,
        }),
        store.mirrorPrefix,
      ),
  ),
  ...overrides,
})

/**
 * The storage half is HEALTHY by default here so that each Firestore-half test
 * below keeps isolating the one condition it names. The tests that care about
 * the storage half pass `storageMirror: null` or a damaged mirror explicitly —
 * which is also the honest reading of what those Firestore tests assert: "with
 * the object mirror in order, this is what the export state alone produces".
 */
const assess = (overrides = {}) =>
  assessBackupCopies({
    projectId: PROJECT_ID,
    productionProjectNumber: PROD_NUMBER,
    liveBuckets: liveBuckets(),
    storageMirror: healthyMirror(),
    now: NOW,
    ...overrides,
  })

/** A fresh, genuinely off-project Firestore export copy. */
const offProjectCopy = (overrides = {}) => ({
  role: 'offsite-mirror',
  bucket: 'aglyn-dr-firestore-exports',
  projectNumber: OTHER_NUMBER,
  location: 'US',
  completedExports: 4,
  newestCompletedAt: '2026-08-17T05:00:00Z',
  ...overrides,
})

const codes = (list) => list.map((finding) => finding.code).sort()

test('the in-project export alone is the AGL-1882 condition', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'firestore-export',
        bucket: 'aglyn-main-firestore-exports',
        projectNumber: PROD_NUMBER,
        location: 'US',
        completedExports: 1,
        newestCompletedAt: '2026-08-17T23:43:04Z',
      },
    ],
  })
  assert.equal(verdict.ok, false)
  assert.deepEqual(codes(verdict.failing), ['no-off-project-copy'])
  assert.equal(verdict.inventory.offProject.length, 0)
  assert.equal(verdict.inventory.inProject.length, 1)
})

test('GREEN: one fresh copy in another project satisfies the invariant', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'firestore-export',
        bucket: 'aglyn-main-firestore-exports',
        projectNumber: PROD_NUMBER,
        location: 'US',
        completedExports: 13,
        newestCompletedAt: '2026-08-17T05:00:00Z',
      },
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-dr-firestore-exports',
        projectNumber: OTHER_NUMBER,
        location: 'US',
        completedExports: 4,
        newestCompletedAt: '2026-08-17T05:00:00Z',
      },
    ],
  })
  assert.deepEqual(verdict.findings, [])
  assert.equal(verdict.ok, true)
  assert.equal(verdict.inventory.offProject.length, 1)
})

test('the off-project test is projectNumber, not the bucket name', () => {
  // A bucket named exactly like an off-site mirror, sitting in production.
  // A name-pattern check would call this green; only projectNumber does not.
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-offsite-dr-backups',
        projectNumber: PROD_NUMBER,
        location: 'US',
        completedExports: 9,
        newestCompletedAt: '2026-08-18T05:00:00Z',
      },
    ],
  })
  assert.deepEqual(codes(verdict.failing), ['no-off-project-copy'])
})

test('an off-project bucket with no completed export restores nothing', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-dr-firestore-exports',
        projectNumber: OTHER_NUMBER,
        location: 'US',
        completedExports: 0,
        newestCompletedAt: null,
      },
    ],
  })
  // Off-project, so `no-off-project-copy` is correctly absent — and it is
  // still red, because an empty bucket is not a restore point.
  assert.deepEqual(codes(verdict.failing), ['off-project-copy-empty'])
})

test('an off-project copy that stopped being written goes stale', () => {
  const stale = (days) =>
    assess({
      strict: true,
      copies: [
        {
          role: 'offsite-mirror',
          bucket: 'aglyn-dr-firestore-exports',
          projectNumber: OTHER_NUMBER,
          location: 'US',
          completedExports: 3,
          newestCompletedAt: new Date(NOW - days * 86_400_000).toISOString(),
        },
      ],
    })
  // Exactly at the budget is still fine; a tick past it is not.
  assert.deepEqual(stale(MAX_EXPORT_AGE_DAYS).findings, [])
  assert.deepEqual(codes(stale(MAX_EXPORT_AGE_DAYS + 0.5).failing), [
    'off-project-copy-stale',
  ])
  assert.deepEqual(codes(stale(40).failing), ['off-project-copy-stale'])
})

test('an unreadable timestamp is stale, never clean', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-dr-firestore-exports',
        projectNumber: OTHER_NUMBER,
        location: 'US',
        completedExports: 2,
        newestCompletedAt: 'not-a-timestamp',
      },
    ],
  })
  assert.deepEqual(codes(verdict.failing), ['off-project-copy-stale'])
})

test('a bucket appearing in production that nobody classified goes red', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-dr-firestore-exports',
        projectNumber: OTHER_NUMBER,
        location: 'US',
        completedExports: 5,
        newestCompletedAt: '2026-08-18T05:00:00Z',
      },
    ],
    liveBuckets: [
      ...liveBuckets(),
      { name: 'aglyn-main-analytics-dumps', projectNumber: PROD_NUMBER },
    ],
  })
  assert.deepEqual(codes(verdict.failing), ['undeclared-data-store'])
  assert.deepEqual(verdict.inventory.undeclared, ['aglyn-main-analytics-dumps'])
})

test('a declared store that no longer exists goes red the other way', () => {
  const verdict = assess({
    strict: true,
    copies: [
      {
        role: 'offsite-mirror',
        bucket: 'aglyn-dr-firestore-exports',
        projectNumber: OTHER_NUMBER,
        location: 'US',
        completedExports: 5,
        newestCompletedAt: '2026-08-18T05:00:00Z',
      },
    ],
    liveBuckets: liveBuckets().slice(1),
  })
  assert.deepEqual(codes(verdict.failing), ['declared-store-missing'])
  assert.equal(verdict.inventory.missing.length, 1)
})

test('an unexpired acknowledgement reports the gap but does not fail', () => {
  const copies = [
    {
      role: 'firestore-export',
      bucket: 'aglyn-main-firestore-exports',
      projectNumber: PROD_NUMBER,
      location: 'US',
      completedExports: 1,
      newestCompletedAt: '2026-08-17T23:43:04Z',
    },
  ]
  const lenient = assess({ copies, now: Date.parse('2026-08-19T12:00:00Z') })
  assert.equal(lenient.ok, true)
  // Reported in full — acknowledged is NOT the same as absent.
  assert.deepEqual(codes(lenient.findings), ['no-off-project-copy'])
  assert.deepEqual(codes(lenient.acknowledged), ['no-off-project-copy'])

  // --strict is the acceptance test: it ignores the acknowledgement.
  assert.equal(assess({ copies, strict: true }).ok, false)
})

test('the acknowledgement expires without anyone editing this file', () => {
  const copies = [
    {
      role: 'firestore-export',
      bucket: 'aglyn-main-firestore-exports',
      projectNumber: PROD_NUMBER,
      location: 'US',
      completedExports: 1,
      newestCompletedAt: '2026-08-17T23:43:04Z',
    },
  ]
  const afterExpiry = assess({
    copies,
    now: Date.parse('2026-09-01T00:00:01Z'),
  })
  assert.equal(afterExpiry.ok, false)
  assert.deepEqual(codes(afterExpiry.failing), ['no-off-project-copy'])
  assert.deepEqual(afterExpiry.acknowledged, [])
})

test('only findings the codebase actually emits may be acknowledged', () => {
  // An acknowledgement for a code no branch produces is a typo that silently
  // acknowledges nothing — the shape of every guard that "passed" for months.
  const source = readFileSync(
    join(REPO_ROOT, 'tools', 'scripts', 'lib', 'backup-copies.mjs'),
    'utf8',
  )
  for (const entry of ACKNOWLEDGED) {
    assert.ok(
      source.includes(`code: '${entry.code}',\n      title:`),
      `ACKNOWLEDGED names '${entry.code}', which no finding in backup-copies.mjs emits.`,
    )
    assert.ok(
      /^AGL-\d+$/.test(entry.issue),
      `ACKNOWLEDGED entry for '${entry.code}' must cite a Linear issue.`,
    )
    assert.ok(
      Number.isFinite(Date.parse(entry.expires)),
      `ACKNOWLEDGED entry for '${entry.code}' must carry a parseable expiry.`,
    )
  }
})

test('the age budget agrees with the public health endpoint', () => {
  // Two constants, one policy. The endpoint's budget moving alone would leave
  // this checker calling a copy fresh that the health probe already pages on.
  const healthReport = readFileSync(
    join(
      REPO_ROOT,
      'libs',
      'aglyn',
      'src',
      'lib',
      'app-utils',
      'health-report.ts',
    ),
    'utf8',
  )
  const match = healthReport.match(/export const MAX_EXPORT_AGE_DAYS = (\d+)/)
  assert.ok(
    match,
    'MAX_EXPORT_AGE_DAYS moved out of health-report.ts — re-point this assertion rather than deleting it.',
  )
  assert.equal(
    Number(match[1]),
    MAX_EXPORT_AGE_DAYS,
    'health-report.ts and backup-copies.mjs disagree about how old an export may be.',
  )
})

test('every declared store says what copies it, in the vocabulary', () => {
  const allowed = new Set([
    'firestore-export',
    'is-the-copy',
    'none',
    'nothing-to-copy',
    'storage-mirror',
  ])
  for (const store of PRODUCTION_DATA_STORES) {
    assert.ok(
      allowed.has(store.copiedBy),
      `${store.bucket} declares copiedBy='${store.copiedBy}', which is not one of ${[...allowed].join('|')}`,
    )
    assert.ok(
      store.holds.length > 0 && store.why.length > 0,
      `${store.bucket} must say what it holds and why that copy status is acceptable`,
    )
  }
})

// ── The Cloud Storage half (AGL-2422) ───────────────────────────────────────
//
// Same reason the Firestore half is tested this way: the GREEN branch is the
// one production cannot produce today — no mirror exists — so a check that
// only ever ran against reality would never once execute its own success path.
//
// The mirror's own lifecycle document is asserted here too rather than
// reviewed. A rule on that bucket which can match a LIVE object is the
// data-loss event the bucket exists to prevent, arriving on a schedule, in the
// one place the last copy lives.

test('no mirror configured is the AGL-2422 condition', () => {
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: null,
  })
  assert.deepEqual(codes(verdict.failing), ['no-storage-mirror'])
  const finding = verdict.failing[0]
  // Counted from the declaration, so a third primary store added to
  // PRODUCTION_DATA_STORES is covered with no edit to this file.
  assert.match(finding.title, /2 store\(s\) of primary data are copied by nothing/)
})

test('GREEN: a complete off-project mirror satisfies the storage half', () => {
  const verdict = assess({ strict: true, copies: [offProjectCopy()] })
  assert.deepEqual(verdict.findings, [])
  assert.equal(verdict.ok, true)
})

test('a mirror inside the production project is not an off-project copy', () => {
  // The bucket is NAMED `aglyn-dr-storage-mirror`. Only projectNumber catches
  // this; a name-pattern check calls it green.
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ projectNumber: PROD_NUMBER }),
  })
  assert.deepEqual(codes(verdict.failing), [
    'storage-mirror-in-production-project',
  ])
})

test('an unversioned mirror has no undo for a propagated delete', () => {
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ versioningEnabled: false }),
  })
  assert.deepEqual(codes(verdict.failing), ['storage-mirror-unversioned'])
})

test('a mirror missing objects is incomplete, and says by how many', () => {
  const stores = healthyMirror().stores
  stores[0] = { ...stores[0], mirrorObjects: 300 }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  const finding = verdict.failing.find(
    (f) => f.code === 'storage-mirror-incomplete',
  )
  assert.ok(finding)
  assert.match(finding.detail, /451 object\(s\)/)
  assert.match(finding.detail, /holds 300/)
})

test('a mirror holding MORE than its source is not a finding', () => {
  // The source lifecycle expires `adminAudit-archive/` at 365 days. Still
  // holding the copy of an expired object is the POINT of a copy; only the
  // deficit is a problem.
  const stores = healthyMirror().stores
  stores[0] = { ...stores[0], mirrorObjects: 600 }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  assert.deepEqual(codes(verdict.failing), [])
})

test('a sync that ran and then stopped goes stale on the lag budget', () => {
  const stores = healthyMirror().stores
  // Counts match — every object it copied is still there. What moved is the
  // source, nine days ahead of the newest thing ever copied.
  stores[0] = { ...stores[0], mirrorNewest: '2026-08-10T10:00:00.000Z' }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  const finding = verdict.failing.find((f) => f.code === 'storage-mirror-stale')
  assert.ok(finding)
  assert.match(finding.detail, /9 days/)
})

test('a mirror lagging within the budget is not stale', () => {
  const stores = healthyMirror().stores
  stores[0] = { ...stores[0], mirrorNewest: '2026-08-18T10:00:00.000Z' }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  assert.deepEqual(codes(verdict.failing), [])
})

test('an EMPTY mirror prefix beside a non-empty source is caught', () => {
  const stores = healthyMirror().stores
  stores[0] = { ...stores[0], mirrorObjects: 0, mirrorNewest: null }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  // Incomplete, not stale: the more actionable of the two, and the missing
  // timestamp must not silence it.
  assert.deepEqual(codes(verdict.failing), ['storage-mirror-incomplete'])
})

test('an empty SOURCE with an empty mirror is clean, not stale', () => {
  // `…-plugin-artifacts` was empty for its first weeks. Nothing to copy is not
  // a copy failure, and a null timestamp on both sides must not read as one.
  const stores = healthyMirror().stores
  stores[0] = {
    ...stores[0],
    sourceObjects: 0,
    sourceNewest: null,
    mirrorObjects: 0,
    mirrorNewest: null,
  }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  assert.deepEqual(codes(verdict.failing), [])
})

test('a truncated listing is never green and never a count', () => {
  const stores = healthyMirror().stores
  stores[0] = { ...stores[0], sourceTruncated: true, mirrorObjects: 0 }
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  assert.deepEqual(codes(verdict.failing), [
    'storage-mirror-comparison-truncated',
  ])
  // It does not ALSO report the deficit it cannot prove: the truncated branch
  // returns before the comparison, so nothing is asserted about unread data.
  assert.ok(!codes(verdict.findings).includes('storage-mirror-incomplete'))
})

test('a store needing a copy that nothing measured cannot render green', () => {
  // The quietest failure available here: drop one store from the measurement
  // and every store that IS measured is complete, so the run would pass while
  // the omitted store is copied by nothing. The declaration is the authority.
  const stores = healthyMirror().stores.slice(1)
  const verdict = assess({
    strict: true,
    copies: [offProjectCopy()],
    storageMirror: healthyMirror({ stores }),
  })
  const finding = verdict.failing.find(
    (f) => f.code === 'storage-mirror-store-unmeasured',
  )
  assert.ok(finding)
  assert.match(finding.detail, /aglyn-main\.appspot\.com/)
})

test('every store that declares a mirror prefix declares a distinct one', () => {
  const prefixes = PRODUCTION_DATA_STORES.filter((s) => s.mirrorPrefix).map(
    (s) => s.mirrorPrefix,
  )
  assert.ok(prefixes.length > 0, 'no store is marked as needing a copy at all')
  assert.equal(
    new Set(prefixes).size,
    prefixes.length,
    'two stores share a mirror prefix and would overwrite each other in the mirror',
  )
  for (const prefix of prefixes) {
    assert.ok(
      prefix.endsWith('/') && !prefix.startsWith('/'),
      `mirror prefix '${prefix}' must be a relative directory prefix ending in '/'`,
    )
  }
})

test('the mirror lifecycle NEVER carries a rule that can match a live object', () => {
  // The one rule that would make the mirror bucket worse than no bucket. GCS
  // ANDs lifecycle conditions and defaults `isLive` to "either", so a rule
  // that merely omits it deletes live objects too — mirrors of objects that
  // still exist in production, on a schedule.
  const policy = JSON.parse(
    readFileSync(
      join(REPO_ROOT, 'cloud', 'storage-mirror-lifecycle.json'),
      'utf8',
    ),
  )
  const rules = policy.lifecycle?.rule ?? []
  assert.ok(rules.length > 0, 'the mirror lifecycle document carries no rules')
  for (const rule of rules) {
    const shown = JSON.stringify(rule)
    assert.equal(
      rule.condition?.isLive,
      false,
      `mirror lifecycle rule ${shown} can match a LIVE object`,
    )
    assert.equal(
      rule.action?.type,
      'Delete',
      `mirror lifecycle rule ${shown} is not an expiry; a storage-class transition needs its own review`,
    )
    // Age since UPLOAD would expire the mirror of a two-year-old file that is
    // still live in production. Only age since the version went noncurrent is
    // safe on this bucket.
    assert.equal(
      rule.condition?.age,
      undefined,
      `mirror lifecycle rule ${shown} ages from upload, not from becoming noncurrent`,
    )
    assert.ok(
      Number.isInteger(rule.condition?.daysSinceNoncurrentTime),
      `mirror lifecycle rule ${shown} must bound noncurrent versions by daysSinceNoncurrentTime`,
    )
    // Conditions are ANDed, and a DELETED object leaves one noncurrent version
    // with ZERO newer ones — so `numNewerVersions` beside the age bound never
    // matches a deletion. The rule would expire overwrite history on schedule
    // while retaining every erased customer's media forever, and would read as
    // the stricter of the two policies to anyone reviewing it.
    assert.equal(
      rule.condition?.numNewerVersions,
      undefined,
      `mirror lifecycle rule ${shown} ANDs numNewerVersions with the age bound, which exempts deletions from it`,
    )
  }
})
