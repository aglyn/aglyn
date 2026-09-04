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
 * Supplier tracking callback (AGL-289), and the three holes AGL-2268 closed in
 * it. This route had NO spec at all, which is the first thing to say about it:
 * it is the only money-adjacent handler in the plugin with no account behind
 * it — a bearer token in a URL that an email carries — and nothing measured
 * what it did.
 *
 * ## The fake
 *
 * A transaction's writes are BUFFERED and applied at commit, all or nothing,
 * because the route's whole fix is that the read, the transition check and the
 * write are one act. A fake that applied each write as it was issued would
 * report a half-written order as atomic (`cancel-order.spec.ts` records
 * measuring exactly that false green).
 *
 * `set(..., { merge: true })` merges at the TOP LEVEL only, which is what
 * Firestore does with a plain object and what this route relies on: it writes
 * `status`, `fulfillments` and `timeline` and must leave `supplierToken`,
 * `totals` and the rest alone.
 */

import { supplierUpdateHandler } from './supplier-update'
import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

const docs = new Map<string, Record<string, any>>()

/** Set to make the transactional GET reject, like a dead connection. */
let failRead: Error | null = null

const notifications: any[] = []

function makeDocRef(path: string) {
  return {
    id: path.split('/').pop() as string,
    path,
    async get() {
      if (failRead) throw failRead
      const data = docs.get(path)
      return {
        exists: data !== undefined,
        id: path.split('/').pop() as string,
        data: () => data,
        get: (field: string) => data?.[field],
      }
    },
    // Present because a real `DocumentReference` has it, NOT because the route
    // under test uses it. Modelling only what the fixed code calls would make
    // the forced-red run against the old code fail with "set is not a
    // function" — a red that proves the fake's shape, not the product's
    // behaviour.
    async set(value: Record<string, any>, options?: { merge?: boolean }) {
      docs.set(
        path,
        options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value,
      )
    },
  }
}

function makeCollectionRef(path: string) {
  return {
    doc: (id: string) => ({
      ...makeDocRef(`${path}/${id}`),
      collection: (name: string) => makeCollectionRef(`${path}/${id}/${name}`),
    }),
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

const TOKEN = 'a'.repeat(64)

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
      // unused
    },
    end() {
      // unused
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

async function call(
  method: 'GET' | 'POST',
  params: Record<string, unknown> = {},
) {
  const { res, result } = makeResponse()
  const merged = {
    hostId: 'host-1',
    orderId: 'order-1',
    token: TOKEN,
    ...params,
  }
  const request = {
    method,
    // A GET carries everything in the query string; a POST in the body, which
    // is the shape the confirmation form below submits.
    query: method === 'GET' ? merged : {},
    body: method === 'POST' ? merged : {},
    headers: {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await supplierUpdateHandler(request, res)
  return result
}

function storedOrder() {
  return docs.get('hosts/host-1/orders/order-1') ?? {}
}

function seedOrder(overrides: Record<string, any> = {}) {
  docs.set('hosts/host-1/orders/order-1', {
    number: 1012,
    status: 'paid',
    supplierToken: TOKEN,
    totals: { totalCents: 4200 },
    lineItems: [
      { productId: 'p1', name: 'Kettle', quantity: 1, unitAmountCents: 4200 },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...overrides,
  })
}

beforeEach(() => {
  docs.clear()
  notifications.length = 0
  failRead = null
  seedOrder()
})

// ---------------------------------------------------------------------------

describe('the happy path still works', () => {
  it('fulfils the order and records the tracking', async () => {
    const result = await call('POST', {
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })

    expect(result.status).toBe(200)
    // The response now names WHAT was closed (AGL-2455). A supplier who ships
    // part of a multi-supplier order needs to see that their lines — not the
    // whole order — are what moved, and `orderStatus` is how an integration
    // learns the order is still `partially_fulfilled` after their POST.
    expect(result.body).toEqual({
      ok: true,
      lineItemIds: [0],
      orderStatus: 'fulfilled',
    })
    expect(storedOrder().status).toBe('fulfilled')
    expect(storedOrder().fulfillments[0]).toMatchObject({
      carrier: 'UPS',
      trackingNumber: '1Z999',
      lineItemIds: [0],
    })
    // The merge left everything the route does not own alone.
    expect(storedOrder().supplierToken).toBe(TOKEN)
    expect(storedOrder().totals).toEqual({ totalCents: 4200 })
    expect(notifications).toHaveLength(1)
  })

  it('refuses an order that has already moved on', async () => {
    seedOrder({ status: 'delivered' })
    const result = await call('POST')
    expect(result.status).toBe(409)
    expect(storedOrder().status).toBe('delivered')
  })

  it('refuses an unknown order', async () => {
    docs.clear()
    expect((await call('POST')).status).toBe(404)
  })
})

/**
 * AGL-2268, hole 1. The read, the transition check and the write were a plain
 * `get()`, a check and a `set(…, {merge:true})` — the exact stale-read shape
 * AGL-1808/1818/1819 closed on the console's fulfil, cancel and refund routes,
 * left open on the one door with no account behind it.
 *
 * The cost is not cosmetic. `ORDER_TRANSITIONS` says `refunded: []`, and
 * `gate.ts`, `download.ts`, `membership-account.ts` and `reviews.ts` all
 * withdraw a shopper's entitlement by matching that literal — so a supplier
 * POST that overwrote `refunded` with `fulfilled` handed a refunded buyer
 * their downloads back.
 */
describe('a refund landing mid-request (AGL-2268)', () => {
  it('does not write fulfilled over a refund that landed after the read', async () => {
    // The refund commits between the transaction's read and its write, which
    // is what a real transaction re-reads and this fake reproduces by having
    // the read observe the CURRENT store.
    const original = fakeFirestore.runTransaction.bind(fakeFirestore)
    const spy = jest
      .spyOn(fakeFirestore, 'runTransaction')
      .mockImplementation(async (handler: any) =>
        original(async (transaction: any) => {
          const wrapped = {
            ...transaction,
            get: async (reference: any) => {
              // The refund lands FIRST, so the transaction's own read sees it.
              seedOrder({ status: 'refunded' })
              return transaction.get(reference)
            },
          }
          return handler(wrapped)
        }),
      )

    const result = await call('POST', { trackingNumber: '1Z999' })

    expect(result.status).toBe(409)
    expect(storedOrder().status).toBe('refunded')
    expect(storedOrder().fulfillments).toBeUndefined()
    spy.mockRestore()
  })

  it('writes nothing at all when the read fails', async () => {
    failRead = new Error('DEADLINE_EXCEEDED')
    const result = await call('POST')
    expect(result.status).toBe(500)
    expect(storedOrder().status).toBe('paid')
  })
})

/**
 * AGL-2268, hole 2. The token is a bearer credential for a route with no
 * account behind it, and it was compared with `!==` — which leaks its prefix
 * through response timing. `download.ts` has used `timingSafeEqual` on its own
 * token since it shipped; this is the sibling that did not.
 */
describe('the supplier token (AGL-2268)', () => {
  // These four are OUTCOME assertions and are green either way: `!==` also
  // refuses a wrong token. Constant time is not observable from a unit test,
  // so they are stated as what they are — regression guards that the compare
  // still REFUSES what it should, standing beside a change whose own evidence
  // is the call site.

  it('refuses a wrong token of the same length', async () => {
    const result = await call('POST', { token: 'b'.repeat(64) })
    expect(result.status).toBe(403)
    expect(storedOrder().status).toBe('paid')
  })

  it('refuses a token that is a prefix of the real one', async () => {
    const result = await call('POST', { token: 'a'.repeat(60) })
    expect(result.status).toBe(403)
  })

  it('refuses when the order carries no token at all', async () => {
    seedOrder({ supplierToken: undefined })
    expect((await call('POST', { token: TOKEN })).status).toBe(403)
  })

  it('refuses an empty token before it reaches Firestore', async () => {
    expect((await call('POST', { token: '' })).status).toBe(400)
  })
})

/**
 * AGL-2268, hole 3. The supplier email carries this URL, and a GET that
 * fulfils means every link scanner, spam filter, preview generator and browser
 * prefetch between us and the supplier's inbox marks the order shipped —
 * before anything shipped, and with no tracking number on it.
 *
 * The link and the email are unchanged; a GET now renders a one-button page
 * that POSTs the same parameters.
 */
describe('a GET never moves the order (AGL-2268)', () => {
  it('renders a confirmation form and writes nothing', async () => {
    const result = await call('GET', {
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })

    expect(result.status).toBe(200)
    expect(result.headers['Content-Type']).toBe('text/html')
    expect(String(result.body)).toContain('<form method="POST">')
    // The order is untouched — this is the whole point.
    expect(storedOrder().status).toBe('paid')
    expect(storedOrder().fulfillments).toBeUndefined()
    expect(notifications).toHaveLength(0)
  })

  it('carries every parameter forward so the POST needs no re-typing', async () => {
    const body = String(
      (await call('GET', { carrier: 'UPS', trackingNumber: '1Z999' })).body,
    )
    expect(body).toContain('name="hostId" value="host-1"')
    expect(body).toContain('name="orderId" value="order-1"')
    expect(body).toContain(`name="token" value="${TOKEN}"`)
    expect(body).toContain('name="carrier" value="UPS"')
    expect(body).toContain('name="trackingNumber" value="1Z999"')
  })

  it('escapes what it echoes back', async () => {
    // `carrier` and `trackingNumber` arrive in a URL anyone can craft, and the
    // page is served from the tenant's own origin.
    const body = String(
      (await call('GET', { carrier: '"><script>x()</script>' })).body,
    )
    expect(body).not.toContain('<script>')
    expect(body).toContain('&quot;&gt;&lt;script&gt;')
  })

  /**
   * POSITIVE CONTROL: the form the GET renders is the shape the POST accepts,
   * so a supplier who presses the button really does fulfil the order.
   */
  it('POSITIVE CONTROL: the form it renders fulfils when submitted', async () => {
    await call('GET', { carrier: 'UPS', trackingNumber: '1Z999' })
    const result = await call('POST', {
      carrier: 'UPS',
      trackingNumber: '1Z999',
    })
    expect(result.status).toBe(200)
    expect(storedOrder().status).toBe('fulfilled')
  })
})
