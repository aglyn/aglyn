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
import { quoteMailer, type QuoteMailerDeps } from './quote-email'
import type { QuoteUploadCalls } from './quote-uploads'

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
  return {
    doc: (id?: string) => docRef(`${path}/${id ?? `quote-${++autoId}`}`),
    // The documents directly in this collection, as a query answers them.
    get: async () => ({
      docs: [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(snapshotOf),
    }),
  }
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

/** The upload pipeline, recorded (AGL-4096). */
const uploadCalls: Array<[string, unknown]> = []
let finalizeAnswer: Awaited<ReturnType<QuoteUploadCalls['finalize']>> = {
  ok: true,
  file: { id: 'proof1', name: 'Banner.png', contentType: 'image/png', size: 2_000, path: 'hosts/site1/private/uploads/quote-proof/QID/proof1', uploadedAtMs: 1 },
}
const uploads: QuoteUploadCalls = {
  mint: async (input) => {
    uploadCalls.push(['mint', input])
    return {
      ok: true,
      ticket: 'ticket-1',
      upload: { url: 'https://storage.example/b/', fields: { key: 'k' } },
      file: { id: 'proof1', name: 'Banner.png', contentType: 'image/png', size: 2_000 },
    }
  },
  finalize: async (input) => {
    uploadCalls.push(['finalize', input])
    return finalizeAnswer
  },
  read: async () => null,
  remove: async (path) => void uploadCalls.push(['remove', path]),
  removeAll: async (scope) => void uploadCalls.push(['removeAll', scope]),
  send: async () => undefined,
}

/** The quote email (AGL-4097): the real composition and threading over a recorded send. */
const sentEmails: Array<Parameters<QuoteMailerDeps['send']>[0]> = []
const renderedTokens: Array<Record<string, string>> = []
let sendAnswer: Awaited<ReturnType<QuoteMailerDeps['send']>> = { sent: true, id: 'provider-1' }
let suppressionAnswer: Awaited<ReturnType<QuoteMailerDeps['suppression']>> = null
let mailConfigured = true
const mailerDeps: QuoteMailerDeps = {
  configured: () => mailConfigured,
  sendingIdentity: async () =>
    ({ from: 'Acme Signs <hello@mail.acme.test>', source: 'site', domain: 'mail.acme.test', summary: 'mail.acme.test', refusal: null }) as never,
  render: async (_hostId, _key, tokens) => {
    renderedTokens.push(tokens)
    return { subject: tokens['quote.subject'], html: `<p>${tokens['quote.heading']}</p>`, text: tokens['quote.heading'] }
  },
  theme: async () => null,
  quotePdf: async (input) => ({ bytes: new Uint8Array([37, 80, 68, 70]), filename: `acme-quote-${String(input.order.number)}.pdf` }),
  send: async (options) => {
    sentEmails.push(options)
    return sendAnswer
  },
  meter: async () => undefined,
  suppression: async () => suppressionAnswer,
}

/** What the forms plugin's facts reader answers for a request (AGL-4098), and who asked. */
let requestFactsAnswer: Awaited<ReturnType<QuoteDeps['requestFacts']>> = null
const requestFactsAsked: Array<Parameters<QuoteDeps['requestFacts']>[0]> = []

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
  proofLinkUrl: (_host, hostId, quoteId, version, proofId) =>
    `https://acme.aglyn.app/api/commerce/quote-proof?hostId=${hostId}&q=${quoteId}&t=${version}.sig&file=${proofId}`,
  uploads: async () => uploads,
  mailer: async () => quoteMailer(mailerDeps),
  requestFacts: async (asked) => {
    requestFactsAsked.push(asked)
    return requestFactsAnswer
  },
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
  uploadCalls.length = 0
  sentEmails.length = 0
  renderedTokens.length = 0
  sendAnswer = { sent: true, id: 'provider-1' }
  suppressionAnswer = null
  mailConfigured = true
  requestFactsAnswer = null
  requestFactsAsked.length = 0
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

describe('proofs and revisions in the console (AGL-4096)', () => {
  async function created(key = 'c'): Promise<{ quoteId: string; path: string }> {
    const outcome = await handleQuote(deps, request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM] } }, key))
    const quoteId = String(outcome.body['quoteId'])
    const path = `hosts/site1/orders/${quoteId}`
    docs.set(path, { ...docs.get(path), checkoutSessionId: 'cs_test_open123456' })
    finalizeAnswer = {
      ok: true,
      file: { id: 'proof1', name: 'Banner.png', contentType: 'image/png', size: 2_000, path: `hosts/site1/private/uploads/quote-proof/${quoteId}/proof1`, uploadedAtMs: 1 },
    }
    return { quoteId, path }
  }
  const act = (uid: string, action: string, quoteId: string, extra: Record<string, unknown> = {}) =>
    handleQuote(deps, request(uid, { action, hostId: 'site1', quoteId, ...extra }))
  const answered = (path: string) =>
    docs.set(path, {
      ...docs.get(path),
      quote: {
        ...docs.get(path)?.['quote'],
        stage: 'changes_requested',
        responses: [{ action: 'changes', revision: 1, atMs: 1_500, comment: 'Bigger', ip: null, userAgent: null }],
      },
    })

  it.each(['proof-ticket', 'proof-finalize', 'proof-remove', 'start-revision', 'revisions', 'file'])(
    '%s needs "Create and edit quotes"',
    async (action) => {
      const { quoteId, path } = await created()
      const before = JSON.stringify(docs.get(path))
      expect(await act('author', action, quoteId)).toEqual({
        status: 403,
        body: { error: 'Your role does not include "Create and edit quotes" — ask an organization admin' },
      })
      expect(JSON.stringify(docs.get(path))).toBe(before)
      expect(uploadCalls).toEqual([])
    },
  )

  it('signs a proof’s upload for the member, scoped to the quote’s proofs', async () => {
    const { quoteId } = await created()
    const file = { name: 'Banner.png', contentType: 'image/png', size: 2_000 }
    const outcome = await act('editor', 'proof-ticket', quoteId, { file })
    expect(outcome).toEqual({
      status: 200,
      body: {
        ticket: 'ticket-1',
        upload: { url: 'https://storage.example/b/', fields: { key: 'k' } },
        file: { id: 'proof1', name: 'Banner.png', contentType: 'image/png', size: 2_000 },
      },
    })
    expect(uploadCalls).toEqual([
      ['mint', { scope: { hostId: 'site1', purpose: 'quote-proof', purposeId: quoteId }, request: file, caller: { uid: 'editor' } }],
    ])
  })

  it('keeps a finalized proof on the current revision as an edit: new stamp, open session closed', async () => {
    const { quoteId, path } = await created()
    nowMs = 3_000
    const outcome = await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })
    expect(outcome).toEqual({
      status: 200,
      body: {
        proof: { id: 'proof1', revision: 1, name: 'Banner.png', contentType: 'image/png', size: 2_000, addedAtMs: 3_000, addedBy: 'admin@example.com' },
        updatedAtMs: 3_000,
      },
    })
    const stored = docs.get(path)
    expect(stored?.['quote']).toMatchObject({ updatedAtMs: 3_000, updatedBy: 'admin@example.com' })
    expect(stored?.['quote']?.proofs).toEqual([
      expect.objectContaining({ id: 'proof1', path: `hosts/site1/private/uploads/quote-proof/${quoteId}/proof1` }),
    ])
    expect(stored?.['checkoutSessionId']).toBeUndefined()
    expect(expireSession).toHaveBeenCalledWith('cs_test_open123456')
    expect(stored?.['timeline'].at(-1)).toMatchObject({ event: 'quote-proof-added' })
    // A retried finalize finds it there and adds nothing.
    expect((await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })).status).toBe(200)
    expect(docs.get(path)?.['quote']?.proofs).toHaveLength(1)
  })

  it('passes on the upload’s refusal and writes nothing', async () => {
    const { quoteId, path } = await created()
    const before = JSON.stringify(docs.get(path))
    finalizeAnswer = { ok: false, status: 415, code: 'inspection', error: '"x.png" is labeled image/png but its contents are not PNG.' }
    expect(await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })).toEqual({
      status: 415,
      body: { error: '"x.png" is labeled image/png but its contents are not PNG.' },
    })
    expect(JSON.stringify(docs.get(path))).toBe(before)
  })

  it('takes no new proof once the customer answered, and deletes the file it kept', async () => {
    const { quoteId, path } = await created()
    answered(path)
    expect((await act('admin', 'proof-ticket', quoteId, { file: {} })).status).toBe(409)
    const outcome = await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })
    expect(outcome).toEqual({
      status: 409,
      body: { error: 'The customer has answered this revision. Start a new revision to send different proofs.' },
    })
    expect(uploadCalls.at(-1)).toEqual(['remove', `hosts/site1/private/uploads/quote-proof/${quoteId}/proof1`])
  })

  it('removes a proof and its file while the revision is unanswered', async () => {
    const { quoteId, path } = await created()
    await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })
    nowMs = 4_000
    expect(await act('admin', 'proof-remove', quoteId, { proofId: 'proof1' })).toEqual({ status: 200, body: { removed: true, updatedAtMs: 4_000 } })
    expect(docs.get(path)?.['quote']?.proofs).toEqual([])
    expect(uploadCalls.at(-1)).toEqual(['remove', `hosts/site1/private/uploads/quote-proof/${quoteId}/proof1`])
    expect((await act('admin', 'proof-remove', quoteId, { proofId: 'proof1' })).status).toBe(404)
  })

  it('starts the next revision: the current one is kept whole in revisions/{n}, the new one has no proofs', async () => {
    const { quoteId, path } = await created()
    await act('admin', 'proof-finalize', quoteId, { ticket: 'ticket-1' })
    answered(path)
    expireSession.mockClear()
    docs.set(path, { ...docs.get(path), checkoutSessionId: 'cs_test_second12345' })
    nowMs = 5_000
    expect(await act('admin', 'start-revision', quoteId)).toEqual({ status: 200, body: { revision: 2, updatedAtMs: 5_000 } })
    const snapshot = docs.get(`${path}/revisions/1`)
    expect(snapshot).toMatchObject({
      revision: 1,
      stage: 'changes_requested',
      proofs: [expect.objectContaining({ id: 'proof1' })],
      responses: [expect.objectContaining({ comment: 'Bigger' })],
      closedAtMs: 5_000,
      closedBy: 'admin@example.com',
    })
    expect(snapshot?.['lineItems']).toEqual(docs.get(path)?.['lineItems'])
    expect(docs.get(path)?.['quote']).toMatchObject({ revision: 2, stage: 'draft', proofs: [], responses: [], updatedAtMs: 5_000 })
    expect(expireSession).toHaveBeenCalledWith('cs_test_second12345')

    // The history lists it, and its files are still served to members.
    const history = await act('admin', 'revisions', quoteId)
    expect(history.body['revisions']).toEqual([
      expect.objectContaining({ revision: 1, proofs: [expect.not.objectContaining({ path: expect.anything() })] }),
    ])
    expect(await act('admin', 'file', quoteId, { fileId: 'proof1', revision: 1 })).toEqual({
      status: 200,
      body: {},
      file: { path: `hosts/site1/private/uploads/quote-proof/${quoteId}/proof1`, name: 'Banner.png', contentType: 'image/png' },
    })
    // …but not as one of the current revision's.
    expect((await act('admin', 'file', quoteId, { fileId: 'proof1' })).status).toBe(404)
  })

  it('never writes over a revision on record, and starts none on a paid quote', async () => {
    const { quoteId, path } = await created()
    docs.set(`${path}/revisions/1`, { revision: 1 })
    expect((await act('admin', 'start-revision', quoteId)).status).toBe(409)
    expect(docs.get(path)?.['quote']?.revision).toBe(1)
    docs.delete(`${path}/revisions/1`)
    docs.set(path, { ...docs.get(path), status: 'paid' })
    expect(await act('admin', 'start-revision', quoteId)).toEqual({
      status: 409,
      body: { error: 'This quote has been paid, so it takes no new revision.' },
    })
  })

  it('deleting a draft takes its files with it; a quote with earlier revisions stays', async () => {
    const { quoteId } = await created()
    expect((await act('admin', 'delete', quoteId)).status).toBe(200)
    expect(uploadCalls).toEqual([
      ['removeAll', { hostId: 'site1', purpose: 'quote-proof', purposeId: quoteId }],
      ['removeAll', { hostId: 'site1', purpose: 'quote-artwork', purposeId: quoteId }],
    ])
    const second = await created('c2')
    docs.set(second.path, { ...docs.get(second.path), quote: { ...docs.get(second.path)?.['quote'], revision: 2 } })
    expect(await act('admin', 'delete', second.quoteId)).toEqual({
      status: 409,
      body: { error: 'This quote has earlier revisions the customer saw, so it stays on record.' },
    })
    expect(docs.has(second.path)).toBe(true)
  })
})

describe('sending the quote by email (AGL-4097)', () => {
  const JANE = { name: 'Jane Doe', email: 'jane@example.com' }
  async function created(customer: Record<string, unknown> = JANE): Promise<{ quoteId: string; path: string }> {
    const outcome = await handleQuote(
      deps,
      request('admin', { action: 'create', hostId: 'site1', quote: { lines: [CUSTOM], customer } }, `c-${Math.random()}`),
    )
    const quoteId = String(outcome.body['quoteId'])
    return { quoteId, path: `hosts/site1/orders/${quoteId}` }
  }
  let attempt = 0
  const send = (uid: string, quoteId: string, extra: Record<string, unknown> = {}, key = `send-${++attempt}`) =>
    handleQuote(deps, request(uid, { action: 'send', hostId: 'site1', quoteId, message: 'Here is the banner.', ...extra }, key))
  const stored = (path: string) => docs.get(path) as Record<string, any>
  const startRevision = (quoteId: string) =>
    handleQuote(deps, request('admin', { action: 'start-revision', hostId: 'site1', quoteId }))

  beforeEach(() => {
    docs.set('hosts/site1', { ...docs.get('hosts/site1'), displayName: 'Acme Signs' })
  })

  it.each([
    ['author', 403],
    ['viewer', 403],
    ['editsOnly', 403],
  ])('a site %s without "Send quotes and invoices to customers" sends nothing', async (uid, status) => {
    const { quoteId, path } = await created()
    const before = JSON.stringify(docs.get(path))
    expect(await send(uid, quoteId)).toEqual({
      status,
      body: { error: 'Your role does not include "Send quotes and invoices to customers" — ask an organization admin' },
    })
    expect(sentEmails).toEqual([])
    expect(JSON.stringify(docs.get(path))).toBe(before)
  })

  it('admits the presets of "Manage orders", and a member granted the key alone', async () => {
    const { quoteId } = await created()
    for (const uid of ['admin', 'editor', 'sender']) expect((await send(uid, quoteId)).status).toBe(200)
    expect(sentEmails).toHaveLength(3)
  })

  it('emails the customer the quote with its PDF, answering to the site, and records it', async () => {
    docs.set('hosts/site1', { ...docs.get('hosts/site1'), seo: { entity: { email: 'hello@acme.test' } } })
    const { quoteId, path } = await created()
    nowMs = 7_000
    expect(await send('admin', quoteId)).toEqual({
      status: 200,
      body: { sent: true, to: 'jane@example.com', atMs: 7_000, revision: 1, linkVersion: 1, linkReplaced: false },
    })
    expect(sentEmails).toHaveLength(1)
    const email = sentEmails[0]
    expect(email).toMatchObject({
      to: 'jane@example.com',
      subject: 'Quote #1042 from Acme Signs',
      replyTo: 'hello@acme.test',
      audience: 'tenant',
      context: 'quote',
      attachments: [{ filename: 'acme-quote-1042.pdf', contentType: 'application/pdf', content: 'JVBERg==' }],
    })
    const messageId = String(email.headers?.['Message-ID'])
    expect(messageId).toMatch(/^<quote\.[a-z0-9]+\.[0-9a-f]{16}@mail\.acme\.test>$/)
    expect(email.headers).toEqual({ 'Message-ID': messageId })
    expect(renderedTokens[0]).toMatchObject({
      'quote.message': 'Here is the banner.',
      'quote.url': `https://acme.aglyn.app/pay-quote?q=${quoteId}&t=1.sig-site1`,
    })

    const quote = stored(path)['quote']
    expect(quote['stage']).toBe('sent')
    expect(quote['sends']).toEqual([
      {
        revision: 1,
        to: 'jane@example.com',
        subject: 'Quote #1042 from Acme Signs',
        atMs: 7_000,
        by: 'admin@example.com',
        messageId,
        providerId: 'provider-1',
        linkVersion: 1,
      },
    ])
    expect(quote['emailThread']).toEqual({ messageId, references: [messageId], subject: 'Quote #1042 from Acme Signs' })
    expect(quote['updatedAtMs']).toBe(1_000)
    expect(stored(path)['timeline'].at(-1)).toMatchObject({ event: 'quote-sent', atMs: 7_000 })
  })

  it('answers to the person sending when the site has no contact email', async () => {
    const { quoteId } = await created()
    await send('editor', quoteId)
    expect(sentEmails[0].replyTo).toBe('editor@example.com')
  })

  it('threads three sends: a resend keeps the link, a new revision replaces it, each replies to the last', async () => {
    const { quoteId, path } = await created()
    await send('admin', quoteId)
    await send('admin', quoteId, { subject: 'A different subject' })
    const [first, second] = sentEmails.map((email) => String(email.headers?.['Message-ID']))
    expect(sentEmails[1].headers).toEqual({ 'Message-ID': second, 'In-Reply-To': first, References: first })
    expect(stored(path)['quote']['linkVersion']).toBeUndefined()
    expect(expireSession).not.toHaveBeenCalled()

    expect((await startRevision(quoteId)).status).toBe(200)
    docs.set(path, { ...stored(path), checkoutSessionId: 'cs_test_open123456' })
    nowMs = 9_000
    expect((await send('admin', quoteId)).body).toMatchObject({ revision: 2, linkVersion: 2, linkReplaced: true })
    const third = String(sentEmails[2].headers?.['Message-ID'])
    expect(sentEmails[2].headers).toEqual({ 'Message-ID': third, 'In-Reply-To': second, References: `${first} ${second}` })
    // The conversation keeps the subject it started with.
    expect(sentEmails[2].subject).toBe('Quote #1042 from Acme Signs')
    expect(renderedTokens[2]['quote.url']).toBe(`https://acme.aglyn.app/pay-quote?q=${quoteId}&t=2.sig-site1`)
    expect(renderedTokens[2]['quote.heading']).toBe('Your updated quote')
    expect(expireSession).toHaveBeenCalledWith('cs_test_open123456')
    const after = stored(path)
    expect(after['checkoutSessionId']).toBeUndefined()
    expect(after['quote']['linkVersion']).toBe(2)
    expect(after['quote']['emailThread']['references']).toEqual([first, second, third])
    expect(after['timeline'].map((entry: { event: string }) => entry.event)).toEqual(
      expect.arrayContaining(['quote-link-replaced', 'quote-sent']),
    )

    // Sending revision 2 again keeps its link.
    expect((await send('admin', quoteId)).body).toMatchObject({ revision: 2, linkVersion: 2, linkReplaced: false })
    expect(stored(path)['quote']['sends'].map((entry: { linkVersion: number }) => entry.linkVersion)).toEqual([1, 1, 2, 2])
  })

  it('replies into the conversation a request already started, under its subject', async () => {
    const { quoteId, path } = await created()
    const request1 = '<request.1.a@mail.acme.test>'
    docs.set(path, {
      ...stored(path),
      quote: { ...stored(path)['quote'], emailThread: { messageId: request1, references: [request1], subject: 'Your request to Acme Signs' } },
    })
    expect((await send('admin', quoteId)).body).toMatchObject({ linkVersion: 1, linkReplaced: false })
    expect(sentEmails[0].subject).toBe('Your request to Acme Signs')
    expect(sentEmails[0].headers).toMatchObject({ 'In-Reply-To': request1, References: request1 })
  })

  it('counts a link replaced by hand since the last email as the new link, and replaces it no further', async () => {
    const { quoteId, path } = await created()
    await send('admin', quoteId)
    await startRevision(quoteId)
    await handleQuote(deps, request('admin', { action: 'replace-link', hostId: 'site1', quoteId }))
    expect((await send('admin', quoteId)).body).toMatchObject({ linkVersion: 2, linkReplaced: false })
    expect(stored(path)['quote']['linkVersion']).toBe(2)
  })

  it('a send that fails replaces the link once, and its retry does not replace it again', async () => {
    const { quoteId, path } = await created()
    await send('admin', quoteId)
    await startRevision(quoteId)
    sendAnswer = { sent: false, reason: 'rejected', status: 422, detail: 'nope' }
    expect(await send('admin', quoteId)).toEqual({ status: 502, body: { error: 'The quote email could not be sent. Try again.' } })
    expect(stored(path)['quote']['linkVersion']).toBe(2)
    expect(stored(path)['quote']['sends']).toHaveLength(1)
    sendAnswer = { sent: true, id: 'provider-2' }
    expect((await send('admin', quoteId)).body).toMatchObject({ linkVersion: 2, linkReplaced: false })
    expect(stored(path)['quote']['linkVersion']).toBe(2)
  })

  it('replays a retried press instead of sending twice', async () => {
    const { quoteId } = await created()
    const first = await send('admin', quoteId, {}, 'same')
    const again = await send('admin', quoteId, {}, 'same')
    expect(again).toEqual(first)
    expect(sentEmails).toHaveLength(1)
  })

  it('leaves an answered revision where the customer put it', async () => {
    const { quoteId, path } = await created()
    docs.set(path, {
      ...stored(path),
      quote: {
        ...stored(path)['quote'],
        stage: 'approved',
        approvedRevision: 1,
        responses: [{ action: 'approve', revision: 1, atMs: 2, name: 'Jane', ip: null, userAgent: null }],
      },
    })
    await send('admin', quoteId)
    expect(stored(path)['quote']['stage']).toBe('approved')
  })

  it('sends to the address typed in the form, under the subject typed', async () => {
    const { quoteId } = await created({ name: 'No email' })
    expect((await send('admin', quoteId, { to: 'buyer@example.org', subject: 'Your banner quote' })).status).toBe(200)
    expect(sentEmails[0]).toMatchObject({ to: 'buyer@example.org', subject: 'Your banner quote' })
  })

  it('refuses, sending and writing nothing: paid, nowhere to send, a bad address, too long, no key', async () => {
    const { quoteId, path } = await created({ name: 'No email' })
    expect(await send('admin', quoteId)).toEqual({
      status: 400,
      body: { error: 'This quote has no email for the customer. Add one to the quote, or type where to send it.' },
    })
    expect((await send('admin', quoteId, { to: 'not-an-address' })).status).toBe(400)
    expect((await send('admin', quoteId, { to: 'a@b.co', message: 'x'.repeat(5_001) })).status).toBe(400)
    expect((await handleQuote(deps, request('admin', { action: 'send', hostId: 'site1', quoteId, to: 'a@b.co' }))).status).toBe(400)
    docs.set(path, { ...stored(path), status: 'paid' })
    expect((await send('admin', quoteId, { to: 'a@b.co' })).status).toBe(409)
    docs.set('hosts/site1/orders/order-9', { status: 'pending', channel: 'draft', lineItems: [] })
    expect((await send('admin', 'order-9', { to: 'a@b.co' })).status).toBe(404)
    expect(sentEmails).toEqual([])
    expect(stored(path)['quote']['sends']).toBeUndefined()
  })

  it('refuses an address that bounced or complained, in words that say why', async () => {
    const { quoteId, path } = await created()
    suppressionAnswer = 'suppressed-platform'
    const bounced = await send('admin', quoteId)
    expect(bounced.status).toBe(409)
    expect(String(bounced.body['error'])).toBe(
      'jane@example.com bounced or reported an email as spam, so it can’t be emailed. Copy the pay link and send it another way.',
    )
    expect(sentEmails).toEqual([])
    expect(stored(path)['quote']['stage']).toBe('draft')
  })

  it('sends a quote to someone who unsubscribed from the site’s newsletter: they asked for it (AGL-4098)', async () => {
    const { quoteId } = await created()
    // An unsubscribe lives on the site's own list, which a transactional send
    // never reads; the mailer asks the bounce and complaint list alone.
    docs.set('hosts/site1/suppressions/anything', { reason: 'unsubscribe' })
    const asked: string[] = []
    const spy = jest.spyOn(mailerDeps, 'suppression').mockImplementation(async (email) => {
      asked.push(email)
      return null
    })
    try {
      expect((await send('admin', quoteId)).status).toBe(200)
    } finally {
      spy.mockRestore()
    }
    expect(asked).toEqual(['jane@example.com'])
    expect(sentEmails).toHaveLength(1)
  })

  it('says so when email is not set up, or the site has no address for the pay link', async () => {
    const { quoteId } = await created()
    mailConfigured = false
    expect((await send('admin', quoteId)).status).toBe(503)
    mailConfigured = true
    docs.set('hosts/site1', { ...docs.get('hosts/site1'), subdomain: '' })
    expect(String((await send('admin', quoteId)).body['error'])).toMatch(/no web address/)
    expect(sentEmails).toEqual([])
  })
})

describe('a quote started from a request (AGL-4098)', () => {
  const THREAD = {
    messageId: '<form.k1.0123456789abcdef@mail.acme.test>',
    references: ['<form.k1.0123456789abcdef@mail.acme.test>'],
    subject: 'We got your quote request — Acme Signs',
  }
  const FACTS = {
    record: 'formSubmission',
    hostId: 'site1',
    formId: 'quote-form',
    formName: 'Request a quote',
    createdAtMs: 900,
    request: { kind: 'quote' },
    person: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0199', company: 'Acme' },
    message: 'Two canopies for the fair.',
    answers: [],
    fieldData: { product: '{"productId":"canopy","variantId":"red","options":{"Color":"Red"}}' },
    files: [
      { id: 'f1', field: 'artwork', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/form-file/sub1/f1' },
    ],
    emailThread: THREAD,
  }

  it('answers the editor’s prefill from the request, read for the member asking, with no storage path', async () => {
    requestFactsAnswer = { ok: true, facts: FACTS }
    const outcome = await handleQuote(deps, request('admin', { action: 'start-from-request', hostId: 'site1', submissionId: 'sub1' }))
    expect(outcome).toEqual({
      status: 200,
      body: {
        prefill: {
          customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0199', company: 'Acme' },
          lines: [{ kind: 'catalog', productId: 'canopy', variantId: 'red', quantity: 1 }],
          notes: 'Two canopies for the fair.',
        },
        request: { submissionId: 'sub1', formName: 'Request a quote', receivedAtMs: 900 },
        files: [{ id: 'f1', name: 'logo.ai', contentType: 'application/illustrator', size: 900 }],
        threaded: true,
      },
    })
    expect(requestFactsAsked).toEqual([
      expect.objectContaining({ orgId: 'org-1', hostId: 'site1', id: 'sub1', uid: 'admin', staff: false }),
    ])
  })

  it('is refused without "Create and edit quotes", before the request is read', async () => {
    requestFactsAnswer = { ok: true, facts: FACTS }
    const outcome = await handleQuote(deps, request('author', { action: 'start-from-request', hostId: 'site1', submissionId: 'sub1' }))
    expect(outcome.status).toBe(403)
    expect(requestFactsAsked).toEqual([])
  })

  it('passes on the reader’s refusal, and says so where no plugin reads requests', async () => {
    requestFactsAnswer = { ok: false, status: 403, error: 'You can’t read this site’s submissions.' }
    expect(await handleQuote(deps, request('admin', { action: 'start-from-request', hostId: 'site1', submissionId: 'sub1' }))).toEqual({
      status: 403,
      body: { error: 'You can’t read this site’s submissions.' },
    })
    requestFactsAnswer = null
    expect((await handleQuote(deps, request('admin', { action: 'start-from-request', hostId: 'site1', submissionId: 'sub1' }))).status).toBe(404)
  })

  it('creates the quote stamped from the request read again, never from the body, and its first email replies into the confirmation', async () => {
    requestFactsAnswer = { ok: true, facts: FACTS }
    const created = await handleQuote(
      deps,
      request(
        'admin',
        {
          action: 'create',
          hostId: 'site1',
          from: { kind: 'submission', id: 'sub1' },
          quote: {
            lines: [CANOPY],
            customer: { name: 'Jane Doe', email: 'jane@example.com' },
            notes: 'Two canopies for the fair.',
            // A body cannot name a request's parts.
            request: { submissionId: 'forged' },
            emailThread: { messageId: '<forged@evil.test>', references: [], subject: 'x' },
          },
        },
        'k-from-request',
      ),
    )
    expect(created.status).toBe(200)
    const quoteId = String(created.body['quoteId'])
    const quote = (docs.get(`hosts/site1/orders/${quoteId}`) as Record<string, any>)['quote']
    expect(quote['request']).toEqual({ submissionId: 'sub1', formName: 'Request a quote', receivedAtMs: 900 })
    expect(quote['requestFiles']).toEqual([
      { id: 'f1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: 'hosts/site1/private/uploads/form-file/sub1/f1' },
    ])
    expect(quote['emailThread']).toEqual(THREAD)

    // The request's file downloads through the quote's own route.
    expect(await handleQuote(deps, request('admin', { action: 'file', hostId: 'site1', quoteId, fileId: 'f1' }))).toEqual({
      status: 200,
      body: {},
      file: { path: 'hosts/site1/private/uploads/form-file/sub1/f1', name: 'logo.ai', contentType: 'application/illustrator' },
    })

    // The first email answers the confirmation's conversation and keeps its subject.
    const sent = await handleQuote(
      deps,
      request('admin', { action: 'send', hostId: 'site1', quoteId, message: 'Here it is.' }, 'send-from-request'),
    )
    expect(sent.status).toBe(200)
    const headers = sentEmails[sentEmails.length - 1].headers as Record<string, string>
    expect(headers['In-Reply-To']).toBe(THREAD.messageId)
    expect(headers['References']).toBe(THREAD.messageId)
    expect(sentEmails[sentEmails.length - 1].subject).toBe(THREAD.subject)
  })

  it('refuses the create when the request can no longer be read, and writes nothing', async () => {
    requestFactsAnswer = { ok: false, status: 404, error: 'That submission is no longer in the Inbox.' }
    const outcome = await handleQuote(
      deps,
      request('admin', { action: 'create', hostId: 'site1', from: { kind: 'submission', id: 'gone' }, quote: { lines: [CANOPY] } }, 'k-gone'),
    )
    expect(outcome).toEqual({ status: 404, body: { error: 'That submission is no longer in the Inbox.' } })
    expect(quoteDocs()).toEqual([])
  })

  it('a contact’s quote is an ordinary create: the customer record, nothing stamped from a request', async () => {
    const outcome = await handleQuote(
      deps,
      request(
        'admin',
        {
          action: 'create',
          hostId: 'site1',
          quote: { lines: [CUSTOM], customer: { record: { kind: 'contact', id: 'c9' }, name: 'Sam Lee', email: 'sam@example.com', phone: '555-0101', company: 'Lee & Co' } },
        },
        'k-contact',
      ),
    )
    const quote = (docs.get(`hosts/site1/orders/${String(outcome.body['quoteId'])}`) as Record<string, any>)['quote']
    expect(quote['customer']).toEqual({
      record: { kind: 'contact', id: 'c9' },
      name: 'Sam Lee',
      company: 'Lee & Co',
      email: 'sam@example.com',
      emailLower: 'sam@example.com',
      phone: '555-0101',
    })
    expect(quote).not.toHaveProperty('request')
    expect(requestFactsAsked).toEqual([])
  })
})
