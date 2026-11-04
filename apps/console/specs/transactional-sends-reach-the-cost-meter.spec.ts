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

/**
 * EVERY TRANSACTIONAL SEND REACHES THE ORG'S COST METER (AGL-4145).
 *
 * The 2026-11-03 margin check asked whether the usage rollup's email figure
 * — the one `orgMonthlyCogsUsd` prices at `perEmailSend` and the staff margin
 * readouts read — counts transactional mail, or only the campaign mail a
 * plan's band governs. It counts both, and this proves it through the real
 * functions in the order they run:
 *
 *   `recordEmailSends` (what every sender calls after a delivery)
 *     → `orgCounterTotals` (what the monthly rollup sums)
 *     → `orgCogsInputFrom` + `orgMonthlyCogsUsd` (what the readouts price).
 *
 * A receipt on a site, an invite on the org and a campaign all land in the
 * one priced figure. Aglyn's own account mail does not, by design: it belongs
 * to no customer. The sweep that every `sendEmail` call site meters at all is
 * `email-send-metering-coverage.spec.ts`; this is what the meter adds up to.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const admin = {
    app: () => ({
      firestore: () => {
        throw new Error('no default app in tests — inject a firestore')
      },
    }),
    firestore: { FieldValue: { increment: (value: number) => ({ increment: value }) } },
  }
  return { __esModule: true, default: admin, firebaseAdmin: admin }
})

import {
  CAMPAIGN_EMAIL_SENDS_COUNTER,
  EMAIL_SENDS_COUNTER,
  recordEmailSends,
} from '@aglyn/tenant-data-admin/server/email-metering'
import {
  ORG_COGS_UNIT_RATES_USD,
  orgCogsInputFrom,
  orgMonthlyCogsUsd,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { orgCounterTotals } from '../utils/org-counter-totals'

const MONTH = '2026-11'

/** A path-keyed store answering the two shapes on this path: refs and `getAll`. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, any>>()
  const docRef = (path: string): any => ({
    path,
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const next = { ...(options?.merge ? (docs.get(path) ?? {}) : {}) }
      for (const [field, raw] of Object.entries(value)) {
        next[field] =
          raw && typeof raw === 'object' && 'increment' in raw
            ? Number(next[field] ?? 0) + Number(raw.increment)
            : raw
      }
      docs.set(path, next)
    },
    get: async () => ({ get: (field: string) => docs.get(path)?.[field] }),
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
  })
  return {
    docs,
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
    getAll: async (...refs: any[]) =>
      refs.map((ref) => ({ get: (field: string) => docs.get(ref.path)?.[field] })),
    ref: docRef,
  }
}

describe('transactional sends are priced on the org cost meter (AGL-4145)', () => {
  it('sums a site’s receipts, the org’s own mail and its campaigns into the priced figure', async () => {
    const firestore = fakeFirestore()
    const record = (scope: any, count: number, sendClass: 'campaign' | 'transactional') =>
      recordEmailSends({ scope, count, sendClass, month: MONTH, firestore })

    // A store's month: receipts and booking mail on two sites, invites and a
    // welcome on the org, and one campaign.
    await record({ kind: 'host', hostId: 'site-a' }, 1_200, 'transactional')
    await record({ kind: 'host', hostId: 'site-b' }, 300, 'transactional')
    await record({ kind: 'org', orgId: 'org-1' }, 25, 'transactional')
    await record({ kind: 'host', hostId: 'site-a' }, 500, 'campaign')
    // Aglyn's own password resets: real cost, nobody's rollup.
    await record({ kind: 'platform' }, 40, 'transactional')

    // The campaign meter holds the campaign alone — that is the figure a
    // band governs, and it is NOT the one priced.
    expect(
      firestore.docs.get(`hosts/site-a/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`)?.[MONTH],
    ).toBe(500)

    const totals = await orgCounterTotals(
      firestore as never,
      [firestore.ref('hosts/site-a'), firestore.ref('hosts/site-b')],
      MONTH,
      firestore.ref('orgs/org-1'),
    )
    // Every delivered message of the org's, transactional included.
    expect(totals.emailSends).toBe(1_200 + 300 + 25 + 500)

    // The rollup write carries that figure as `emailSends` …
    const rollup = { month: MONTH, emailSends: totals.emailSends }
    const cogs = orgMonthlyCogsUsd(orgCogsInputFrom(rollup), 0)
    // … and the cost model prices every message of it, not the overage.
    expect(cogs.breakdown['emailSends']).toBeCloseTo(
      2_025 * ORG_COGS_UNIT_RATES_USD.perEmailSend,
      10,
    )
    expect(cogs.measuredUsd).toBeCloseTo(cogs.breakdown['emailSends']!, 10)

    // The transactional share is most of it: priced, not dropped.
    const campaignOnly = orgMonthlyCogsUsd(orgCogsInputFrom({ emailSends: 500 }), 0)
    expect(cogs.breakdown['emailSends']! - campaignOnly.breakdown['emailSends']!).toBeCloseTo(
      1_525 * ORG_COGS_UNIT_RATES_USD.perEmailSend,
      10,
    )
  })

  it('keeps the platform’s own mail out of every org’s figure', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'platform' },
      count: 40,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    const totals = await orgCounterTotals(
      firestore as never,
      [firestore.ref('hosts/site-a')],
      MONTH,
      firestore.ref('orgs/org-1'),
    )
    expect(totals.emailSends).toBe(0)
    expect(firestore.docs.get(`meters/platform/counters/${EMAIL_SENDS_COUNTER}`)?.[MONTH]).toBe(40)
  })

  it('is what the monthly rollup writes: the cost counter, with the org’s own mail', () => {
    // A source pin on the one write between the two halves above. The route
    // is too wide to run here, and the defect this guards — summing the
    // campaign counter, or hosts alone — would not fail any test of either
    // half.
    const route = readFileSync(
      join(__dirname, '..', 'app', 'api', 'billing', 'report-usage', 'route.ts'),
      'utf8',
    )
    expect(route).toMatch(/emailSends:\s*counterTotals\.emailSends/)
    expect(route).toMatch(/orgCounterTotals\(\s*firestore,\s*hostRefs,\s*month,\s*orgRef,/)
    expect(route).not.toMatch(/emailSends:\s*counterTotals\.campaign/)
  })
})
