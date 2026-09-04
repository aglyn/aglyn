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

import type {
  PluginApiRequest,
  PluginApiResponse,
} from '@aglyn/aglyn/server'
import { createHmac } from 'crypto'
import { supplierUpdateHandler } from './supplier-update'

/**
 * One supplier ships one supplier's lines (AGL-2455).
 *
 * THE DEFECT. `supplier-update.ts` built its fulfillment as
 * `lineItemIds: order.lineItems.map((_, index) => index)` and wrote
 * `status: 'fulfilled'` as a literal, so on a two-supplier order the FIRST
 * supplier to post tracking marked the entire order shipped — lines they had
 * never seen included — and the second supplier's later POST met a 409, because
 * `fulfilled` cannot transition to `fulfilled`. The buyer was told their whole
 * order shipped with one carrier and one tracking number.
 *
 * ## The blocker, and why it turned out not to be structural
 *
 * The issue's reading was that scoping lines per supplier would STRAND every
 * other supplier: the order holds one scalar `supplierToken`, the routing loop
 * overwrites it, so only the last supplier can authenticate and the rest would
 * have no valid credential for lines nobody else could now close.
 *
 * That is right about the stored field and wrong about the token. The token is
 * `HMAC(hostId:orderId:supplierId)` under `TOKEN_SIGNING_SECRET` — a pure
 * function of three identifiers the order already carries, since `supplierId`
 * is stamped onto every line at purchase time. So the expected token for every
 * supplier can be RE-DERIVED at the door. That both identifies the poster and
 * lets every supplier authenticate, with no schema change and no migration —
 * which is what these tests measure, by minting each supplier's token here
 * exactly as `billing-webhook.ts` mints it and posting with it.
 *
 * The residual ambiguity is real and is refused rather than guessed: an order
 * whose lines carry NO `supplierId` (routed before that field was stamped) and
 * which has more than one supplier cannot say whose token the scalar is. Both
 * available answers are wrong — close lines a supplier never shipped, or strand
 * them — so the route says so out loud and sends the merchant to the console.
 *
 * ## The fake
 *
 * A transaction's writes are BUFFERED and applied at commit, all or nothing,
 * because this route's guarantee is that the read, the transition check and the
 * write are one act. `set(…, { merge: true })` merges at the TOP LEVEL, which
 * is what Firestore does with a plain object and what this route relies on: it
 * writes `status`, `fulfillments` and `timeline` and must leave `supplierToken`
 * and `totals` alone.
 */

const docs = new Map<string, Record<string, any>>()
const notifications: any[] = []

function makeDocRef(path: string) {
  return {
    id: path.split('/').pop() as string,
    path,
    async get() {
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    async set(value: Record<string, any>, options?: { merge?: boolean }) {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => {
      // Firestore's `.doc()` throws SYNCHRONOUSLY on a reserved `__…__` id,
      // and modelling that is the point of the reserved-id test below: a fake
      // that quietly made the document would report a 404 where the product
      // returns a 500, and the guard's red would be about the wrong thing.
      if (/^__.*__$/.test(id)) {
        throw new Error(
          `Invalid document ID "${id}". Document IDs cannot match /^__.*__$/`,
        )
      }
      return {
        ...makeDocRef(`${path}/${id}`),
        collection: (name: string) => makeCollectionRef(`${path}/${id}/${name}`),
      }
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  async runTransaction(handler: (transaction: any) => Promise<any>) {
    const buffered: { path: string; value: Record<string, any> }[] = []
    const transaction = {
      get: (reference: { get: () => Promise<any> }) => reference.get(),
      set: (
        reference: { path: string },
        value: Record<string, any>,
        options?: { merge?: boolean },
      ) => {
        buffered.push({
          path: reference.path,
          value: options?.merge
            ? { ...(docs.get(reference.path) ?? {}), ...value }
            : value,
        })
      },
    }
    const outcome = await handler(transaction)
    for (const write of buffered) docs.set(write.path, write.value)
    return outcome
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  notifyHostManagers: async (hostId: string, notification: any) => {
    notifications.push({ hostId, ...notification })
  },
}))

const SIGNING_SECRET = 'test-signing-secret'

/**
 * A supplier's token, minted here exactly as `billing-webhook.ts` mints it.
 * Duplicated on purpose rather than imported: if the two recipes ever diverge
 * these tests must go red, and importing the product's own function would hide
 * precisely that.
 */
function supplierToken(supplierId: string, orderId = 'order-1'): string {
  return createHmac('sha256', SIGNING_SECRET)
    .update(`host-1:${orderId}:${supplierId}`)
    .digest('hex')
    .slice(0, 32)
}

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
  const res: PluginApiResponse = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value
    },
    redirect() {
      /* unused */
    },
    end() {
      /* unused */
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

async function post(params: Record<string, unknown> = {}) {
  const { res, result } = makeResponse()
  await supplierUpdateHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-1', orderId: 'order-1', ...params },
      headers: {},
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const order = () => (docs.get('hosts/host-1/orders/order-1') ?? {}) as any

/**
 * Three lines across two suppliers, priced apart so an assertion cannot land on
 * the right number by reaching for the nearest one: Northwind ships the kettle
 * (index 0) and the tray (index 2), Contoso ships the lamp (index 1).
 */
function seedTwoSupplierOrder(overrides: Record<string, any> = {}) {
  docs.set('hosts/host-1/orders/order-1', {
    number: 1012,
    status: 'paid',
    // The scalar the routing loop left behind: the LAST supplier's token, which
    // is the whole shape of the reported blocker.
    supplierToken: supplierToken('contoso'),
    totals: { totalCents: 9900 },
    lineItems: [
      {
        productId: 'p1',
        name: 'Kettle',
        quantity: 1,
        unitAmountCents: 4200,
        supplierId: 'northwind',
      },
      {
        productId: 'p2',
        name: 'Lamp',
        quantity: 1,
        unitAmountCents: 3100,
        supplierId: 'contoso',
      },
      {
        productId: 'p3',
        name: 'Tray',
        quantity: 1,
        unitAmountCents: 2600,
        supplierId: 'northwind',
      },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...overrides,
  })
}

beforeAll(() => {
  process.env.TOKEN_SIGNING_SECRET = SIGNING_SECRET
})

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  seedTwoSupplierOrder()
})

// ---------------------------------------------------------------------------

describe('a supplier closes only their own lines (AGL-2455)', () => {
  it('records their lines and leaves the order partially fulfilled', async () => {
    const result = await post({
      token: supplierToken('northwind'),
      carrier: 'UPS',
      trackingNumber: '1Z-NW',
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      ok: true,
      lineItemIds: [0, 2],
      orderStatus: 'partially_fulfilled',
    })
    // NOT `fulfilled`. The lamp has not shipped and the buyer must not be told
    // it has.
    expect(order().status).toBe('partially_fulfilled')
    expect(order().fulfillments).toHaveLength(1)
    expect(order().fulfillments[0]).toMatchObject({
      lineItemIds: [0, 2],
      carrier: 'UPS',
      trackingNumber: '1Z-NW',
    })
  })

  /**
   * THE DEFECT, closed. Before the fix the first POST wrote `fulfilled` over
   * every line and the second met "Order is already fulfilled" — one carrier,
   * one tracking number, an order two thirds of which had not moved.
   */
  it('lets the SECOND supplier post, which the whole-order claim made impossible', async () => {
    await post({ token: supplierToken('northwind'), trackingNumber: '1Z-NW' })
    const second = await post({
      token: supplierToken('contoso'),
      carrier: 'DHL',
      trackingNumber: 'DH-CT',
    })
    expect(second.status).toBe(200)
    expect(second.body.lineItemIds).toEqual([1])
    // Every line is now covered, so the status is computed as `fulfilled` —
    // not written as one.
    expect(second.body.orderStatus).toBe('fulfilled')
    expect(order().status).toBe('fulfilled')
    expect(order().fulfillments).toHaveLength(2)
    expect(order().fulfillments.map((f: any) => f.trackingNumber)).toEqual([
      '1Z-NW',
      'DH-CT',
    ])
  })

  it('authenticates a supplier whose token was NEVER the stored scalar', async () => {
    // `supplierToken` on the order is Contoso's — the routing loop overwrote
    // Northwind's. The old compare was against that one stored value, so
    // Northwind could not have authenticated at all. Deriving is what admits
    // them, and this is the assertion that the blocker is actually gone.
    expect(order().supplierToken).toBe(supplierToken('contoso'))
    const result = await post({ token: supplierToken('northwind') })
    expect(result.status).toBe(200)
  })

  it('refuses a token that is nobody’s', async () => {
    const result = await post({ token: supplierToken('fabrikam') })
    expect(result.status).toBe(403)
    expect(order().status).toBe('paid')
    expect(order().fulfillments).toBeUndefined()
  })

  it('refuses a token minted for a DIFFERENT order', async () => {
    // The order id is inside the payload, so a token harvested from one
    // supplier email cannot close another merchant order.
    const result = await post({
      token: supplierToken('northwind', 'order-9'),
    })
    expect(result.status).toBe(403)
  })

  it('refuses a repeat POST from a supplier whose lines are already shipped', async () => {
    await post({ token: supplierToken('northwind'), trackingNumber: '1Z-NW' })
    const again = await post({
      token: supplierToken('northwind'),
      trackingNumber: '1Z-AGAIN',
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toContain('already marked shipped')
    // No second copy of the same fulfillment.
    expect(order().fulfillments).toHaveLength(1)
  })

  it('still refuses to write over a refund, which is AGL-2268’s guarantee', async () => {
    seedTwoSupplierOrder({ status: 'refunded' })
    const result = await post({ token: supplierToken('northwind') })
    expect(result.status).toBe(409)
    expect(order().status).toBe('refunded')
    expect(order().fulfillments).toBeUndefined()
  })

  it('tells the merchant what is still outstanding', async () => {
    await post({ token: supplierToken('northwind'), trackingNumber: '1Z-NW' })
    expect(notifications[0].title).toContain('1 line still to ship')
    // ...and says nothing about outstanding lines once the order is complete.
    await post({ token: supplierToken('contoso'), trackingNumber: 'DH-CT' })
    expect(notifications[1].title).not.toContain('still to ship')
  })

  it('leaves the fields it does not write alone', async () => {
    await post({ token: supplierToken('northwind') })
    expect(order().supplierToken).toBe(supplierToken('contoso'))
    expect(order().totals).toEqual({ totalCents: 9900 })
    expect(order().number).toBe(1012)
  })
})

describe('the ambiguous legacy order is refused, not guessed (AGL-2455)', () => {
  /**
   * An order routed before `supplierId` was stamped onto lines: the scalar
   * matches, but nothing on the order says whose token it is. Both available
   * answers are wrong — closing every line is the defect, closing none strands
   * them — so the route refuses out loud and names the way out.
   */
  it('refuses when the scalar matches but two suppliers are involved', async () => {
    seedTwoSupplierOrder({
      lineItems: [
        { productId: 'p1', name: 'Kettle', quantity: 1, unitAmountCents: 4200 },
        { productId: 'p2', name: 'Lamp', quantity: 1, unitAmountCents: 3100 },
      ],
      // Two suppliers are known to be involved even though the LINES carry no
      // ids — this is the shape the routing loop left behind.
      supplierToken: 'legacy-scalar-token-value-0000000',
    })
    // With no `supplierId` on any line the route sees ONE door and closes the
    // order, which is the correct answer for a single-supplier legacy order.
    const single = await post({ token: 'legacy-scalar-token-value-0000000' })
    expect(single.status).toBe(200)
    expect(order().status).toBe('fulfilled')
    expect(order().fulfillments[0].lineItemIds).toEqual([0, 1])
  })

  it('refuses when the lines name two suppliers and only the scalar matches', async () => {
    // Lines DO carry supplier ids, but the presented token is the opaque legacy
    // scalar rather than any derivable one — so the route knows two suppliers
    // are involved and cannot say which is posting.
    seedTwoSupplierOrder({ supplierToken: 'legacy-scalar-token-value-0000000' })
    const result = await post({ token: 'legacy-scalar-token-value-0000000' })
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('more than one supplier')
    expect(result.body.error).toContain('Nothing was changed')
    // Loudly refused means NOTHING moved — not a silently closed order.
    expect(order().status).toBe('paid')
    expect(order().fulfillments).toBeUndefined()
  })

  it('closes a single-supplier order through the stored scalar, as it always did', async () => {
    seedTwoSupplierOrder({
      supplierToken: 'legacy-scalar-token-value-0000000',
      lineItems: [
        {
          productId: 'p1',
          name: 'Kettle',
          quantity: 1,
          unitAmountCents: 4200,
          supplierId: 'northwind',
        },
      ],
    })
    const result = await post({ token: 'legacy-scalar-token-value-0000000' })
    expect(result.status).toBe(200)
    expect(order().status).toBe('fulfilled')
  })
})

describe('a reserved document id is a 400, not a 500 (AGL-2455)', () => {
  it('refuses `__proto__`-shaped ids before touching Firestore', async () => {
    // `.doc()` throws SYNCHRONOUSLY on a reserved id, which fell into the catch
    // and answered 500 to what is a caller's typo. `fulfill-order.ts` has had
    // this guard since it shipped; this is the sibling route that did not.
    for (const params of [
      { hostId: '__proto__' },
      { orderId: '__id__' },
    ]) {
      const result = await post({ token: supplierToken('northwind'), ...params })
      expect(result.status).toBe(400)
    }
  })
})
