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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { planListQuery } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { nameSearchKey, nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { ORDER_LIST_COLUMN_SORTS, ORDER_LIST_QUERY } from '../constants/orders-list-query'
import { handleQuote, type QuoteDeps } from './quote'

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {}, getOrgForHost: jest.fn() }))

let mockUid = 0
jest.mock('@aglyn/aglyn/app-utils/create-resource-uid', () => ({
  createResourceUid: () => `quote-${++mockUid}`,
}))

/**
 * `POST /api/commerce/quote` (AGL-4093), driven through the real handler over
 * an in-memory Firestore, so every case asserts what was WRITTEN as well as
 * what was answered.
 */

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function snapshotOf(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : JSON.parse(JSON.stringify(data))),
    get: (field: string) => field.split('.').reduce<any>((value, key) => value?.[key], data),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => snapshotOf(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : JSON.parse(JSON.stringify(value)))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => {
      docs.delete(path)
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return { doc: (id?: string) => docRef(`${path}/${id ?? `quote-${++autoId}`}`) }
}

const firestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async <T,>(fn: (transaction: any) => Promise<T>) =>
    fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, value: any, options?: any) => void ref.set(value, options),
      delete: (ref: any) => void ref.delete(),
    }),
}

const ORG = { id: 'org-1', plan: 'business', billingStatus: 'active', ownerUid: 'owner-1', slug: 'acme' }
const quoteTax = jest.fn<ReturnType<QuoteDeps['quoteTax']>, Parameters<QuoteDeps['quoteTax']>>(async () => ({
  quote: null,
  stamp: null,
}))
const searchPeople = jest.fn<ReturnType<QuoteDeps['searchPeople']>, Parameters<QuoteDeps['searchPeople']>>(
  async () => [],
)
let nowMs = 1_000
const expireSession = jest.fn<ReturnType<QuoteDeps['expireSession']>, Parameters<QuoteDeps['expireSession']>>(
  async () => 'expired',
)

const quotePdf = jest.fn<ReturnType<QuoteDeps['quotePdf']>, Parameters<QuoteDeps['quotePdf']>>(async (input) => ({
  bytes: new Uint8Array([37, 80, 68, 70]),
  filename: `quote-${String(input.order.number)}.pdf`,
}))

const deps: QuoteDeps = {
  verifyIdToken: async (token) => ({ uid: token, email: `${token}@example.com` }),
  firestore: () => firestore,
  orgForHost: async () => ({ id: 'org-1', org: ORG }),
  searchPeople,
  quoteTax,
  expireSession,
  payLinkUrl: (host, hostId, quoteId, version) =>
    host['subdomain'] ? `https://${String(host['subdomain'])}.aglyn.app/pay-quote?q=${quoteId}&t=${version}.sig-${hostId}` : null,
  quotePdf,
  now: () => nowMs,
}

function request(uid: string, body: Record<string, unknown>, key = ''): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body,
    headers: { authorization: `Bearer ${uid}`, ...(key ? { 'idempotency-key': key } : {}) },
    cookies: {},
    socket: {},
  }
}

const CUSTOM = { kind: 'custom', name: 'Installation', unitAmountCents: 30_000, quantity: 1 }
const CANOPY = { kind: 'catalog', productId: 'canopy', variantId: 'red', quantity: 2 }

const quoteDocs = () =>
  [...docs.entries()].filter(([path, data]) => path.startsWith('hosts/site1/orders/') && data.channel === 'quote')

beforeEach(() => {
  docs.clear()
  autoId = 0
  mockUid = 0
  nowMs = 1_000
  quoteTax.mockClear()
  searchPeople.mockClear()
  expireSession.mockClear()
  quotePdf.mockClear()
  docs.set('hosts/site1', {
    subdomain: 'acme',
    memberRoles: { admin: 'admin', editor: 'editor', author: 'author', viewer: 'viewer', granted: 'author', sender: 'author', editsOnly: 'editor' },
    memberPermissions: {
      granted: { 'commerce.quotes': true },
      editor: {},
      sender: { 'commerce.quotes.send': true },
      editsOnly: { 'commerce.quotes.send': false },
    },
  })
  docs.set('hosts/site1/counters/orders', { next: 1042 })
  docs.set('hosts/site1/settings/store', {
    tax: { mode: 'manual', origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25 }] },
  })
  docs.set('hosts/site1/products/canopy', {
    name: 'Canopy 10x10',
    type: 'physical',
    variants: [{ id: 'red', options: { Color: 'Red' }, priceUsd: 1_200, sku: 'CAN-R', inventory: 3 }],
  })
})

describe('who may make quotes', () => {
  it.each([
    ['author', 403],
    ['viewer', 403],
    ['stranger', 403],
  ])('a site %s without "Create and edit quotes" is refused, and nothing is written', async (uid, status) => {
    const outcome = await handleQuote(deps, request(uid, { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'k1'))
    expect(outcome).toEqual({
      status,
      body: { error: 'Your role does not include "Create and edit quotes" — ask an organization admin' },
    })
    expect(quoteDocs()).toEqual([])
    expect(docs.get('hosts/site1/counters/orders')).toEqual({ next: 1042 })
  })

  it('admits the site roles that work orders, and a member granted the key', async () => {
    for (const [index, uid] of ['admin', 'editor', 'granted'].entries()) {
      const outcome = await handleQuote(
        deps,
        request(uid, { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, `k-${index}`),
      )
      expect(outcome.status).toBe(200)
    }
    expect(quoteDocs()).toHaveLength(3)
  })

  it('refuses the customer search too', async () => {
    const outcome = await handleQuote(deps, request('author', { action: 'search-customers', hostId: 'site1', text: 'jo' }))
    expect(outcome.status).toBe(403)
    expect(searchPeople).not.toHaveBeenCalled()
  })

  it('needs a signed-in member of a real site', async () => {
    expect((await handleQuote(deps, { ...request('admin', {}), headers: {} })).status).toBe(401)
    expect((await handleQuote(deps, request('admin', { action: 'create', hostId: 'nope', quote: {} }, 'k'))).status).toBe(404)
  })
})

describe('creating a quote', () => {
  it('writes an unpaid quote numbered from the order counter, priced on the server', async () => {
    const outcome = await handleQuote(
      deps,
      request(
        'admin',
        {
          action: 'create',
          hostId: 'site1',
          quote: {
            lines: [
              // A price the console sends for a product line is ignored.
              { ...CANOPY, unitAmountCents: 1 },
              CUSTOM,
              { kind: 'custom', name: 'Carry bag', unitAmountCents: 2_500, quantity: 1, included: true },
            ],
            customer: { name: 'Jordan Lee', email: 'jordan@example.com', record: { kind: 'contact', id: 'c1' } },
            shipTo: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
            discount: { kind: 'percent', pct: 10 },
            shipping: { amountCents: 4_500 },
            notes: 'Thanks for asking',
            terms: 'Half up front',
          },
        },
        'k-create',
      ),
    )
    expect(outcome).toEqual({ status: 200, body: { quoteId: 'quote-1', number: 1042, updatedAtMs: 1_000 } })
    expect(docs.get('hosts/site1/counters/orders')).toEqual({ next: 1043 })
    const stored = docs.get('hosts/site1/orders/quote-1') as Record<string, any>
    expect(stored).toMatchObject({
      number: 1042,
      status: 'pending',
      channel: 'quote',
      taxMode: 'manual',
      totals: {
        itemsCents: 270_000,
        discountCents: 27_000,
        shippingCents: 4_500,
        taxCents: 20_048,
        feeCents: 0,
        totalCents: 270_000 - 27_000 + 4_500 + 20_048,
      },
      quote: {
        stage: 'draft',
        revision: 1,
        customer: {
          record: { kind: 'contact', id: 'c1' },
          name: 'Jordan Lee',
          email: 'jordan@example.com',
          emailLower: 'jordan@example.com',
        },
        notes: 'Thanks for asking',
        terms: 'Half up front',
        discount: { kind: 'percent', pct: 10 },
        shipping: { amountCents: 4_500 },
        tax: { kind: 'rate', pct: 8.25 },
        requireProofApproval: false,
        createdAtMs: 1_000,
        updatedAtMs: 1_000,
        createdBy: 'admin@example.com',
      },
    })
    expect(stored['lineItems']).toEqual([
      {
        productId: 'canopy',
        variantId: 'red',
        name: 'Canopy 10x10',
        variantLabel: 'Red',
        sku: 'CAN-R',
        productType: 'physical',
        quantity: 2,
        unitAmountCents: 120_000,
      },
      { productId: '', custom: true, name: 'Installation', productType: 'physical', quantity: 1, unitAmountCents: 30_000 },
      {
        productId: '',
        custom: true,
        name: 'Carry bag',
        productType: 'physical',
        quantity: 1,
        unitAmountCents: 0,
        included: true,
      },
    ])
    // Stock is untouched: a quote is not a sale.
    expect(docs.get('hosts/site1/products/canopy')?.['variants'][0].inventory).toBe(3)
  })

  it('replays a retried create instead of writing a second quote or burning a number', async () => {
    const body = { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }
    const first = await handleQuote(deps, request('admin', body, 'same-key'))
    const second = await handleQuote(deps, request('admin', body, 'same-key'))
    expect(second).toEqual(first)
    expect(quoteDocs()).toHaveLength(1)
    expect(docs.get('hosts/site1/counters/orders')).toEqual({ next: 1043 })
  })

  it('refuses a save with no idempotency key, and a quote that does not parse, before writing', async () => {
    expect(await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }))).toEqual({
      status: 400,
      body: { error: 'A quote save needs an Idempotency-Key header.' },
    })
    expect(await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [] } }, 'k'))).toEqual({
      status: 400,
      body: { error: 'Add at least one line to the quote.' },
    })
    expect(
      await handleQuote(
        deps,
        request('admin', { action: 'create', hostId: 'site1', quote: { lines: [{ ...CANOPY, productId: 'gone' }] } }, 'k2'),
      ),
    ).toEqual({ status: 400, body: { error: 'A product on this quote no longer exists. Remove it and add it again.' } })
    expect(quoteDocs()).toEqual([])
    // A refused attempt leaves its key unspent: fixing the input and saving again works.
    const retried = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'k2'))
    expect(retried.status).toBe(200)
  })

  it('starts with the store’s proof-approval default, unless the quote says otherwise', async () => {
    docs.set('hosts/site1/settings/store', { ...docs.get('hosts/site1/settings/store'), quotes: { requireProofApproval: true } })
    await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'a'))
    await handleQuote(
      deps,
      request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM], requireProofApproval: false } }, 'b'),
    )
    expect(quoteDocs().map(([, data]) => data.quote.requireProofApproval)).toEqual([true, false])
  })

  it('leaves the tax to the payment on Stripe Tax', async () => {
    docs.set('hosts/site1/settings/store', { tax: { mode: 'stripe' } })
    await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'k'))
    const [[, stored]] = quoteDocs()
    expect(stored.quote.tax).toEqual({ kind: 'at-payment' })
    expect(stored.totals.taxCents).toBe(0)
    expect(stored.taxMode).toBe('stripe-automatic')
    expect(quoteTax).not.toHaveBeenCalled()
  })

  it('asks the site’s tax service on the invoice channel, with each line after its discount, and keeps its answer', async () => {
    quoteTax.mockResolvedValueOnce({
      quote: { provider: 'taxjar', providerLabel: 'TaxJar', taxCents: 2_222, lines: [], shippingTaxCents: 0, sandbox: true },
      stamp: null,
    })
    await handleQuote(
      deps,
      request(
        'admin',
        {
          action: 'create',
          hostId: 'site1',
          quote: {
            lines: [CUSTOM, { ...CUSTOM, name: 'Bag', included: true }],
            discount: { kind: 'amount', amountCents: 5_000 },
            shipping: { amountCents: 1_000 },
            shipTo: { country: 'US', state: 'OK', postalCode: '74103' },
            customer: { email: 'pat@example.com' },
          },
        },
        'k',
      ),
    )
    expect(quoteTax).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'invoice',
        lines: [expect.objectContaining({ id: '0', amountCents: 25_000, quantity: 1 })],
        shippingCents: 1_000,
        shipTo: { country: 'US', region: 'OK', postalCode: '74103' },
        customerEmail: 'pat@example.com',
      }),
    )
    const [[, stored]] = quoteDocs()
    expect(stored.quote.tax).toEqual({ kind: 'service', taxCents: 2_222, providerLabel: 'TaxJar' })
    expect(stored.totals.totalCents).toBe(30_000 - 5_000 + 1_000 + 2_222)
  })

  it('charges no tax on a store that collects none', async () => {
    docs.set('hosts/site1/settings/store', { tax: { mode: 'none' } })
    await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'k'))
    const [[, stored]] = quoteDocs()
    expect(stored.totals.taxCents).toBe(0)
    expect(stored.taxMode).toBe('none')
  })
})

describe('quotes stay out of the order lists', () => {
  it('a stored quote carries none of the fields any order list, report or customer page queries', async () => {
    await handleQuote(
      deps,
      request(
        'admin',
        {
          action: 'create',
          hostId: 'site1',
          quote: { lines: [CANOPY], customer: { email: 'jordan@example.com', name: 'Jordan Lee' }, shipTo: { line1: '1 Main', country: 'US' } },
        },
        'k',
      ),
    )
    const [[, stored]] = quoteDocs()
    for (const field of [
      'createdAtMs',
      'createdAt',
      'updatedAtMs',
      'customerEmail',
      'customerEmailLower',
      'customerEmailTokens',
      'customerName',
      'shippingAddress',
      'billingAddress',
      'searchTokens',
      'orderLabelTokens',
      'productIds',
      'requiresShipping',
      'useDayKeys',
      'disputeKey',
    ]) {
      expect(stored).not.toHaveProperty(field)
    }
  })

  it('every order the Orders list takes under a filter or search, and its default, is on `createdAtMs`', () => {
    const names = {
      key: nameSearchKey,
      token: (value: string) => nameSearchTokens(value)[0] ?? '',
      reversed: (value: string) => [...nameSearchKey(value)].reverse().join(''),
      maxPrefix: 20,
    }
    const filtered = [
      { clauses: [] },
      { clauses: [{ field: 'statusKey', op: 'equals', value: 'pending' }] },
      { clauses: [{ field: 'channelKey', op: 'equals', value: 'quote' }] },
      { clauses: [], search: ['canopy'] },
      // A header sort asked under a filter falls back to newest first.
      ...ORDER_LIST_COLUMN_SORTS.map((sort) => ({
        clauses: [{ field: 'statusKey', op: 'equals', value: 'pending' }],
        sort,
      })),
    ]
    for (const asked of filtered) {
      const plan = planListQuery(ORDER_LIST_QUERY, asked as never, names)
      expect(plan.orderBy.path).toBe('createdAtMs')
    }
    // The unfiltered header sorts on another field. A quote carries none of
    // `customerEmailLower`, so only `number`, `channel` and `status` can reach
    // one, and the card drops unpaid quotes from those with `isUnpaidQuote`.
    const elsewhere = ORDER_LIST_COLUMN_SORTS.filter(
      (sort) => planListQuery(ORDER_LIST_QUERY, { clauses: [], sort }, names).orderBy.path !== 'createdAtMs',
    ).map((sort) => sort.path)
    expect([...new Set(elsewhere)].sort()).toEqual(['channel', 'customerEmailLower', 'number', 'status'])
  })
})

describe('editing and deleting a quote', () => {
  async function created(): Promise<string> {
    const outcome = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'c'))
    return String(outcome.body['quoteId'])
  }

  it('rewrites the lines and totals, keeps the number, stage and creator, and notes who changed it', async () => {
    const quoteId = await created()
    nowMs = 2_000
    const outcome = await handleQuote(
      deps,
      request(
        'editor',
        {
          action: 'update',
          hostId: 'site1',
          quoteId,
          baseUpdatedAtMs: 1_000,
          quote: { lines: [CANOPY], discount: { kind: 'amount', amountCents: 10_000 }, requireProofApproval: true },
        },
        'u1',
      ),
    )
    expect(outcome).toEqual({ status: 200, body: { quoteId, number: 1042, updatedAtMs: 2_000 } })
    const stored = docs.get(`hosts/site1/orders/${quoteId}`) as Record<string, any>
    expect(stored['number']).toBe(1042)
    expect(stored['lineItems']).toHaveLength(1)
    expect(stored['totals']).toMatchObject({ itemsCents: 240_000, discountCents: 10_000 })
    expect(stored['quote']).toMatchObject({
      stage: 'draft',
      revision: 1,
      discount: { kind: 'amount', amountCents: 10_000 },
      requireProofApproval: true,
      createdBy: 'admin@example.com',
      updatedBy: 'editor@example.com',
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
    })
    expect(stored['timeline'].map((entry: any) => entry.event)).toEqual(['quote', 'quote-updated'])
    expect(docs.get('hosts/site1/counters/orders')).toEqual({ next: 1043 })
  })

  it('refuses a save made over someone else’s change', async () => {
    const quoteId = await created()
    const outcome = await handleQuote(
      deps,
      request('admin', { action: 'update', hostId: 'site1', quoteId, baseUpdatedAtMs: 999, quote: { lines: [CANOPY] } }, 'u'),
    )
    expect(outcome.status).toBe(409)
    expect(docs.get(`hosts/site1/orders/${quoteId}`)?.['lineItems'][0].custom).toBe(true)
  })

  it('replays a retried update rather than refusing it as a conflict', async () => {
    const quoteId = await created()
    nowMs = 2_000
    const body = { action: 'update', hostId: 'site1', quoteId, baseUpdatedAtMs: 1_000, quote: { lines: [CANOPY] } }
    const first = await handleQuote(deps, request('admin', body, 'retry'))
    nowMs = 3_000
    expect(await handleQuote(deps, request('admin', body, 'retry'))).toEqual(first)
  })

  it('never edits a paid quote, or an order that is not a quote', async () => {
    const quoteId = await created()
    docs.set(`hosts/site1/orders/${quoteId}`, { ...docs.get(`hosts/site1/orders/${quoteId}`), status: 'paid' })
    docs.set('hosts/site1/orders/order-9', { status: 'pending', channel: 'draft', lineItems: [] })
    const update = (id: string, key: string) =>
      handleQuote(deps, request('admin', { action: 'update', hostId: 'site1', quoteId: id, baseUpdatedAtMs: 1_000, quote: { lines: [CUSTOM] } }, key))
    expect((await update(quoteId, 'p')).status).toBe(409)
    expect((await update('order-9', 'o')).status).toBe(404)
  })

  it('deletes a draft quote, idempotently, and never a paid one or an order', async () => {
    const quoteId = await created()
    const remove = (id: string) => handleQuote(deps, request('admin', { action: 'delete', hostId: 'site1', quoteId: id }))
    expect(await remove(quoteId)).toEqual({ status: 200, body: { deleted: true } })
    expect(docs.has(`hosts/site1/orders/${quoteId}`)).toBe(false)
    expect(await remove(quoteId)).toEqual({ status: 200, body: { deleted: true } })

    const paidId = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'p2'))
    const paidPath = `hosts/site1/orders/${String(paidId.body['quoteId'])}`
    docs.set(paidPath, { ...docs.get(paidPath), status: 'paid' })
    expect((await remove(String(paidId.body['quoteId']))).status).toBe(409)
    docs.set('hosts/site1/orders/order-9', { status: 'pending', channel: 'draft' })
    expect((await remove('order-9')).status).toBe(404)
    expect(docs.has('hosts/site1/orders/order-9')).toBe(true)
  })

  it('refuses deleting without the key', async () => {
    const quoteId = await created()
    expect((await handleQuote(deps, request('author', { action: 'delete', hostId: 'site1', quoteId }))).status).toBe(403)
    expect(docs.has(`hosts/site1/orders/${quoteId}`)).toBe(true)
  })
})

describe('finding the customer', () => {
  it('searches the workspace’s people and answers what the quote keeps', async () => {
    searchPeople.mockResolvedValueOnce([
      { kind: 'contact', id: 'c1', email: 'jordan@example.com', data: { name: 'Jordan Lee', phone: '555-0100', company: 'Acme Builders' } },
    ])
    const outcome = await handleQuote(deps, request('admin', { action: 'search-customers', hostId: 'site1', text: 'jordan' }))
    expect(searchPeople).toHaveBeenCalledWith({ hostId: 'site1', orgId: 'org-1', text: 'jordan', limit: 10 })
    expect(outcome.body).toEqual({
      available: true,
      customers: [
        { record: { kind: 'contact', id: 'c1' }, name: 'Jordan Lee', company: 'Acme Builders', email: 'jordan@example.com', phone: '555-0100' },
      ],
    })
  })

  it('says when the workspace keeps no people, so the console offers typed details only', async () => {
    searchPeople.mockResolvedValueOnce(null)
    const outcome = await handleQuote(deps, request('admin', { action: 'search-customers', hostId: 'site1', text: 'jordan' }))
    expect(outcome.body).toEqual({ available: false, customers: [] })
  })
})

describe('a quote’s open payment goes with the version it was priced from (AGL-4094)', () => {
  async function createdWithSession(): Promise<{ quoteId: string; path: string }> {
    const outcome = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'c'))
    const quoteId = String(outcome.body['quoteId'])
    const path = `hosts/site1/orders/${quoteId}`
    docs.set(path, { ...docs.get(path), checkoutSessionId: 'cs_test_open123456' })
    return { quoteId, path }
  }

  it('an edit expires the session the pay page opened, and forgets it', async () => {
    const { quoteId, path } = await createdWithSession()
    nowMs = 2_000
    const outcome = await handleQuote(
      deps,
      request('admin', { action: 'update', hostId: 'site1', quoteId, baseUpdatedAtMs: 1_000, quote: { lines: [CANOPY] } }, 'e'),
    )
    expect(outcome.status).toBe(200)
    expect(expireSession).toHaveBeenCalledWith('cs_test_open123456')
    expect(docs.get(path)?.['checkoutSessionId']).toBeUndefined()
  })

  it('a refused edit leaves the session alone', async () => {
    const { quoteId } = await createdWithSession()
    await handleQuote(
      deps,
      request('admin', { action: 'update', hostId: 'site1', quoteId, baseUpdatedAtMs: 999, quote: { lines: [CANOPY] } }, 'e'),
    )
    expect(expireSession).not.toHaveBeenCalled()
  })

  it('deleting the quote expires it too', async () => {
    const { quoteId } = await createdWithSession()
    expect(await handleQuote(deps, request('admin', { action: 'delete', hostId: 'site1', quoteId }))).toEqual({
      status: 200,
      body: { deleted: true },
    })
    expect(expireSession).toHaveBeenCalledWith('cs_test_open123456')
  })
})

describe('the pay link in the console (AGL-4094)', () => {
  async function created(): Promise<{ quoteId: string; path: string }> {
    const outcome = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'c'))
    const quoteId = String(outcome.body['quoteId'])
    return { quoteId, path: `hosts/site1/orders/${quoteId}` }
  }
  const link = (uid: string, action: 'pay-link' | 'replace-link', quoteId: string) =>
    handleQuote(deps, request(uid, { action, hostId: 'site1', quoteId }))

  it('answers the link at the quote’s version, the first when it has none', async () => {
    const { quoteId } = await created()
    expect(await link('admin', 'pay-link', quoteId)).toEqual({
      status: 200,
      body: { url: `https://acme.aglyn.app/pay-quote?q=${quoteId}&t=1.sig-site1`, linkVersion: 1 },
    })
  })

  it('replacing it bumps the version, closes the open session, notes who, and leaves the edit stamp alone', async () => {
    const { quoteId, path } = await created()
    docs.set(path, { ...docs.get(path), checkoutSessionId: 'cs_test_open123456' })
    nowMs = 5_000
    const outcome = await link('editor', 'replace-link', quoteId)
    expect(outcome).toEqual({
      status: 200,
      body: { url: `https://acme.aglyn.app/pay-quote?q=${quoteId}&t=2.sig-site1`, linkVersion: 2 },
    })
    const stored = docs.get(path) as Record<string, any>
    expect(stored['quote']['linkVersion']).toBe(2)
    expect(stored['quote']['updatedAtMs']).toBe(1_000)
    expect(stored['checkoutSessionId']).toBeUndefined()
    expect(stored['timeline'].at(-1)).toMatchObject({ event: 'quote-link-replaced', atMs: 5_000 })
    expect(stored['timeline'].at(-1).detail).toContain('editor@example.com')
    expect(expireSession).toHaveBeenCalledWith('cs_test_open123456')
    expect((await link('admin', 'pay-link', quoteId)).body['linkVersion']).toBe(2)
  })

  it('never replaces a paid quote’s link', async () => {
    const { quoteId, path } = await created()
    docs.set(path, { ...docs.get(path), status: 'paid' })
    expect((await link('admin', 'replace-link', quoteId)).status).toBe(409)
    expect(docs.get(path)?.['quote']['linkVersion']).toBeUndefined()
    // Copying it still works: it opens the paid quote and the order.
    expect((await link('admin', 'pay-link', quoteId)).status).toBe(200)
  })

  it.each([
    ['author', 403],
    ['viewer', 403],
    ['editsOnly', 403],
  ])('a site %s without "Send quotes and invoices to customers" is refused both', async (uid, status) => {
    const { quoteId, path } = await created()
    for (const action of ['pay-link', 'replace-link'] as const) {
      expect(await link(uid, action, quoteId)).toEqual({
        status,
        body: { error: 'Your role does not include "Send quotes and invoices to customers" — ask an organization admin' },
      })
    }
    expect(docs.get(path)?.['quote']['linkVersion']).toBeUndefined()
  })

  it('admits the presets of "Manage orders", and a member granted the key alone', async () => {
    const { quoteId } = await created()
    for (const uid of ['admin', 'editor', 'sender']) {
      expect((await link(uid, 'pay-link', quoteId)).status).toBe(200)
    }
    // The key is its own: holding it does not let the member edit quotes.
    const edit = await handleQuote(deps, request('sender', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'x'))
    expect(edit.status).toBe(403)
  })

  it('says so when the site has no address to link to', async () => {
    const { quoteId } = await created()
    docs.set('hosts/site1', { ...docs.get('hosts/site1'), subdomain: '' })
    const outcome = await link('admin', 'pay-link', quoteId)
    expect(outcome.status).toBe(409)
    expect(String(outcome.body['error'])).toMatch(/no web address/)
  })

  it('answers no link for an order that is not a quote', async () => {
    docs.set('hosts/site1/orders/order-9', { status: 'pending', channel: 'draft', lineItems: [] })
    expect((await link('admin', 'pay-link', 'order-9')).status).toBe(404)
  })
})

describe('the quote’s PDF in the console (AGL-4095)', () => {
  async function created(): Promise<{ quoteId: string; path: string }> {
    const outcome = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, 'c'))
    const quoteId = String(outcome.body['quoteId'])
    return { quoteId, path: `hosts/site1/orders/${quoteId}` }
  }
  const pdf = (uid: string, quoteId: string) => handleQuote(deps, request(uid, { action: 'pdf', hostId: 'site1', quoteId }))

  it('answers the file, with the pay link for someone who may send it', async () => {
    const { quoteId } = await created()
    const outcome = await pdf('admin', quoteId)
    expect(outcome.status).toBe(200)
    expect(outcome.pdf?.filename).toMatch(/^quote-\d+\.pdf$/)
    expect(quotePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: 'site1',
        quoteId,
        payUrl: `https://acme.aglyn.app/pay-quote?q=${quoteId}&t=1.sig-site1`,
        store: expect.objectContaining({ tax: expect.objectContaining({ mode: 'manual' }) }),
      }),
    )
  })

  it('leaves the pay link off for someone who may edit quotes but not send them', async () => {
    const { quoteId } = await created()
    for (const uid of ['granted', 'editsOnly']) {
      quotePdf.mockClear()
      expect((await pdf(uid, quoteId)).status).toBe(200)
      expect(quotePdf.mock.calls[0][0].payUrl).toBeNull()
    }
  })

  it('prints no pay link once the quote is paid', async () => {
    const { quoteId, path } = await created()
    docs.set(path, { ...docs.get(path), status: 'paid' })
    expect((await pdf('admin', quoteId)).status).toBe(200)
    expect(quotePdf.mock.calls[0][0].payUrl).toBeNull()
  })

  it.each([
    ['author', 403],
    ['viewer', 403],
    ['stranger', 403],
  ])('a site %s without "Create and edit quotes" is refused', async (uid, status) => {
    const { quoteId } = await created()
    expect(await pdf(uid, quoteId)).toEqual({
      status,
      body: { error: 'Your role does not include "Create and edit quotes" — ask an organization admin' },
    })
    expect(quotePdf).not.toHaveBeenCalled()
  })

  it('answers no file for an order that is not a quote, or a quote that is gone', async () => {
    docs.set('hosts/site1/orders/order-9', { status: 'paid', channel: 'web', lineItems: [] })
    expect((await pdf('admin', 'order-9')).status).toBe(404)
    expect((await pdf('admin', 'missing')).status).toBe(404)
    expect((await pdf('admin', '')).status).toBe(400)
    expect(quotePdf).not.toHaveBeenCalled()
  })

  it('says the PDF could not be made when making it fails', async () => {
    const { quoteId } = await created()
    quotePdf.mockRejectedValueOnce(new Error('sharp exploded'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await pdf('admin', quoteId)).toEqual({ status: 500, body: { error: 'The PDF could not be made. Try again.' } })
    spy.mockRestore()
  })
})
