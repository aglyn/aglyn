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

import { FieldValue } from 'firebase-admin/firestore'
import {
  attributeOrderToEmail,
  reverseEmailAttributedRevenue,
} from './email-revenue-attribution'
import { recordEmailCampaignTouch } from './email-delivery-log'
import { emailSuppressionKey } from './email-suppression'

/*==========================================
 * A DOUBLE THAT APPLIES SENTINELS AT DEPTH.
 *
 * The rollup's whole shape is `byCurrency.{code}.grossCents:
 * FieldValue.increment(n)` — an increment INSIDE a nested map — and real
 * Firestore's merge-set applies it there. `email-delivery-log.spec.ts`'s fake
 * merges nested maps with a shallow spread, which would drop the sentinel
 * object into the store unapplied and leave every amount asserted here equal
 * to a sentinel rather than a number. So this file carries its own, and the
 * recursion is the reason it exists rather than a preference.
 *
 * It also models `create()`, which nothing else in this library needs and
 * which is load-bearing here: the ALREADY_EXISTS rejection IS the idempotency
 * that stops a redelivered purchase crediting a campaign twice. A double
 * whose `create` behaved like `set` would make the double-count test green
 * over a hole.
 *=========================================*/

function isIncrement(value: unknown): value is { operand: number } {
  return !!value && typeof value === 'object' && 'operand' in (value as any)
}

function isSentinel(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).isEqual === 'function'
  )
}

function applyWrite(
  target: Record<string, any>,
  update: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(update)) {
    if (isIncrement(value)) {
      next[key] = Number(next[key] ?? 0) + Number(value.operand)
      continue
    }
    if (isSentinel(value) && FieldValue.delete().isEqual(value as any)) {
      delete next[key]
      continue
    }
    if (isSentinel(value)) {
      next[key] = { serverTimestamp: true }
      continue
    }
    // Nested maps merge at depth, and the recursion is what applies a
    // sentinel that lives inside one.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const held =
        next[key] && typeof next[key] === 'object' && !Array.isArray(next[key])
          ? next[key]
          : {}
      next[key] = applyWrite(held, value)
      continue
    }
    next[key] = value
  }
  return next
}

function fakeFirestore() {
  const store = new Map<string, Record<string, any>>()

  const docRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => ({
      exists: store.has(path),
      id: path.split('/').pop(),
      ref: docRef(path),
      data: () => store.get(path),
      get: (field: string) => store.get(path)?.[field],
    }),
    set: async (update: Record<string, any>) => {
      store.set(path, applyWrite(store.get(path) ?? {}, update))
    },
    /** Real `create()` REJECTS when the document is already there. */
    create: async (update: Record<string, any>) => {
      if (store.has(path)) {
        const error: any = new Error('ALREADY_EXISTS')
        error.code = 6
        throw error
      }
      store.set(path, applyWrite({}, update))
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })

  const collectionRef = (prefix: string): any => ({
    doc: (id: string) => docRef(`${prefix}/${id}`),
  })

  return {
    collection: (name: string) => collectionRef(name),
    runTransaction: async (body: (transaction: any) => Promise<void>) =>
      body({
        get: async (ref: any) => ref.get(),
        set: async (ref: any, update: Record<string, any>) => ref.set(update),
      }),
    /** Spec helper: a campaign's revenue rollup. */
    revenue: (hostId: string, campaignId: string) =>
      store.get(`hosts/${hostId}/campaigns/${campaignId}/reports/revenue`),
    /** Spec helper: one order's attribution record. */
    attribution: (hostId: string, orderId: string) =>
      store.get(`hosts/${hostId}/emailAttributions/${orderId}`),
    /** Spec helper: the person document the touch lives on. */
    person: (email: string) =>
      store.get(`emailDeliveries/${emailSuppressionKey(email)}`),
    paths: () => [...store.keys()],
  }
}

const HOST = 'host1'
const BUYER = 'buyer@example.com'
const DAY = 24 * 60 * 60 * 1000
const CLICK_AT = 1_700_000_000_000

async function clicked(
  firestore: any,
  campaignId: string,
  atMs: number,
  email = BUYER,
) {
  return recordEmailCampaignTouch(
    { email, hostId: HOST, campaignId, atMs },
    firestore,
  )
}

/*==========================================
 * THE TOUCH, tested here rather than beside its own module.
 *
 * `recordEmailCampaignTouch` lives in `email-delivery-log.ts` because it
 * writes the person document that module owns, but it exists only for this
 * join and its eviction rule writes `FieldValue.delete()` INSIDE a nested
 * map. That spec's double merges nested maps with a shallow spread and would
 * store the sentinel unapplied; this file's applies it, which is the whole
 * reason these cases are here.
 *=========================================*/
describe('recordEmailCampaignTouch', () => {
  it('keeps one touch per site, and does not let sites overwrite each other', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await recordEmailCampaignTouch(
      { email: BUYER, hostId: 'host2', campaignId: 'winter', atMs: CLICK_AT + 1 },
      firestore,
    )

    expect(firestore.person(BUYER).campaignTouches).toEqual({
      host1: { campaignId: 'spring', atMs: CLICK_AT },
      host2: { campaignId: 'winter', atMs: CLICK_AT + 1 },
    })
  })

  it('only ever moves forward, so a replayed old click cannot displace a new one', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'summer', CLICK_AT + DAY)
    // Provider delivery is at-least-once and unordered: this is last month's
    // click arriving after this week's.
    const moved = await clicked(firestore, 'spring', CLICK_AT)

    expect(moved).toBe(false)
    expect(firestore.person(BUYER).campaignTouches.host1).toEqual({
      campaignId: 'summer',
      atMs: CLICK_AT + DAY,
    })
  })

  it('is idempotent for the same click delivered twice', async () => {
    const firestore = fakeFirestore()
    expect(await clicked(firestore, 'spring', CLICK_AT)).toBe(true)
    expect(await clicked(firestore, 'spring', CLICK_AT)).toBe(false)
  })

  it('evicts the oldest site once the map is full', async () => {
    const firestore = fakeFirestore()
    for (let index = 0; index < 10; index += 1) {
      await recordEmailCampaignTouch(
        {
          email: BUYER,
          hostId: `host${index}`,
          campaignId: 'spring',
          // host0 is the oldest, so it is the one that goes.
          atMs: CLICK_AT + index,
        },
        firestore,
      )
    }
    await recordEmailCampaignTouch(
      { email: BUYER, hostId: 'newcomer', campaignId: 'spring', atMs: CLICK_AT + 99 },
      firestore,
    )

    const held = firestore.person(BUYER).campaignTouches
    expect(Object.keys(held)).toHaveLength(10)
    expect(held.host0).toBeUndefined()
    expect(held.newcomer).toEqual({ campaignId: 'spring', atMs: CLICK_AT + 99 })
    expect(held.host9).toEqual({ campaignId: 'spring', atMs: CLICK_AT + 9 })
  })

  it('replaces an existing site without evicting anybody', async () => {
    const firestore = fakeFirestore()
    for (let index = 0; index < 10; index += 1) {
      await recordEmailCampaignTouch(
        { email: BUYER, hostId: `host${index}`, campaignId: 'spring', atMs: CLICK_AT + index },
        firestore,
      )
    }
    await recordEmailCampaignTouch(
      { email: BUYER, hostId: 'host0', campaignId: 'summer', atMs: CLICK_AT + 500 },
      firestore,
    )

    const held = firestore.person(BUYER).campaignTouches
    expect(Object.keys(held)).toHaveLength(10)
    expect(held.host0).toEqual({ campaignId: 'summer', atMs: CLICK_AT + 500 })
  })

  it('refuses a touch that names no campaign, no site or no instant', async () => {
    const firestore = fakeFirestore()
    expect(await clicked(firestore, '', CLICK_AT)).toBe(false)
    expect(
      await recordEmailCampaignTouch(
        { email: BUYER, hostId: '', campaignId: 'spring', atMs: CLICK_AT },
        firestore,
      ),
    ).toBe(false)
    expect(await clicked(firestore, 'spring', 0)).toBe(false)
    expect(firestore.person(BUYER)).toBeUndefined()
  })
})

describe('attributeOrderToEmail', () => {
  it('credits the campaign the buyer clicked, inside the window', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)

    const record = await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 12_500,
        orderedAtMs: CLICK_AT + 2 * DAY,
      },
      firestore,
    )

    expect(record).toMatchObject({
      campaignId: 'spring',
      amountCents: 12_500,
      currency: 'usd',
      model: 'last-click',
      windowDays: 7,
    })
    expect(firestore.revenue(HOST, 'spring')).toMatchObject({
      byCurrency: { usd: { grossCents: 12_500, orders: 1 } },
    })
  })

  it('credits the LAST campaign clicked, not the first', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await clicked(firestore, 'summer', CLICK_AT + DAY)

    await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 9_000,
        orderedAtMs: CLICK_AT + 2 * DAY,
      },
      firestore,
    )

    expect(firestore.revenue(HOST, 'summer')).toMatchObject({
      byCurrency: { usd: { grossCents: 9_000, orders: 1 } },
    })
    // The earlier campaign gets NOTHING — not a share, not a rollup document.
    expect(firestore.revenue(HOST, 'spring')).toBeUndefined()
  })

  it('does NOT credit a campaign clicked after the order was placed', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    const orderedAtMs = CLICK_AT + DAY
    // A campaign that landed between the sale and the webhook. Without the
    // forward bound it would take the credit for an order it followed.
    await clicked(firestore, 'summer', orderedAtMs + 60_000)

    const record = await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order1', email: BUYER, amountCents: 9_000, orderedAtMs },
      firestore,
    )

    expect(record).toBeNull()
    expect(firestore.revenue(HOST, 'summer')).toBeUndefined()
    expect(firestore.revenue(HOST, 'spring')).toBeUndefined()
  })

  it('does not credit a click older than the window', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)

    const record = await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 9_000,
        orderedAtMs: CLICK_AT + 8 * DAY,
      },
      firestore,
    )

    expect(record).toBeNull()
    expect(firestore.revenue(HOST, 'spring')).toBeUndefined()
  })

  it('does not credit another site’s campaign', async () => {
    const firestore = fakeFirestore()
    await recordEmailCampaignTouch(
      { email: BUYER, hostId: 'otherhost', campaignId: 'spring', atMs: CLICK_AT },
      firestore,
    )

    const record = await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 9_000,
        orderedAtMs: CLICK_AT + DAY,
      },
      firestore,
    )

    expect(record).toBeNull()
    expect(firestore.revenue(HOST, 'spring')).toBeUndefined()
  })

  /*==========================================
   * A GUEST CHECKOUT.
   *
   * Two different situations wear that name and they get different answers,
   * which is the whole point of documenting it rather than letting either
   * one silently drop.
   *=========================================*/
  it('credits a guest who gave an email and has no contact record', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)

    // Nothing anywhere creates a contact. The join keys on the address hash,
    // so a Free org whose band gate dropped the contact still gets its
    // revenue attributed.
    const record = await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 4_200,
        orderedAtMs: CLICK_AT + DAY,
      },
      firestore,
    )

    expect(record?.campaignId).toBe('spring')
    expect(
      firestore.paths().some((path: string) => path.includes('/contacts')),
    ).toBe(false)
  })

  it('credits nobody for a checkout that gave no email, and writes nothing', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    const before = firestore.paths().length

    for (const email of [null, undefined, '', 'not-an-address']) {
      const record = await attributeOrderToEmail(
        {
          hostId: HOST,
          orderId: 'order1',
          email,
          amountCents: 9_000,
          orderedAtMs: CLICK_AT + DAY,
        },
        firestore,
      )
      expect(record).toBeNull()
    }
    // A miss costs no write at all, which is what keeps the ordinary order —
    // placed by somebody not on the list — at one document read.
    expect(firestore.paths().length).toBe(before)
  })

  it('credits an order only ONCE, however many times the webhook delivers it', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    const order = {
      hostId: HOST,
      orderId: 'order1',
      email: BUYER,
      amountCents: 12_500,
      orderedAtMs: CLICK_AT + DAY,
    }

    const first = await attributeOrderToEmail(order, firestore)
    const second = await attributeOrderToEmail(order, firestore)
    const third = await attributeOrderToEmail(order, firestore)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(third).toBeNull()
    expect(firestore.revenue(HOST, 'spring')).toMatchObject({
      byCurrency: { usd: { grossCents: 12_500, orders: 1 } },
    })
  })

  it('adds a second order to the same campaign', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order1', email: BUYER, amountCents: 1_000, orderedAtMs: CLICK_AT + DAY },
      firestore,
    )
    await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order2', email: BUYER, amountCents: 2_500, orderedAtMs: CLICK_AT + DAY },
      firestore,
    )

    expect(firestore.revenue(HOST, 'spring')).toMatchObject({
      byCurrency: { usd: { grossCents: 3_500, orders: 2 } },
    })
  })

  it('keeps each currency in its own bucket', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order1', email: BUYER, amountCents: 1_000, currency: 'usd', orderedAtMs: CLICK_AT + DAY },
      firestore,
    )
    await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order2', email: BUYER, amountCents: 2_000, currency: 'EUR', orderedAtMs: CLICK_AT + DAY },
      firestore,
    )

    const stored = firestore.revenue(HOST, 'spring')
    // Two buckets, and no field anywhere holding 3_000.
    expect(stored.byCurrency.usd.grossCents).toBe(1_000)
    expect(stored.byCurrency.eur.grossCents).toBe(2_000)
    expect(Object.keys(stored.byCurrency).sort()).toEqual(['eur', 'usd'])
  })

  it('records an unrecognised currency code as the default rather than as a map key', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents: 1_000,
        // A dot in a map key would be unreachable by any dotted field path.
        currency: 'us.d',
        orderedAtMs: CLICK_AT + DAY,
      },
      firestore,
    )
    expect(Object.keys(firestore.revenue(HOST, 'spring').byCurrency)).toEqual([
      'usd',
    ])
  })

  it('credits nothing for an order that moved no money', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    const record = await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order1', email: BUYER, amountCents: 0, orderedAtMs: CLICK_AT + DAY },
      firestore,
    )
    expect(record).toBeNull()
    expect(firestore.revenue(HOST, 'spring')).toBeUndefined()
  })

  it('refuses a host or order id that is a path rather than an id', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    expect(
      await attributeOrderToEmail(
        { hostId: 'a/b', orderId: 'order1', email: BUYER, amountCents: 100, orderedAtMs: CLICK_AT + DAY },
        firestore,
      ),
    ).toBeNull()
    expect(
      await attributeOrderToEmail(
        { hostId: HOST, orderId: 'a/b/c', email: BUYER, amountCents: 100, orderedAtMs: CLICK_AT + DAY },
        firestore,
      ),
    ).toBeNull()
  })
})

describe('reverseEmailAttributedRevenue', () => {
  async function credited(firestore: any, amountCents = 12_500) {
    await clicked(firestore, 'spring', CLICK_AT)
    await attributeOrderToEmail(
      {
        hostId: HOST,
        orderId: 'order1',
        email: BUYER,
        amountCents,
        orderedAtMs: CLICK_AT + DAY,
      },
      firestore,
    )
  }

  it('takes back the revenue a refunded order contributed', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)

    const reversed = await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 12_500, closedTheOrder: true },
      firestore,
    )

    expect(reversed).toBe(true)
    const stored = firestore.revenue(HOST, 'spring')
    // Gross is UNCHANGED and the reversal sits beside it — the shape
    // `contact-refund.ts` chose, so `gross - refunded` is the net.
    expect(stored.byCurrency.usd).toMatchObject({
      grossCents: 12_500,
      refundedCents: 12_500,
      orders: 1,
      refundedOrders: 1,
    })
  })

  it('counts a partial refund without closing the order', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)

    await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 2_500, closedTheOrder: false },
      firestore,
    )

    const stored = firestore.revenue(HOST, 'spring')
    expect(stored.byCurrency.usd.refundedCents).toBe(2_500)
    expect(stored.byCurrency.usd.refundedOrders).toBeUndefined()
  })

  it('adds two partials on one order', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)
    await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 2_500, closedTheOrder: false },
      firestore,
    )
    await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 4_000, closedTheOrder: true },
      firestore,
    )

    const stored = firestore.revenue(HOST, 'spring')
    expect(stored.byCurrency.usd.refundedCents).toBe(6_500)
    expect(stored.byCurrency.usd.refundedOrders).toBe(1)
  })

  it('reverses into the currency bucket the SALE went into', async () => {
    const firestore = fakeFirestore()
    await clicked(firestore, 'spring', CLICK_AT)
    await attributeOrderToEmail(
      { hostId: HOST, orderId: 'order1', email: BUYER, amountCents: 5_000, currency: 'eur', orderedAtMs: CLICK_AT + DAY },
      firestore,
    )
    // The caller passes no currency: it is read back off the record, which is
    // what stops a euro refund landing in the dollar bucket.
    await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 5_000, closedTheOrder: true },
      firestore,
    )

    const stored = firestore.revenue(HOST, 'spring')
    expect(stored.byCurrency.eur.refundedCents).toBe(5_000)
    expect(stored.byCurrency.usd).toBeUndefined()
  })

  it('does nothing for an order that was never credited to a campaign', async () => {
    const firestore = fakeFirestore()
    const reversed = await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'unattributed', amountCents: 5_000, closedTheOrder: true },
      firestore,
    )
    expect(reversed).toBe(false)
    expect(firestore.paths()).toEqual([])
  })

  it('reverses a chargeback through the same door as a refund', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)
    await reverseEmailAttributedRevenue(
      {
        hostId: HOST,
        orderId: 'order1',
        amountCents: 12_500,
        closedTheOrder: true,
        kind: 'chargeback',
      },
      firestore,
    )

    expect(firestore.revenue(HOST, 'spring').byCurrency.usd.refundedCents).toBe(
      12_500,
    )
    expect(firestore.attribution(HOST, 'order1')).toMatchObject({
      chargedBack: true,
      fullyRefunded: true,
      refundedCents: 12_500,
    })
  })

  it('records the reversal on the order’s own record as well as in the sum', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)
    await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 3_000, closedTheOrder: false },
      firestore,
    )
    expect(firestore.attribution(HOST, 'order1')).toMatchObject({
      campaignId: 'spring',
      amountCents: 12_500,
      refundedCents: 3_000,
    })
  })

  it('reverses nothing for a refund of no money', async () => {
    const firestore = fakeFirestore()
    await credited(firestore)
    const reversed = await reverseEmailAttributedRevenue(
      { hostId: HOST, orderId: 'order1', amountCents: 0, closedTheOrder: false },
      firestore,
    )
    expect(reversed).toBe(false)
    expect(
      firestore.revenue(HOST, 'spring').byCurrency.usd.refundedCents,
    ).toBeUndefined()
  })
})
