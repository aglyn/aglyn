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

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Every Firestore TTL policy, checked as a THREE-part configuration
 * (AGL-1972 / AGL-1978).
 *
 * A retention period is a promise, and this repo has already shipped one
 * with nothing behind it: the media-bucket lifecycle policy was written,
 * committed, and never applied (AGL-1496). A TTL policy can fail the same
 * way in three separate places, and each failure is silent:
 *
 *  1. **The writer stamps no field.** The policy is live and governs nothing,
 *     because it keys on a field the documents do not have.
 *  2. **The `fieldOverrides` declaration is missing.** This is the dangerous
 *     one and it is not intuitive: enabling TTL in gcloud creates a
 *     single-field index override in the project, and
 *     `firebase deploy --only firestore:indexes` DELETES any override not
 *     present in `cloud/firebase-firestore.indexes.json`. So a policy that
 *     lives only in gcloud is armed to be destroyed by the next unrelated
 *     index deploy — which is exactly what happened to
 *     `mediaTombstones.expiresAt` (applied AGL-1467, unfiled until AGL-1793).
 *     Worse, the index-drift checker's naive field filter cannot SEE a TTL
 *     field (it reports `usesAncestorConfig: true`), so it files a live
 *     policy as FILE-ONLY and advises running the deploy that destroys it.
 *  3. **`docs/FIRESTORE_MANUAL_CONFIG.md` does not mention it.** The gcloud
 *     command is the only record of how to re-apply a policy after it is
 *     lost, and the only place an operator can read the intended period.
 *
 * So this asserts the three halves are in agreement rather than asserting any
 * one of them. What it CANNOT prove is that the policy is live on
 * `aglyn-main` — nothing in a repo can. That read-back is the
 * `gcloud firestore fields ttls list` command in the manual-config doc, and
 * the schedule those policies implement is `docs/DATA_RETENTION.md`.
 *
 * It also does not assert the PERIODS. Those are unit-tested at the writer,
 * where the boundary can be checked in both directions — see the
 * "an exchange INSIDE its period is not expired" negative control in
 * `app/api/_lib/assist-usage.spec.ts`. A period asserted only here would be
 * a number restated next to itself.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

function repoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

interface FieldOverride {
  collectionGroup: string
  fieldPath: string
  ttl?: boolean
}

const indexes = JSON.parse(
  repoFile('cloud/firebase-firestore.indexes.json'),
) as { fieldOverrides: FieldOverride[] }

const manualConfig = repoFile('docs/FIRESTORE_MANUAL_CONFIG.md')

/** Collection groups declared with `ttl: true` in the index file. */
const declaredTtl = indexes.fieldOverrides.filter((entry) => entry.ttl === true)

/**
 * Every TTL policy that must exist, EVERY source file that writes into it,
 * and the exact expression that stamps the field.
 *
 * Two things here were wrong when this file was first written, and both were
 * found by running it rather than by reading it:
 *
 * - **`stamp` must be a literal WRITE expression**, not the bare word
 *   `expiresAt`. Every one of these files also names `expiresAt` in a doc
 *   comment or a helper name, so deleting the stamp from the write left the
 *   assertion green.
 * - **`writers` is a LIST**, because a collection group can have several.
 *   `analytics` has four — the tenant collect route, the media CDN server
 *   and the redirects resolver — and the first draft pointed at
 *   `analytics-retention.ts`, which exports the helper and writes nothing.
 *   It passed on the loose check and went red the moment the check got
 *   specific, which is the whole argument for specificity: a policy is only
 *   as good as its LEAST diligent writer, and naming one file per policy
 *   quietly assumes there is only one.
 */
const POLICIES: Array<{
  collectionGroup: string
  writers: string[]
  stamp: string
}> = [
  {
    collectionGroup: 'rateLimits',
    writers: ['libs/tenant/data/admin/src/lib/server/rate-limit-store.ts'],
    stamp: 'expiresAt: new Date(',
  },
  {
    collectionGroup: 'mediaTombstones',
    writers: ['libs/tenant/data/admin/src/lib/server/media-tombstone.ts'],
    stamp: 'expiresAt: Timestamp.fromMillis(',
  },
  {
    collectionGroup: 'cspViolationDaily',
    writers: ['libs/tenant/data/admin/src/lib/server/csp-aggregate.ts'],
    stamp: 'expiresAt: new Date(',
  },
  {
    collectionGroup: 'analytics',
    writers: [
      'apps/tenant/app/api/analytics/collect/route.ts',
      'libs/tenant/data/admin/src/lib/server/serve-media-cdn.ts',
      'libs/plugins/redirects/src/lib/server/resolve-redirect.ts',
    ],
    stamp: 'expiresAt: analyticsDayExpiresAt(day)',
  },
  {
    collectionGroup: 'screenAnalytics',
    writers: ['apps/tenant/app/api/analytics/collect/route.ts'],
    stamp: 'expiresAt: analyticsDayExpiresAt(day)',
  },
  // AGL-1972: the verbatim half of an Assist exchange.
  {
    collectionGroup: 'assistExchanges',
    writers: ['apps/console/app/api/_lib/assist-usage.ts'],
    stamp: 'expiresAt: assistExchangeExpiry(now)',
  },
  // AGL-1978: the churn survey's free text, split off the survey document so
  // it could expire without taking the reason breakdown with it.
  {
    collectionGroup: 'churnSurveyDetails',
    writers: ['apps/console/app/api/billing/retention/route.ts'],
    stamp: 'expiresAt: churnSurveyDetailExpiry()',
  },
  // AGL-1978: REST/POS/marketplace replay keys, which store the original
  // response body — for the REST API, a copy of the created record. TWO
  // writers: the shared claim and commerce's local copy.
  {
    collectionGroup: 'apiIdempotency',
    writers: [
      'libs/aglyn/src/lib/app-utils/api-idempotency.ts',
      'libs/plugins/commerce/src/lib/server/refund.ts',
    ],
    stamp: 'apiIdempotencyExpiry()',
  },
]

describe('Firestore TTL policies are declared, documented and written', () => {
  it.each(POLICIES)(
    '$collectionGroup: declared as a ttl fieldOverride on expiresAt',
    ({ collectionGroup }) => {
      const entry = declaredTtl.find(
        (override) => override.collectionGroup === collectionGroup,
      )
      // Reported as a pair so the failure names the collection rather than
      // just saying `undefined`.
      expect([collectionGroup, entry?.fieldPath]).toEqual([
        collectionGroup,
        'expiresAt',
      ])
    },
  )

  it.each(POLICIES)(
    '$collectionGroup: documented in FIRESTORE_MANUAL_CONFIG.md with its gcloud command',
    ({ collectionGroup }) => {
      // The table row — the intended period and the reason.
      expect([collectionGroup, manualConfig.includes(`\`${collectionGroup}\``)]).toEqual(
        [collectionGroup, true],
      )
      // …and the command to re-apply it, which is the only recovery path
      // after a deploy deletes the policy.
      expect([
        collectionGroup,
        manualConfig.includes(`--collection-group=${collectionGroup}`),
      ]).toEqual([collectionGroup, true])
    },
  )

  it.each(POLICIES)(
    '$collectionGroup: EVERY writer actually stamps the field',
    ({ collectionGroup, writers, stamp }) => {
      // A policy keying on a field nobody writes governs nothing, and looks
      // identical from the outside to one that works. A policy that ONE of
      // three writers forgets is worse: the collection visibly shrinks, so
      // the gap reads as working.
      const missing = writers.filter((path) => !repoFile(path).includes(stamp))
      expect([collectionGroup, missing]).toEqual([collectionGroup, []])
    },
  )

  it('declares NOTHING beyond the policies listed here', () => {
    // The other direction, and the one that catches a TTL added to a
    // collection without a decision being made about the period. A new
    // `ttl: true` entry must come with a row in POLICIES, which forces the
    // documentation and writer assertions above to be satisfied too.
    expect(declaredTtl.map((entry) => entry.collectionGroup).sort()).toEqual(
      POLICIES.map((policy) => policy.collectionGroup).sort(),
    )
  })

  it('the manual-config doc still warns that an index deploy can DELETE a policy', () => {
    // The hazard note is load-bearing, not commentary: it is the reason the
    // fieldOverrides entries above exist at all, and an operator who deploys
    // without reading it destroys every policy this file asserts.
    expect(manualConfig).toContain('fieldOverrides')
    expect(manualConfig).toMatch(/deletes anything in the project that isn't/i)
  })
})

describe('the retention change moved the promises that describe it', () => {
  it('refund.ts is still a second writer into apiIdempotency', () => {
    // The POLICIES table above asserts refund.ts carries the stamp; this
    // asserts it is still writing to the collection at all. Without it, a
    // refactor that moved refunds onto the shared `claimAttempt` would leave
    // a stale entry in the table that passes on a comment.
    const refund = repoFile('libs/plugins/commerce/src/lib/server/refund.ts')
    expect(refund).toContain("collection('apiIdempotency')")
  })

  it('the published API contract states the window rather than "never expires"', () => {
    // The AGL-1496 shape, inverted: there, a policy was written and never
    // applied. Here a policy is applied, and the risk is that the published
    // promise still says the opposite. `conventions.md` is a customer-facing
    // page and it used to say keys "never expire".
    const conventions = repoFile('apps/docs/api/conventions.md')
    expect(conventions).not.toMatch(/never expire/i)
    expect(conventions).toContain('30 days')
  })
})
