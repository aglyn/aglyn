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
 * The ShippingEasy connector (AGL-3633), driven through its real server
 * functions against an in-memory Firestore and a stand-in for ShippingEasy's
 * API that checks every request's signature the way ShippingEasy does.
 *
 * What it proves, each against the WRITE as well as the answer:
 *
 * - PUSH: a paid order is created once with what is left to ship; a second
 *   push, a concurrent push and a refused duplicate are each one order there;
 *   a test-mode order and an order with nothing to ship are never sent.
 * - FAILURES: a 5xx throws for the outbox to retry and the retry sends; bad
 *   keys and a refused order are recorded on the card, not retried forever;
 *   the outbox's last attempt tells the site's managers.
 * - CANCEL: a canceled order that was sent is canceled there; one never sent
 *   asks nothing.
 * - CALLBACK: only a request signed with the site's own secret is read; a
 *   shipment is recorded once with its items and the buyer emailed once; a
 *   pending or voided label records nothing.
 * - CARD: connect proves the keys first and stores the secret sealed;
 *   disconnect deletes the keys and the order records with them.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore that answers queries
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

type Filter = { field: string; op: string; value: any }

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
}

function snapshot(path: string): any {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => (data ? JSON.parse(JSON.stringify(data)) : undefined),
    get: (field: string) => data?.[field],
    ref: docRef(path),
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    firestore: fakeFirestore,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, JSON.parse(JSON.stringify(options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)))
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) throw Object.assign(new Error(`NOT_FOUND ${path}`), { code: 5 })
      docs.set(path, JSON.parse(JSON.stringify({ ...docs.get(path), ...value })))
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS ${path}`), { code: 6 })
      docs.set(path, JSON.parse(JSON.stringify(value)))
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => query(`${path}/${name}`),
  }
}

function query(path: string, filters: Filter[] = [], orders: Array<[string, 'asc' | 'desc']> = [], limitTo?: number): any {
  const run = () => {
    let keys = childPaths(path).filter((key) =>
      filters.every(({ field, op, value }) => {
        const actual = docs.get(key)?.[field]
        if (op === '==') return actual === value
        if (op === '>=') return actual !== undefined && actual >= value
        throw new Error(`op ${op}`)
      }),
    )
    keys = keys.sort((a, b) => {
      for (const [field, direction] of orders) {
        const x = docs.get(a)?.[field]
        const y = docs.get(b)?.[field]
        if (x === y) continue
        return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1)
      }
      return 0
    })
    return limitTo === undefined ? keys : keys.slice(0, limitTo)
  }
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: any) => query(path, [...filters, { field, op, value }], orders, limitTo),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => query(path, filters, [...orders, [field, direction]], limitTo),
    limit: (count: number) => query(path, filters, orders, count),
    get: async () => {
      const list = run().map(snapshot)
      return { docs: list, size: list.length, empty: list.length === 0 }
    },
  }
}

let transactionQueue: Promise<unknown> = Promise.resolve()

const fakeFirestore: any = {
  collection: (name: string) => query(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
  recursiveDelete: async (ref: any) => {
    for (const key of [...docs.keys()]) if (key === ref.path || key.startsWith(`${ref.path}/`)) docs.delete(key)
  },
  runTransaction: <T>(fn: (transaction: any) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(async () => {
      const queued: Array<[string, any, any, any?]> = []
      const result = await fn({
        get: (ref: any) => ref.get(),
        update: (ref: any, value: any) => queued.push(['update', ref, value]),
        create: (ref: any, value: any) => queued.push(['create', ref, value]),
        set: (ref: any, value: any, options?: any) => queued.push(['set', ref, value, options]),
      })
      for (const [op, ref, value, options] of queued) {
        if (op === 'update') await ref.update(value)
        else if (op === 'create') await ref.create(value)
        else await ref.set(value, options)
      }
      return result
    })
    transactionQueue = run.catch(() => undefined)
    return run
  },
}

// ---------------------------------------------------------------------------
// Module doubles
// ---------------------------------------------------------------------------

const mockRate = jest.fn(async (_key: string, _options: unknown) => ({ allowed: true, resetMs: Date.now() + 60_000 }))
const mockDisabled = jest.fn(async (_hostId: string): Promise<string[]> => [])
const mockNotify = jest.fn(async (..._args: unknown[]) => undefined)
const mockManagers = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@aglyn/tenant-data-admin', () => ({
  consumeRateLimit: (key: string, options: unknown) => mockRate(key, options),
  firebaseAdmin: Object.assign(
    { app: () => ({ firestore: () => fakeFirestore }) },
    { firestore: { FieldPath: { documentId: () => '__name__' } } },
  ),
  getHostDisabledPlugins: (hostId: string) => mockDisabled(hostId),
  getHostDocAdmin: async (hostId: string) => (docs.has(`hosts/${hostId}`) ? docs.get(`hosts/${hostId}`) : null),
  getOrgForHost: async () => ({ orgId: 'org-1', org: { id: 'org-1', plan: 'pro', enabledPlugins: ['commerce'] } }),
  getServerReleaseFlagValues: async () => ({ release_commerce_v2: true }),
  lockdownRefusal: async () => null,
  notifyHostManagers: (...args: unknown[]) => mockManagers(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => true,
  resolveHostEnabledPlugins: (_org: unknown, host: { disabledPlugins?: string[] }) =>
    ['commerce'].filter((id) => !(host?.disabledPlugins ?? []).includes(id)),
  isReleaseFlagOnForOrg: () => true,
  parseOrgReleaseFlagOverrides: () => ({}),
  resolveEffectivePlan: () => 'pro',
}))

jest.mock('./order-notifications', () => ({
  notifyOrderBuyer: (...args: unknown[]) => mockNotify(...args),
}))

import { createHmac } from 'crypto'
import { PLUGIN_EVENT_MAX_ATTEMPTS } from '@aglyn/tenant-data-admin/server/plugin-event-outbox'
import { shippingEasySignaturePlaintext } from '../model/shippingeasy'
import { readCommerceSecretKeyring } from './order-webhooks'
import {
  deliverOrderEventToShippingEasy,
  pushShippingEasyOrder,
  sealShippingEasySecret,
  SHIPPINGEASY_CONNECTIONS,
  shippingEasyConnectorAction,
  shippingEasyRoute,
  ShippingEasyUnavailableError,
  syncShippingEasyOrders,
  verifyShippingEasyCallback,
} from './shippingeasy'

process.env['TOKEN_SIGNING_SECRET'] = 'test-token-signing-secret'
delete process.env['COMMERCE_SECRET_KEY']

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const API_KEY = 'f9a7c8b6d5e4f3a2b1c0d9e8f7a6b5c4'
const API_SECRET = '0123456789abcdef0123456789abcdef'
const STORE_KEY = 'c71dc6da574eea04e2c926906bcb4eec'
const NOW = Date.UTC(2026, 9, 7, 12, 0)
const ADDRESS = { name: 'Ada Q Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'us' }

const sign = (plaintext: string, secret = API_SECRET) => createHmac('sha256', secret).update(plaintext).digest('hex')

function seedOrder(id: string, overrides: Record<string, any> = {}): void {
  docs.set(`hosts/${HOST}/orders/${id}`, {
    number: 1000 + Number(id.replace(/\D/g, '') || 0),
    status: 'paid',
    channel: 'online',
    livemode: true,
    requiresShipping: true,
    createdAtMs: NOW - 60_000,
    updatedAtMs: NOW - 60_000,
    customerEmail: 'ada@example.com',
    customerName: 'Ada Q Buyer',
    shippingAddress: ADDRESS,
    totals: { itemsCents: 4200, shippingCents: 500, taxCents: 300, discountCents: 0, totalCents: 5000, feeCents: 0 },
    lineItems: [
      { productId: 'prod-tee', variantId: 'var-m', name: 'Tee', variantLabel: 'M', sku: 'TEE-M', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
      { productId: 'prod-mug', name: 'Mug', sku: 'MUG', quantity: 1, unitAmountCents: 1200, productType: 'physical' },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...overrides,
  })
}

function connect(): void {
  docs.set(`${SHIPPINGEASY_CONNECTIONS}/${HOST}`, {
    hostId: HOST,
    apiKey: API_KEY,
    storeApiKey: STORE_KEY,
    ...sealShippingEasySecret(HOST, API_SECRET, readCommerceSecretKeyring()!),
    createdAtMs: 1,
    createdBy: 'admin-1',
  })
}

const orderOf = (id: string) => docs.get(`hosts/${HOST}/orders/${id}`) as Record<string, any>
const recordOf = (id: string) => docs.get(`${SHIPPINGEASY_CONNECTIONS}/${HOST}/orders/${id}`) as Record<string, any> | undefined
const connectionOf = () => docs.get(`${SHIPPINGEASY_CONNECTIONS}/${HOST}`) as Record<string, any> | undefined

// ---------------------------------------------------------------------------
// A stand-in for ShippingEasy: checks the signature, then answers what a test set
// ---------------------------------------------------------------------------

interface Call {
  method: string
  path: string
  params: Record<string, string>
  body: string
}

const calls: Call[] = []
/** The secret the stand-in holds the account to. */
let accountSecret = API_SECRET
let answer: (call: Call) => { status: number; body?: unknown } = () => ({ status: 201, body: { order: {} } })

const fakeFetch = jest.fn(async (input: string, init: RequestInit = {}) => {
  const url = new URL(input)
  const params = Object.fromEntries(url.searchParams.entries())
  const body = typeof init.body === 'string' ? init.body : ''
  const method = String(init.method ?? 'GET')
  const { api_signature: signature, ...signed } = params
  // ShippingEasy's own check, from the Ruby client's Signature class.
  if (signature !== sign(shippingEasySignaturePlaintext({ method, path: url.pathname, params: signed, body }), accountSecret)) {
    return new Response(JSON.stringify({ errors: ['bad signature'] }), { status: 401 })
  }
  const call = { method, path: url.pathname, params, body }
  calls.push(call)
  const reply = answer(call)
  return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status })
}) as unknown as typeof fetch

const deps = { fetchImpl: fakeFetch, now: () => NOW, env: {} }

beforeEach(() => {
  docs.clear()
  calls.length = 0
  accountSecret = API_SECRET
  answer = () => ({ status: 201, body: { order: {} } })
  mockNotify.mockClear()
  mockManagers.mockClear()
  mockRate.mockClear()
  mockDisabled.mockReset()
  mockDisabled.mockResolvedValue([])
  docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'admin' } })
  docs.set(`hosts/${HOST}/products/prod-tee`, {
    name: 'Tee',
    variants: [{ id: 'var-m', weightGrams: 200, options: { Size: 'M' } }],
  })
  connect()
})

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

describe('sending an order', () => {
  it('creates a paid order once, signed, with what is left to ship', async () => {
    seedOrder('o1', { fulfillments: [{ id: 'f0', lines: [{ lineItemId: 0, quantity: 1 }], lineItemIds: [0], atMs: 2 }] })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'sent' })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.method).toBe('POST')
    expect(call.path).toBe(`/api/stores/${STORE_KEY}/orders`)
    expect(call.params['api_key']).toBe(API_KEY)
    expect(call.params['api_timestamp']).toBe(String(Math.floor(NOW / 1000)))
    const order = JSON.parse(call.body).order
    expect(order).toMatchObject({
      external_order_identifier: '1001',
      order_status: 'awaiting_shipment',
      total_including_tax: '50.00',
      base_shipping_cost: '5.00',
      billing_email: 'ada@example.com',
    })
    expect(order.recipients[0]).toMatchObject({
      first_name: 'Ada Q',
      last_name: 'Buyer',
      address: '1 Main St',
      postal_code: '78701',
      country: 'US',
    })
    expect(order.recipients[0].line_items).toEqual([
      expect.objectContaining({ sku: 'TEE-M', quantity: '2', ext_line_item_id: '0', unit_price: '10.00', weight_in_ounces: '7.05' }),
      expect.objectContaining({ sku: 'MUG', quantity: '1', ext_line_item_id: '1' }),
    ])
    expect(recordOf('o1')).toMatchObject({ state: 'sent', externalId: '1001', sentAtMs: NOW })
    expect(connectionOf()?.lastPushAtMs).toBe(NOW)

    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'already' })
    expect(calls).toHaveLength(1)
  })

  it('never sends a test-mode order, an order with nothing to ship, or one without a full address', async () => {
    seedOrder('o1', { livemode: false })
    seedOrder('o2', { requiresShipping: false })
    seedOrder('o3', { shippingAddress: { ...ADDRESS, postalCode: '' } })
    seedOrder('o4', { status: 'pending' })
    for (const id of ['o1', 'o2', 'o3', 'o4']) expect(await pushShippingEasyOrder(HOST, id, deps)).toEqual({ result: 'skipped' })
    expect(calls).toHaveLength(0)
  })

  it('asks nothing of a site that never connected', async () => {
    docs.delete(`${SHIPPINGEASY_CONNECTIONS}/${HOST}`)
    seedOrder('o1')
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'not_connected' })
    expect(calls).toHaveLength(0)
  })

  it('sends nothing for a site whose commerce is switched off', async () => {
    mockDisabled.mockResolvedValue(['commerce'])
    seedOrder('o1')
    const outcome = await pushShippingEasyOrder(HOST, 'o1', deps)
    expect(outcome.result).toBe('refused')
    expect(calls).toHaveLength(0)
    expect(recordOf('o1')).toBeUndefined()
  })

  it('records a refused duplicate as sent when ShippingEasy already holds the order', async () => {
    seedOrder('o1')
    answer = (call) =>
      call.method === 'POST' ? { status: 422, body: { errors: ['External order identifier has already been taken'] } } : { status: 200, body: { order: {} } }
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'sent' })
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /api/stores/${STORE_KEY}/orders`,
      `GET /api/stores/${STORE_KEY}/orders/1001`,
    ])
    expect(recordOf('o1')?.state).toBe('sent')
  })

  it('records a refused order on the card, and sends it once fixed', async () => {
    seedOrder('o1')
    answer = (call) => (call.method === 'POST' ? { status: 422, body: { errors: ['Postal code is invalid'] } } : { status: 404 })
    const refused = await pushShippingEasyOrder(HOST, 'o1', deps)
    expect(refused).toMatchObject({ result: 'failed', message: expect.stringMatching(/Postal code is invalid/) })
    expect(recordOf('o1')?.state).toBe('failed')
    expect(connectionOf()?.lastError).toMatchObject({ orderNumber: '1001', message: expect.stringMatching(/Postal code/) })

    answer = () => ({ status: 201, body: {} })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'sent' })
    expect(connectionOf()?.lastError).toBeNull()
  })

  it('says the keys are wrong when ShippingEasy refuses them, without looking the order up', async () => {
    seedOrder('o1')
    answer = () => ({ status: 401, body: { errors: ['Access denied'] } })
    const outcome = await pushShippingEasyOrder(HOST, 'o1', deps)
    expect(outcome).toMatchObject({ result: 'failed', message: expect.stringMatching(/refused the API key/) })
    expect(calls).toHaveLength(1)
  })

  it('throws a 5xx for the outbox to retry, and the retry sends', async () => {
    seedOrder('o1')
    answer = () => ({ status: 503 })
    await expect(pushShippingEasyOrder(HOST, 'o1', deps)).rejects.toBeInstanceOf(ShippingEasyUnavailableError)
    answer = () => ({ status: 201, body: {} })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'sent' })
  })

  it('a push while another is in flight waits for a retry; a lapsed claim looks before creating again', async () => {
    seedOrder('o1')
    docs.set(`${SHIPPINGEASY_CONNECTIONS}/${HOST}/orders/o1`, { orderId: 'o1', externalId: '1001', state: 'sending', claimedAtMs: NOW - 1000, updatedAtMs: NOW - 1000 })
    await expect(pushShippingEasyOrder(HOST, 'o1', deps)).rejects.toThrow(/being sent/)
    expect(calls).toHaveLength(0)

    docs.set(`${SHIPPINGEASY_CONNECTIONS}/${HOST}/orders/o1`, { orderId: 'o1', externalId: '1001', state: 'sending', claimedAtMs: NOW - 10 * 60_000, updatedAtMs: 1 })
    answer = (call) => (call.method === 'GET' ? { status: 200, body: { order: {} } } : { status: 201 })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'sent' })
    // Found by the look-up: no second create.
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })

  it('two pushes at once send the order once', async () => {
    seedOrder('o1')
    const results = await Promise.allSettled([pushShippingEasyOrder(HOST, 'o1', deps), pushShippingEasyOrder(HOST, 'o1', deps)])
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'fulfilled' && result.value.result === 'sent')).toHaveLength(1)
  })
})

describe('canceling an order', () => {
  it('cancels a sent order that was canceled here, once', async () => {
    seedOrder('o1')
    await pushShippingEasyOrder(HOST, 'o1', deps)
    orderOf('o1').status = 'cancelled'
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'canceled' })
    expect(calls[1]).toMatchObject({ method: 'POST', path: `/api/stores/${STORE_KEY}/orders/1001/cancellations` })
    expect(recordOf('o1')?.state).toBe('canceled')
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'already' })
    expect(calls).toHaveLength(2)
  })

  it('asks nothing for a refunded order that was never sent', async () => {
    seedOrder('o1', { status: 'refunded' })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toEqual({ result: 'skipped' })
    expect(calls).toHaveLength(0)
  })

  it('records a refused cancel for the merchant to finish by hand', async () => {
    seedOrder('o1')
    await pushShippingEasyOrder(HOST, 'o1', deps)
    orderOf('o1').status = 'cancelled'
    answer = () => ({ status: 422, body: { errors: ['Order already shipped'] } })
    expect(await pushShippingEasyOrder(HOST, 'o1', deps)).toMatchObject({ result: 'failed' })
    expect(recordOf('o1')?.state).toBe('cancel_failed')
    expect(connectionOf()?.lastError?.message).toMatch(/could not be canceled/)
  })
})

describe('the order events subscriber', () => {
  const envelope = (attempt: number) => ({ hostId: HOST, event: 'order.paid', attempt, payload: { order: { id: 'o1' } } })

  it('throws a passing failure for the outbox, and tells the managers on its last attempt', async () => {
    seedOrder('o1')
    answer = () => ({ status: 502 })
    await expect(deliverOrderEventToShippingEasy(envelope(1), deps)).rejects.toBeInstanceOf(ShippingEasyUnavailableError)
    expect(mockManagers).not.toHaveBeenCalled()
    // The last attempt: a lapsed claim, so the record is free again.
    docs.delete(`${SHIPPINGEASY_CONNECTIONS}/${HOST}/orders/o1`)
    const last = await deliverOrderEventToShippingEasy(envelope(PLUGIN_EVENT_MAX_ATTEMPTS), deps)
    expect(last).toMatchObject({ result: 'failed' })
    expect(mockManagers).toHaveBeenCalledTimes(1)
    expect(connectionOf()?.lastError?.message).toMatch(/Send open orders/)
  })

  it('ignores an event that names no order', async () => {
    expect(await deliverOrderEventToShippingEasy({ hostId: HOST, event: 'order.paid', attempt: 1, payload: {} }, deps)).toBeNull()
  })
})

describe('send open orders', () => {
  it('sends the open orders, skips the ones already there and the ones not to send', async () => {
    seedOrder('o1')
    seedOrder('o2')
    seedOrder('o3', { livemode: false })
    seedOrder('o4', { status: 'fulfilled' })
    seedOrder('o5', { updatedAtMs: NOW - 200 * 86_400_000 })
    await pushShippingEasyOrder(HOST, 'o1', deps)
    const result = await syncShippingEasyOrders(HOST, deps)
    expect(result).toEqual({ sent: 1, already: 1, failed: 0, more: false })
    expect(calls.filter((call) => call.method === 'POST').map((call) => JSON.parse(call.body).order.external_order_identifier)).toEqual([
      '1001',
      '1002',
    ])
  })

  it('stops at the first refusal of the keys', async () => {
    seedOrder('o1')
    seedOrder('o2')
    answer = () => ({ status: 401 })
    expect(await syncShippingEasyOrders(HOST, deps)).toMatchObject({ sent: 0, failed: 1 })
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// The callback
// ---------------------------------------------------------------------------

const PATH = `/api/commerce/shippingeasy/${HOST}`

function shipment(overrides: Record<string, any> = {}, items: Array<Record<string, any>> = [{ ext_line_item_id: '0', sku: 'TEE-M', quantity: 3 }, { ext_line_item_id: '1', sku: 'MUG', quantity: 1 }]) {
  return JSON.stringify({
    shipment: {
      id: 58,
      tracking_number: '794675663409',
      carrier_key: 'FEDEX',
      carrier_service_key: 'FEDEX_GROUND',
      workflow_state: 'label_ready',
      orders: [{ id: 119, external_order_identifier: '1001', recipients: [{ line_items: items }] }],
      ...overrides,
    },
  })
}

function callback(body: string, options: { secret?: string; params?: Record<string, string>; path?: string } = {}): Request {
  const params = { api_timestamp: String(Math.floor(NOW / 1000)), ...(options.params ?? {}) }
  const signature = sign(shippingEasySignaturePlaintext({ method: 'POST', path: options.path ?? PATH, params, body }), options.secret)
  const search = new URLSearchParams({ ...params, api_signature: signature })
  return new Request(`https://app.aglyn.test${PATH}?${search}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
}

const route = (request: Request, hostId = HOST) => shippingEasyRoute(request, { params: { hostId } }, deps)

describe('the shipment callback', () => {
  it('records a signed shipment once, with its items, and emails the buyer once', async () => {
    seedOrder('o1')
    const response = await route(callback(shipment()))
    expect(response.status).toBe(200)
    const order = orderOf('o1')
    expect(order.status).toBe('fulfilled')
    expect(order.fulfillments).toHaveLength(1)
    expect(order.fulfillments[0]).toMatchObject({ trackingNumber: '794675663409', carrier: 'FedEx' })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(connectionOf()?.lastCallbackAtMs).toBe(NOW)

    const again = await route(callback(shipment()))
    expect(again.status).toBe(200)
    expect(orderOf('o1').fulfillments).toHaveLength(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('ships only the items it names, leaving the order partly fulfilled', async () => {
    seedOrder('o1')
    await route(callback(shipment({}, [{ ext_line_item_id: '0', sku: 'TEE-M', quantity: 2 }])))
    const order = orderOf('o1')
    expect(order.status).toBe('partially_fulfilled')
    expect(order.fulfillments[0].lines).toEqual([{ lineItemId: 0, quantity: 2 }])
  })

  it('records nothing for a label not bought yet or voided', async () => {
    seedOrder('o1')
    for (const state of ['label_pending', 'cancelled']) {
      const response = await route(callback(shipment({ workflow_state: state })))
      expect(response.status).toBe(200)
    }
    expect(orderOf('o1').fulfillments ?? []).toHaveLength(0)
  })

  it('refuses a request signed with another secret, an unsigned one and an old one, and writes nothing', async () => {
    seedOrder('o1')
    expect((await route(callback(shipment(), { secret: 'another-secret-0000000000000000' }))).status).toBe(401)
    const unsigned = new Request(`https://app.aglyn.test${PATH}`, { method: 'POST', body: shipment() })
    expect((await route(unsigned)).status).toBe(401)
    const old = callback(shipment(), { params: { api_timestamp: String(Math.floor(NOW / 1000) - 2 * 3600) } })
    expect((await route(old)).status).toBe(401)
    expect(orderOf('o1').fulfillments ?? []).toHaveLength(0)
    expect(connectionOf()?.lastCallbackAtMs).toBeUndefined()
  })

  it('answers a site that never connected exactly like a wrong signature', async () => {
    docs.delete(`${SHIPPINGEASY_CONNECTIONS}/${HOST}`)
    const response = await route(callback(shipment()))
    expect(response.status).toBe(401)
  })

  it('refuses a site whose commerce is switched off, after the signature proves it', async () => {
    mockDisabled.mockResolvedValue(['commerce'])
    seedOrder('o1')
    const response = await route(callback(shipment()))
    expect(response.status).toBe(403)
    expect(orderOf('o1').fulfillments ?? []).toHaveLength(0)
  })

  it('answers an order this site does not have with 200, and says so on the card', async () => {
    const response = await route(callback(shipment()))
    expect(response.status).toBe(200)
    expect(await response.text()).toMatch(/no order 1001/)
    expect(connectionOf()?.lastError?.message).toMatch(/no order 1001/)
  })

  it('refuses GET, a malformed site id and plain HTTP in production', async () => {
    expect((await route(new Request(`https://app.aglyn.test${PATH}`))).status).toBe(405)
    expect((await route(callback(shipment()), 'a/b')).status).toBe(404)
    const insecure = await shippingEasyRoute(
      new Request(`http://app.aglyn.test${PATH}`, { method: 'POST', body: '{}', headers: { 'x-forwarded-proto': 'http' } }),
      { params: { hostId: HOST } },
      { ...deps, env: { NODE_ENV: 'production' } },
    )
    expect(insecure.status).toBe(403)
  })

  it('answers 429 with Retry-After when the site’s budget is spent', async () => {
    mockRate.mockImplementationOnce(async () => ({ allowed: false, resetMs: Date.now() + 30_000 }))
    const response = await route(callback(shipment()))
    expect(response.status).toBe(429)
    expect(String(mockRate.mock.calls[0][0])).toMatch(new RegExp(`^shippingeasy:${HOST}:`))
  })
})

describe('verifying a signature', () => {
  it('reads the query in any order and without api_signature, as the Ruby client signs it', () => {
    const body = '{"shipment":{"id":"1234"}}'
    const plaintext = `POST&/callback&api_key=${API_KEY}&api_timestamp=${Math.floor(NOW / 1000)}&${body}`
    const query = new URLSearchParams({ api_timestamp: String(Math.floor(NOW / 1000)), api_signature: sign(plaintext), api_key: API_KEY })
    expect(verifyShippingEasyCallback({ apiSecret: API_SECRET, method: 'post', path: '/callback', query, body, nowMs: NOW })).toBe('ok')
    expect(verifyShippingEasyCallback({ apiSecret: API_SECRET, method: 'post', path: '/callback', query, body: `${body} `, nowMs: NOW })).toBe('bad_signature')
  })
})

// ---------------------------------------------------------------------------
// The card's actions
// ---------------------------------------------------------------------------

describe('the card', () => {
  const log = jest.fn(async () => undefined)
  const act = (action: 'status' | 'connect' | 'sync' | 'disconnect', body: Record<string, unknown> = {}) =>
    shippingEasyConnectorAction({ hostId: HOST, action, body, actor: { uid: 'admin-1', email: null }, log }, deps)

  beforeEach(() => {
    docs.delete(`${SHIPPINGEASY_CONNECTIONS}/${HOST}`)
    log.mockClear()
  })

  it('proves the keys before saving them, and keeps the secret sealed', async () => {
    answer = () => ({ status: 200, body: { orders: [] } })
    const connected = await act('connect', { apiKey: API_KEY, apiSecret: API_SECRET, storeApiKey: STORE_KEY })
    expect(connected.status).toBe(200)
    expect(connected.body).toMatchObject({ connected: true, apiKeyEnding: 'b5c4', storeApiKeyEnding: '4eec' })
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/api/stores/${STORE_KEY}/orders` })
    const stored = connectionOf()!
    expect(JSON.stringify(stored)).not.toContain(API_SECRET)
    expect(stored.sealedApiSecret).toMatch(/^sb1\./)
    expect(JSON.stringify(connected.body)).not.toContain(API_SECRET)
    expect(log).toHaveBeenCalledWith('Connected ShippingEasy', expect.anything())
  })

  it('saves nothing when ShippingEasy refuses the keys, or cannot be reached', async () => {
    answer = () => ({ status: 401, body: { errors: ['Access denied'] } })
    const refused = await act('connect', { apiKey: API_KEY, apiSecret: API_SECRET, storeApiKey: STORE_KEY })
    expect(refused.status).toBe(422)
    expect(connectionOf()).toBeUndefined()
    answer = () => ({ status: 503 })
    expect((await act('connect', { apiKey: API_KEY, apiSecret: API_SECRET, storeApiKey: STORE_KEY })).status).toBe(502)
    expect(connectionOf()).toBeUndefined()
    expect((await act('connect', { apiKey: 'x', apiSecret: API_SECRET, storeApiKey: STORE_KEY })).status).toBe(400)
  })

  it('replaces the keys of a connected site, and keeps when it was first connected', async () => {
    connect()
    answer = () => ({ status: 200, body: {} })
    accountSecret = 'fedcba9876543210fedcba9876543210'
    const replaced = await act('connect', { apiKey: API_KEY, apiSecret: accountSecret, storeApiKey: STORE_KEY })
    expect(replaced.status).toBe(200)
    expect(connectionOf()).toMatchObject({ createdAtMs: 1, updatedAtMs: NOW })
    expect(log).toHaveBeenCalledWith('Replaced the ShippingEasy keys', expect.anything())
  })

  it('disconnects, deleting the keys and the order records with them', async () => {
    connect()
    seedOrder('o1')
    await pushShippingEasyOrder(HOST, 'o1', deps)
    expect(recordOf('o1')).toBeDefined()
    expect((await act('disconnect')).body).toMatchObject({ connected: false })
    expect(connectionOf()).toBeUndefined()
    expect(recordOf('o1')).toBeUndefined()
  })

  it('reports the status without a key in full', async () => {
    connect()
    const status = await act('status')
    expect(status.body).toMatchObject({ available: true, connected: true, apiKeyEnding: 'b5c4' })
    expect(JSON.stringify(status.body)).not.toContain(API_KEY)
  })

  it('sends open orders on request', async () => {
    connect()
    seedOrder('o1')
    const synced = await act('sync')
    expect(synced.body['sync']).toEqual({ sent: 1, already: 0, failed: 0, more: false })
  })
})
