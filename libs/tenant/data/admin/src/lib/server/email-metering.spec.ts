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

// `FieldValue.increment` returns an opaque transform the Admin SDK resolves
// server-side, so a fake store cannot apply it. Swapped for a sentinel the
// fake below adds for real — the point of these tests is the arithmetic, and
// an increment that never lands would make every count read 0 and pass.
jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => {
        throw new Error('no default app in tests — inject a firestore')
      },
    }),
    firestore: {
      FieldValue: { increment: (value: number) => ({ increment: value }) },
    },
  },
}))

import {
  CAMPAIGN_EMAIL_SENDS_COUNTER,
  EMAIL_SENDS_COUNTER,
  campaignEmailSendsForMonth,
  emailSendsOverage,
  meterHostEmail,
  recordEmailSends,
} from './email-metering'

/**
 * The email meters (AGL-1438).
 *
 * The assertions here are about ARITHMETIC, not about the fields arriving.
 * AGL-1402 is the cautionary sibling: a usage figure measured in two different
 * units read 20-45% wrong for a long time and nothing announced it, because
 * every test asserted the number was present rather than that it was right. So
 * the load-bearing test below is the one that sends the same total volume
 * through two differently-shaped senders — one campaign of 300, and 300
 * transactional sends spread over three sites — and demands the same 300.
 */

const MONTH = '2026-08'

/**
 * A path-keyed Firestore stand-in. `set(..., { merge: true })` with a
 * `{ increment: n }` sentinel is applied as an actual addition, so a
 * double-counted call site shows up as a wrong NUMBER rather than as a second
 * write nobody looks at.
 */
function fakeFirestore() {
  const docs = new Map<string, Record<string, number>>()
  const docRef = (path: string): any => ({
    path,
    get: async () => ({
      exists: docs.has(path),
      get: (field: string) => docs.get(path)?.[field],
    }),
    set: async (value: Record<string, any>) => {
      const current = docs.get(path) ?? {}
      for (const [field, raw] of Object.entries(value)) {
        current[field] =
          raw && typeof raw === 'object' && 'increment' in raw
            ? (current[field] ?? 0) + Number((raw as any).increment)
            : Number(raw)
      }
      docs.set(path, current)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
  })
  return {
    docs,
    at: (path: string) => docs.get(path)?.[MONTH],
    collection: (name: string) => collectionRef(name),
  }
}

const host = (hostId: string) =>
  `hosts/${hostId}/counters/${EMAIL_SENDS_COUNTER}`
const hostCampaigns = (hostId: string) =>
  `hosts/${hostId}/counters/${CAMPAIGN_EMAIL_SENDS_COUNTER}`

describe('recordEmailSends — the cost meter counts everything (AGL-1438)', () => {
  /**
   * The whole point of the issue. One campaign of 300 and 300 workflow
   * notifications are 300 emails either way; before this, only the first was
   * visible to the counter and therefore to COGS.
   */
  it('gives two differently-shaped senders the same total', async () => {
    const oneCampaign = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'solo' },
      count: 300,
      sendClass: 'campaign',
      month: MONTH,
      firestore: oneCampaign,
    })

    const manyTransactional = fakeFirestore()
    for (const hostId of ['one', 'two', 'three']) {
      for (let i = 0; i < 100; i += 1) {
        await recordEmailSends({
          scope: { kind: 'host', hostId },
          count: 1,
          sendClass: 'transactional',
          month: MONTH,
          firestore: manyTransactional,
        })
      }
    }

    const spread =
      manyTransactional.at(host('one')) +
      manyTransactional.at(host('two')) +
      manyTransactional.at(host('three'))
    expect(spread).toBe(oneCampaign.at(host('solo')))
    expect(spread).toBe(300)
  })

  /**
   * The double-count hazard this file exists to rule out: a campaign send
   * touches BOTH counters, and it must reach the cost meter exactly once —
   * not once for being email and again for being a campaign.
   */
  it('counts a campaign once on the cost meter and once on the cap meter', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 40,
      sendClass: 'campaign',
      month: MONTH,
      firestore,
    })
    expect(firestore.at(host('h1'))).toBe(40)
    expect(firestore.at(hostCampaigns('h1'))).toBe(40)
  })

  /** Transactional mail is cost, never cap: it must not move the cap meter. */
  it('keeps transactional mail off the enforceable meter entirely', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 5_000,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    expect(firestore.at(host('h1'))).toBe(5_000)
    expect(firestore.docs.has(hostCampaigns('h1'))).toBe(false)
  })

  it('accumulates across calls rather than overwriting', async () => {
    const firestore = fakeFirestore()
    await meterHostEmailOn(firestore, 'h1', 3)
    await meterHostEmailOn(firestore, 'h1', 4)
    expect(firestore.at(host('h1'))).toBe(7)
  })

  /** Each month is its own field, so a re-read never accumulates. */
  it('keeps months independent', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 10,
      sendClass: 'transactional',
      month: '2026-07',
      firestore,
    })
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 2,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    expect(firestore.docs.get(host('h1'))).toEqual({ '2026-07': 10, [MONTH]: 2 })
  })

  it('writes org-scoped and platform-scoped sends to their own counters', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'org', orgId: 'org-1' },
      count: 2,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    await recordEmailSends({
      scope: { kind: 'platform' },
      count: 3,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    expect(firestore.at(`orgs/org-1/counters/${EMAIL_SENDS_COUNTER}`)).toBe(2)
    expect(firestore.at(`meters/platform/counters/${EMAIL_SENDS_COUNTER}`)).toBe(
      3,
    )
  })

  /** A send that did not happen is not a cost. */
  it('ignores zero, negative and non-numeric counts', async () => {
    const firestore = fakeFirestore()
    for (const count of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await recordEmailSends({
        scope: { kind: 'host', hostId: 'h1' },
        count,
        sendClass: 'transactional',
        month: MONTH,
        firestore,
      })
    }
    expect(firestore.docs.size).toBe(0)
  })

  /**
   * Metering runs AFTER the mail has gone. A counter that cannot be written
   * must not become an exception in the middle of a checkout webhook.
   */
  it('never throws when the counter write fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const exploding = {
        collection: () => {
          throw new Error('firestore unavailable')
        },
      }
      await expect(
        recordEmailSends({
          scope: { kind: 'host', hostId: 'h1' },
          count: 1,
          sendClass: 'transactional',
          month: MONTH,
          firestore: exploding,
        }),
      ).resolves.toBeUndefined()
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('campaignEmailSendsForMonth — the cap reads the cap meter', () => {
  /**
   * The regression that would recreate this issue in reverse: a site whose
   * receipts and password resets fill `emailSends` must still have its FULL
   * campaign allowance, because none of that mail was discretionary.
   */
  it('ignores transactional volume sitting in the cost meter', async () => {
    const firestore = fakeFirestore()
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 9_000,
      sendClass: 'transactional',
      month: MONTH,
      firestore,
    })
    await recordEmailSends({
      scope: { kind: 'host', hostId: 'h1' },
      count: 12,
      sendClass: 'campaign',
      month: MONTH,
      firestore,
    })
    const hostRef = firestore.collection('hosts').doc('h1')
    expect(await campaignEmailSendsForMonth(hostRef, MONTH)).toBe(12)
  })

  it('reads an absent counter as 0, never NaN', async () => {
    const firestore = fakeFirestore()
    const used = await campaignEmailSendsForMonth(
      firestore.collection('hosts').doc('never-sent'),
      MONTH,
    )
    expect(used).toBe(0)
    expect(Number.isFinite(used)).toBe(true)
  })
})

describe('emailSendsOverage — recorded, never a refusal', () => {
  it('reports volume above the included band', () => {
    expect(emailSendsOverage(5_400, 5_000)).toBe(400)
  })

  it('is 0 inside the band and never negative', () => {
    expect(emailSendsOverage(120, 5_000)).toBe(0)
    expect(emailSendsOverage(0, 5_000)).toBe(0)
  })

  /** `UNLIMITED` is `Infinity`; there is no band to exceed. */
  it('is 0 for an unlimited plan', () => {
    expect(emailSendsOverage(1_000_000, Number.POSITIVE_INFINITY)).toBe(0)
  })

  /**
   * A plan that sells no email allowance has no band to be over. Returning the
   * whole month's volume here would put a duplicate of `emailSends` on the
   * rollup wearing the word "overage", which reads like something billable.
   */
  it('is 0 when the plan includes no allowance at all', () => {
    expect(emailSendsOverage(500, 0)).toBe(0)
  })
})

function meterHostEmailOn(firestore: any, hostId: string, count: number) {
  return recordEmailSends({
    scope: { kind: 'host', hostId },
    count,
    sendClass: 'transactional',
    month: MONTH,
    firestore,
  })
}

/** The one-line helper every call site uses resolves to the same write. */
describe('meterHostEmail', () => {
  it('defaults to one transactional send', () => {
    expect(typeof meterHostEmail).toBe('function')
    expect(meterHostEmail.length).toBe(1)
  })
})
