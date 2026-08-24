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
import * as CommerceModel from '../model'
import { checkMemberEntitlement } from './gate'
import { downloadHandler } from './download'
import { refundHandler } from './refund'
import { reviewsHandler } from './reviews'

/**
 * A partial refund takes the goods back (AGL-2454).
 *
 * THE DEFECT. Every digital entitlement in the product was withdrawn by
 * matching the literal `'refunded'` on `order.status` — five gates did it — and
 * `refund.ts` writes that literal ONLY when the order is fully refunded. So a
 * 99%-refunded order stayed `paid` and kept its downloads, its licence keys,
 * its gated content and its right to post a verified review. And a refund never
 * returned a licence key to the merchant's pool either: `assignedAtMs` was
 * stamped by `assignLicenseKeys` and set back by nothing anywhere, so a
 * merchant who sold one key of a hundred and refunded it had ninety-nine,
 * permanently, while the buyer kept a working key.
 *
 * ## What is asserted, and what is deliberately NOT
 *
 * The fix does not guess. A refund carries an AMOUNT, not lines, so an
 * amount-only refund still revokes nothing per line — asserted here as a
 * positive property, because inferring which goods a bare figure covers would
 * be a guess about the merchant's own stock. What it must not be is SILENT, so
 * the state is asserted too: `orderRefundState`, `orderRefundSummary` and the
 * order timeline all say so.
 *
 * A LINE-SCOPED refund is the case where attribution is honest, and there the
 * withdrawal is exact: that line's download 403s, its gated content closes, its
 * licence keys retire, and the lines the buyer kept are untouched.
 *
 * ## The double
 *
 * Writes are buffered inside a transaction and applied at commit, `set(…,
 * {merge:true})` DEEP-merges nested maps, and `arrayUnion` accumulates rather
 * than replaces — the last of those is what stops two admins refunding
 * different lines from erasing each other. A fake that replaced arrays would
 * report green for exactly that loss.
 *
 * ## Stripe
 *
 * `global.fetch` is replaced and THROWS on any target that is not
 * `api.stripe.com`, because localhost carries the LIVE secret key. The refund
 * call itself is intercepted and answered from memory — no money moves, and
 * every call made is asserted against.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
let autoIdCounter = 0

const DELETE = Symbol('FieldValue.delete')

function mergeInto(
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value === DELETE) {
      delete next[key]
    } else if (value && typeof value === 'object' && value.__increment != null) {
      next[key] = Number(next[key] ?? 0) + Number(value.__increment)
    } else if (value && typeof value === 'object' && value.__arrayUnion) {
      // ACCUMULATES. Two admins refunding different lines must not erase each
      // other's withdrawal, and a fake that replaced the array would pass a
      // handler that did.
      const existing = Array.isArray(next[key]) ? next[key] : []
      const added = (value.__arrayUnion as unknown[]).filter(
        (item) => !existing.includes(item),
      )
      next[key] = [...existing, ...added]
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      value.constructor === Object
    ) {
      next[key] = mergeInto(
        (next[key] && typeof next[key] === 'object' ? next[key] : {}) as any,
        value,
      )
    } else {
      next[key] = value
    }
  }
  return next
}

function writeDoc(path: string, value: Record<string, any>, merge: boolean) {
  docs.set(path, merge ? mergeInto(docs.get(path) ?? {}, value) : value)
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    ref: makeDocRef(path),
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      writeDoc(path, value, Boolean(options?.merge))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) {
        throw Object.assign(new Error(`5 NOT_FOUND: ${path}`), { code: 5 })
      }
      writeDoc(path, value, true)
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) {
        throw Object.assign(new Error(`6 ALREADY_EXISTS: ${path}`), { code: 6 })
      }
      writeDoc(path, value, false)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

/**
 * A collection reference that actually FILTERS on `where`, because the licence
 * retirement asks `where('orderId','==',orderId)` and a fake that ignored it
 * would retire every key in the pool while reporting green.
 */
function makeCollectionRef(
  path: string,
  filters: Array<[string, string, unknown]> = [],
): any {
  const ref: any = {
    doc: (id?: string) =>
      makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    where: (field: string, op: string, value: unknown) =>
      makeCollectionRef(path, [...filters, [field, op, value]]),
    limit: () => ref,
    get: async () => ({
      docs: childPaths(path)
        .map(makeSnapshot)
        .filter((snapshot) =>
          filters.every(([field, , value]) => snapshot.get(field) === value),
        ),
    }),
    add: async (value: Record<string, any>) => {
      const created = makeDocRef(`${path}/auto-${++autoIdCounter}`)
      docs.set(created.path, value)
      return created
    },
  }
  return ref
}

async function runTransaction(
  body: (transaction: any) => Promise<any>,
): Promise<any> {
  const writes: Array<[string, Record<string, any>, boolean]> = []
  const transaction = {
    get: async (ref: any) => makeSnapshot(ref.path),
    set: (ref: any, value: Record<string, any>, options?: any) => {
      writes.push([ref.path, value, Boolean(options?.merge)])
    },
    update: (ref: any, value: Record<string, any>) => {
      writes.push([ref.path, value, true])
    },
  }
  const result = await body(transaction)
  for (const [path, value, merge] of writes) writeDoc(path, value, merge)
  return result
}

const fakeFirestore: any = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => fakeFirestore,
      auth: () => ({ verifyIdToken: async () => ({ uid: 'admin-1' }) }),
    }),
    firestore: {
      FieldValue: {
        serverTimestamp: () => '<server-timestamp>',
        delete: () => DELETE,
        arrayUnion: (...values: any[]) => ({ __arrayUnion: values }),
        increment: (value: number) => ({ __increment: value }),
      },
    },
  },
  getOrgForHost: async () => ({
    org: { id: 'org-1', plan: 'business', ownerUid: 'owner-1' },
  }),
}))

/**
 * The org-scope half of the refund gate (AGL-2372). `admin-1` here is the
 * merchant's own owner, so this resolves org-wide.
 *
 * Stubbed rather than actual: the real resolver reads the roster through
 * `@aglyn/tenant-data-admin`, which the factory above replaces with a
 * closed-world double, and it fails CLOSED on a lookup error (AGL-506) — so
 * every test in this file would 403 for a reason it does not assert. The
 * gate's own behaviour is measured in `refund.spec.ts`.
 */
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'org-1',
    role: 'owner',
    isOwner: true,
    permissions: {},
    orgWide: true,
    hostRole: 'admin',
  }),
}))

jest.mock('./contact-refund', () => ({
  recordContactRefund: async () => undefined,
}))
jest.mock('./restock-flag', () => ({ flagOrderRestock: async () => undefined }))

// ---------------------------------------------------------------------------
// Stripe boundary
// ---------------------------------------------------------------------------

const stripeCalls: string[] = []
const fetchMock = jest.fn(async (url: any): Promise<any> => {
  const target = String(url)
  if (!target.includes('api.stripe.com')) {
    throw new Error(`Unexpected fetch to ${target}`)
  }
  stripeCalls.push(target)
  return { ok: true, json: async () => ({ id: 're_1', status: 'succeeded' }) }
})

// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code) {
      result.status = code
      return res
    },
    json(body) {
      result.body = body
    },
    send(body) {
      result.body = body
    },
    setHeader() {
      /* unused */
    },
    redirect(_code: number, url: string) {
      result.status = 302
      result.body = url
    },
    end() {
      /* unused */
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

const ORDER_PATH = 'hosts/host-1/orders/order-1'
const order = () => (docs.get(ORDER_PATH) ?? {}) as any
const liftedOrder = () => CommerceModel.liftLegacyOrder(order())

async function refund(body: Record<string, unknown>, key = 'attempt-1') {
  const { res, result } = makeResponse()
  await refundHandler(
    {
      method: 'POST',
      query: {},
      body: { hostId: 'host-1', orderId: 'order-1', ...body },
      headers: {
        authorization: 'Bearer token',
        'idempotency-key': key,
        host: 'acme.aglyn.app',
      },
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

async function download(productId: string) {
  const { res, result } = makeResponse()
  await downloadHandler(
    {
      method: 'GET',
      query: {
        hostId: 'host-1',
        orderId: 'order-1',
        productId,
        token: (await import('./download')).mintDownloadToken(
          'host-1',
          'order-1',
        ),
      },
      headers: {},
      cookies: {},
      socket: {},
    } as unknown as PluginApiRequest,
    res,
  )
  return result
}

const keyDocs = () =>
  childPaths('hosts/host-1/licenseKeys').map((path) => ({
    path,
    ...(docs.get(path) as any),
  }))

beforeAll(() => {
  ;(global as any).fetch = fetchMock
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  process.env.TOKEN_SIGNING_SECRET = 'test-signing-secret'
})

beforeEach(() => {
  docs.clear()
  stripeCalls.length = 0
  autoIdCounter = 0
  fetchMock.mockClear()

  docs.set('hosts/host-1', { memberRoles: { 'admin-1': 'admin' } })
  // TWO digital lines, priced apart so an assertion cannot land on the right
  // number by reaching for the nearest one: an ebook at $30 and a plugin at
  // $70, total $100.
  docs.set(ORDER_PATH, {
    status: 'paid',
    customerEmail: 'buyer@example.com',
    paymentIntentId: 'pi_1',
    lineItems: [
      {
        productId: 'ebook',
        name: 'The Walnut Book',
        quantity: 1,
        unitAmountCents: 3000,
        productType: 'digital',
      },
      {
        productId: 'plugin',
        name: 'Desk Planner Plugin',
        quantity: 1,
        unitAmountCents: 7000,
        productType: 'digital',
      },
    ],
    totals: {
      itemsCents: 10000,
      shippingCents: 0,
      taxCents: 0,
      discountCents: 0,
      feeCents: 0,
      totalCents: 10000,
    },
    licenseKeys: { plugin: ['PLUGIN-AAAA-BBBB'] },
  })
  for (const productId of ['ebook', 'plugin']) {
    docs.set(`hosts/host-1/products/${productId}`, {
      name: productId,
      type: 'digital',
      status: 'active',
      variants: [{ id: 'default', priceUsd: 30 }],
      digitalFiles: [{ url: `https://cdn.example/${productId}.zip`, fileName: 'f' }],
    })
  }
  // Three keys: one sold on this order, one sold on another, one unsold.
  docs.set('hosts/host-1/licenseKeys/k1', {
    productId: 'plugin',
    key: 'PLUGIN-AAAA-BBBB',
    orderId: 'order-1',
    assignedAtMs: 1000,
    email: 'buyer@example.com',
  })
  docs.set('hosts/host-1/licenseKeys/k2', {
    productId: 'plugin',
    key: 'PLUGIN-CCCC-DDDD',
    orderId: 'order-9',
    assignedAtMs: 2000,
  })
  docs.set('hosts/host-1/licenseKeys/k3', {
    productId: 'plugin',
    key: 'PLUGIN-EEEE-FFFF',
    assignedAtMs: null,
  })
})

// ---------------------------------------------------------------------------

describe('an amount-only partial refund is not silent (AGL-2454)', () => {
  it('revokes no line, and SAYS so', async () => {
    const result = await refund({ amountCents: 9900 })
    expect(result.status).toBe(200)
    // Status is still `paid` — a partially refunded order is a live order, and
    // `fulfill-order.ts` must still be able to ship what was not refunded.
    expect(order().status).toBe('paid')
    expect(order().refundedCents).toBe(9900)
    expect(order().refundedLineItemIds).toBeUndefined()

    // ...and none of that is silent.
    expect(CommerceModel.orderRefundState(liftedOrder())).toBe('partial')
    expect(CommerceModel.orderRefundSummary(liftedOrder())).toBe(
      'Partially refunded ($99.00 of $100.00) — no lines withdrawn — refunded by amount',
    )
    const events = (order().timeline ?? []) as any[]
    expect(events[events.length - 1].detail).toContain(
      'no lines withdrawn',
    )
  })

  it('leaves both downloads live, because nothing said which goods came back', async () => {
    await refund({ amountCents: 9900 })
    // The honest answer, and a deliberate one: guessing which of a $30 ebook
    // and a $70 plugin a $99 refund covered would be a guess about the
    // merchant's goods. Naming the lines is how that question gets answered —
    // see the line-scoped describe below.
    expect((await download('ebook')).status).toBe(302)
    expect((await download('plugin')).status).toBe(302)
  })
})

describe('a line-scoped partial refund withdraws exactly that line (AGL-2454)', () => {
  it('refuses the refunded line its download and keeps the other', async () => {
    const result = await refund({ lineItemIds: [1] })
    expect(result.status).toBe(200)
    // The amount came FROM the line, not from a figure typed beside it.
    expect(order().refundedCents).toBe(7000)
    expect(order().refundedLineItemIds).toEqual([1])
    expect(order().status).toBe('paid')

    const refunded = await download('plugin')
    expect(refunded.status).toBe(403)
    expect(refunded.body).toBe('This purchase was refunded')
    // The line the buyer kept is untouched — a partial refund must not
    // silently revoke a whole order either.
    expect((await download('ebook')).status).toBe(302)
  })

  it('closes the gated content for that line only', async () => {
    await refund({ lineItemIds: [1] })
    expect(
      await checkMemberEntitlement('host-1', 'buyer@example.com', 'plugin'),
    ).toBe(false)
    expect(
      await checkMemberEntitlement('host-1', 'buyer@example.com', 'ebook'),
    ).toBe(true)
  })

  it('reports what remains entitled, in words the merchant reads', async () => {
    await refund({ lineItemIds: [1] })
    expect(CommerceModel.orderRefundSummary(liftedOrder())).toBe(
      'Partially refunded ($70.00 of $100.00) — 1 of 2 lines withdrawn',
    )
  })

  /**
   * THE FORCED RED, from the other direction: with the withdrawal stripped off
   * the order — the pre-fix state, where a partial refund recorded only an
   * amount — the download is served again. This is what the five gates did to
   * a 99%-refunded order, reproduced deliberately so the assertions above are
   * known to be load-bearing.
   */
  it('would serve the refunded download if the line were not recorded (forced red)', async () => {
    await refund({ lineItemIds: [1] })
    expect((await download('plugin')).status).toBe(403)
    docs.set(ORDER_PATH, { ...order(), refundedLineItemIds: [] })
    expect((await download('plugin')).status).toBe(302)
  })

  it('accumulates a second admin’s line rather than erasing the first', async () => {
    await refund({ lineItemIds: [1] }, 'attempt-1')
    await refund({ lineItemIds: [0] }, 'attempt-2')
    expect(order().refundedLineItemIds.sort()).toEqual([0, 1])
    // Every line withdrawn and the money all back: the order closes.
    expect(order().status).toBe('refunded')
    expect(order().refundedCents).toBe(10000)
  })

  it('refuses an amount SMALLER than the lines it claims to cover', async () => {
    const result = await refund({ lineItemIds: [1], amountCents: 100 })
    expect(result.status).toBe(400)
    // Nothing moved and nothing was withdrawn: revoking a $70 line for $1 is
    // the silent OVER-revocation, the mirror of the defect being fixed.
    expect(stripeCalls).toHaveLength(0)
    expect(order().refundedCents).toBeUndefined()
    expect(order().refundedLineItemIds).toBeUndefined()
  })

  it('accepts an amount LARGER than the lines, which is the line plus its tax', async () => {
    const result = await refund({ lineItemIds: [1], amountCents: 7600 })
    expect(result.status).toBe(200)
    expect(order().refundedCents).toBe(7600)
    expect(order().refundedLineItemIds).toEqual([1])
  })

  it('refuses a line index that is not on the order', async () => {
    const result = await refund({ lineItemIds: [7] })
    expect(result.status).toBe(400)
    expect(result.body.error).toContain('Line 7')
    expect(stripeCalls).toHaveLength(0)
  })

  /**
   * The cap biting into the named lines: an earlier partial has left less on
   * the order than the selected lines are worth. Refused and the reservation
   * given back, rather than refunded-for-less-and-revoked-anyway.
   */
  it('refuses when earlier partials left less than the line is worth', async () => {
    await refund({ amountCents: 5000 }, 'attempt-1')
    const result = await refund({ lineItemIds: [1] }, 'attempt-2')
    expect(result.status).toBe(409)
    expect(result.body.error).toContain('$50.00 is left to refund')
    // The reservation was compensated — not left standing against the order.
    expect(order().refundedCents).toBe(5000)
    expect(order().refundedLineItemIds).toBeUndefined()
    expect(stripeCalls).toHaveLength(1)
  })
})

describe('a full refund still withdraws everything (AGL-2454)', () => {
  it('closes the order and refuses both downloads', async () => {
    const result = await refund({})
    expect(result.status).toBe(200)
    expect(order().status).toBe('refunded')
    expect((await download('ebook')).status).toBe(403)
    expect((await download('plugin')).status).toBe(403)
    expect(
      await checkMemberEntitlement('host-1', 'buyer@example.com', 'any'),
    ).toBe(false)
  })
})

describe('licence keys are RETIRED, never returned to the pool (AGL-2454)', () => {
  it('retires the key a refunded line delivered', async () => {
    await refund({ lineItemIds: [1] })
    const [k1, k2, k3] = keyDocs()
    expect(k1.revokedAtMs).toBeGreaterThan(0)
    expect(k1.revokedOrderId).toBe('order-1')
    // `assignedAtMs` STAYS. `assignLicenseKeys` claims from
    // `where('assignedAtMs','==',null)`, so clearing it would put this key
    // straight back in front of the next buyer — the reissue this must not do,
    // because the buyer already holds the string.
    expect(k1.assignedAtMs).toBe(1000)
    expect(k1.key).toBe('PLUGIN-AAAA-BBBB')

    // Another order's key and the unsold key are untouched. This is what the
    // `where('orderId','==',…)` filter is for, and the fake honours it.
    expect(k2.revokedAtMs).toBeUndefined()
    expect(k3.revokedAtMs).toBeUndefined()
    expect(k3.assignedAtMs).toBeNull()
  })

  it('records the retirement where the merchant reads it', async () => {
    await refund({ lineItemIds: [1] })
    const events = (order().timeline ?? []) as any[]
    const retired = events.find((event) => event.event === 'license-retired')
    expect(retired).toBeDefined()
    expect(retired.detail).toContain('1 licence key')
    expect(retired.detail).toContain('not returned to the pool')
  })

  it('retires nothing when the refund did not withdraw the line', async () => {
    await refund({ amountCents: 9900 })
    expect(keyDocs()[0].revokedAtMs).toBeUndefined()
  })

  it('retires nothing twice, so a second refund does not restamp it', async () => {
    await refund({ lineItemIds: [1] }, 'attempt-1')
    const stamped = keyDocs()[0].revokedAtMs
    await refund({ lineItemIds: [0] }, 'attempt-2')
    expect(keyDocs()[0].revokedAtMs).toBe(stamped)
  })

  it('stops listing the retired key on the buyer’s account page', async () => {
    await refund({ lineItemIds: [1] })
    // The account page lists a line's licence keys only while the line is
    // still entitled. The string itself cannot be taken back once mailed —
    // which is exactly why the pool key is retired rather than reissued — so
    // withdrawing it from the page is the only revocation available.
    expect(
      CommerceModel.orderEntitlesProduct(liftedOrder(), 'plugin'),
    ).toBe(false)
    expect(CommerceModel.orderEntitlesProduct(liftedOrder(), 'ebook')).toBe(true)
  })
})

describe('the reviews gate (AGL-2454)', () => {
  async function postReview(productId: string) {
    const { res, result } = makeResponse()
    await reviewsHandler(
      {
        method: 'POST',
        query: {},
        body: {
          hostId: 'host-1',
          productId,
          rating: 5,
          body: 'Loved it.',
          authorEmail: 'buyer@example.com',
        },
        headers: {},
        cookies: {},
        socket: {},
      } as unknown as PluginApiRequest,
      res,
    )
    void result
    return childPaths('hosts/host-1/reviews').map(
      (path) => docs.get(path) as any,
    )
  }

  /**
   * Driven through the real handler rather than asserted on the predicate: a
   * "verified buyer" badge on goods that went back is a claim the storefront
   * makes to other shoppers, and the assertion has to be about the row that
   * actually lands in the moderation queue.
   */
  it('stops verifying a buyer whose line was refunded, and keeps the one they kept', async () => {
    await refund({ lineItemIds: [1] })
    const [pluginReview] = await postReview('plugin')
    expect(pluginReview.productId).toBe('plugin')
    expect(pluginReview.verified).toBe(false)
    const ebookReview = (await postReview('ebook')).find(
      (review) => review.productId === 'ebook',
    )
    expect(ebookReview.verified).toBe(true)
  })
})
