/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * HOW MUCH ROOM IS LEFT AT THE SENDING-DOMAIN CEILING.
 *
 * The ceiling used to be observable only as a boolean, and only at the moment
 * it bound: `atCapacity` went true, and from then on a merchant who asked for
 * a dedicated domain silently kept the pooled one instead. Buying the
 * provider's domain add-on is a billing change plus a configuration deploy, so
 * a limit first seen at the limit cannot be met without a gap.
 *
 * What this file protects is the reading an operator watches BEFORE that — the
 * fraction, the absolute headroom, and the warning band between "fine" and
 * "too late". The three are asserted together because each covers a different
 * failure of the other two: a fraction alone is unreadable at small
 * allowances, a count alone is unreadable at large ones, and a band with no
 * numbers beside it is a claim nobody can check.
 */

let mockCount = 0

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collectionGroup: () => ({
          where: () => ({
            count: () => ({
              get: async () => ({ data: () => ({ count: mockCount }) }),
            }),
          }),
        }),
      }),
    }),
  },
  // Untouched by anything here, but the module imports them at load.
  listPendingSendingDomains: async () => [],
  readSendingDomainRecord: () => null,
  recordSendingDomainIssueFailure: async () => undefined,
  SENDING_DOMAINS_COLLECTION: 'sendingDomains',
  sendingDomainLabel: () => '',
}))

import { readSendingDomainCapacity } from '../utils/server/provision-sending-domain'

const CAPACITY = 'AGLYN_SENDING_DOMAIN_CAPACITY'

let previous: string | undefined
beforeAll(() => {
  previous = process.env[CAPACITY]
})
afterAll(() => {
  if (previous === undefined) delete process.env[CAPACITY]
  else process.env[CAPACITY] = previous
})

beforeEach(() => {
  mockCount = 0
  delete process.env[CAPACITY]
})

describe('the ceiling reads as a fraction, not as a boolean', () => {
  it('reports the share spent and the slots left, well below the limit', async () => {
    process.env[CAPACITY] = '100'
    mockCount = 40

    const report = await readSendingDomainCapacity()

    expect(report.held).toBe(40)
    expect(report.capacity).toBe(100)
    expect(report.used).toBeCloseTo(0.4)
    expect(report.remaining).toBe(60)
    expect(report.atCapacity).toBe(false)
    expect(report.low).toBe(false)
  })

  /**
   * The band, and both of its edges.
   *
   * Asserted as a transition rather than at one point, because a threshold
   * test at a single value passes against a predicate that is simply always
   * true on one side — and a warning that fires from the first domain onward
   * is a warning an operator learns to ignore before it ever means anything.
   */
  it('starts warning only once the band is entered', async () => {
    process.env[CAPACITY] = '100'

    mockCount = 79
    expect((await readSendingDomainCapacity()).low).toBe(false)

    mockCount = 80
    const entered = await readSendingDomainCapacity()
    expect(entered.low).toBe(true)
    // And the numbers a person acts on come with it: 20 left is the size of
    // the decision, where "80%" alone is not.
    expect(entered.remaining).toBe(20)
  })

  /**
   * `low` and `atCapacity` are different events with different remedies —
   * "buy headroom soon" against "merchants are being pooled right now" — so
   * the milder one must stop being true at the moment it stops being useful.
   */
  it('stops calling it low once it is actually at the ceiling', async () => {
    process.env[CAPACITY] = '10'
    mockCount = 10

    const report = await readSendingDomainCapacity()

    expect(report.atCapacity).toBe(true)
    expect(report.low).toBe(false)
    expect(report.remaining).toBe(0)
    expect(report.used).toBe(1)
  })

  /**
   * An account carrying domains an operator added by hand can sit PAST the
   * configured ceiling. A share above 1 reads as a broken meter rather than as
   * a real state, and a negative headroom reads as an arithmetic bug.
   */
  it('clamps a ceiling that has been overshot', async () => {
    process.env[CAPACITY] = '10'
    mockCount = 14

    const report = await readSendingDomainCapacity()

    expect(report.used).toBe(1)
    expect(report.remaining).toBe(0)
    expect(report.atCapacity).toBe(true)
  })

  /**
   * `-1` switches the check off for a provider with no such limit. There is
   * then no ceiling to be a fraction OF, and `0` in that position would read
   * as an empty account rather than as an absent limit.
   */
  it('reports no fraction at all when the ceiling is disabled', async () => {
    process.env[CAPACITY] = '-1'
    mockCount = 4000

    const report = await readSendingDomainCapacity()

    expect(report.capacity).toBe(-1)
    expect(report.used).toBeNull()
    expect(report.remaining).toBeNull()
    expect(report.atCapacity).toBe(false)
    expect(report.low).toBe(false)
  })

  /**
   * The default is the lowest paid provider tier's allowance, so a deployment
   * that has not been told its plan warns before the vendor refuses it. The
   * band has to be reachable at that size too — a share-based threshold that
   * only ever fires on large allowances would leave every self-host silent.
   */
  it('warns at the default allowance, where the numbers are small', async () => {
    mockCount = 8

    const report = await readSendingDomainCapacity()

    expect(report.capacity).toBe(10)
    expect(report.low).toBe(true)
    expect(report.remaining).toBe(2)
  })
})
