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

const assess = (overrides = {}) =>
  assessBackupCopies({
    projectId: PROJECT_ID,
    productionProjectNumber: PROD_NUMBER,
    liveBuckets: liveBuckets(),
    now: NOW,
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
