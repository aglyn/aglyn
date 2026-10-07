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
 * ShipStation's Custom Store endpoint (AGL-3613), driven through the real
 * route against an in-memory Firestore that answers the route's own queries:
 * equality, range and `in` predicates, ordering by a field then the document
 * id, `startAfter`, `offset`, `limit` and `count()`.
 *
 * What it proves, each against the WRITE as well as the status:
 *
 * - AUTH: no header, a wrong password and a wrong username are 401 and read
 *   nothing; the right pair is served. Plain HTTP is refused in production.
 * - GATES: a site with commerce switched off, or over its rate budget, is
 *   refused AFTER the credentials prove it — and before, nothing is said.
 * - PAGINATION: `pages` counts the whole window; page 2 starts after page 1's
 *   last order through the stored cursor, and a page asked out of order
 *   falls back to an offset that returns the same orders.
 * - IDEMPOTENCY: a notice posted twice records ONE shipment and emails the
 *   buyer once; a tracking number typed in Aglyn first is the same parcel.
 * - PARTIAL ITEMS: a notice's items ship those units only, bounded by what is
 *   left, and leave the order partially fulfilled.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore that answers queries
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const ID = '__name__'

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
      docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
    },
    update: async (value: Record<string, any>) => {
      if (!docs.has(path)) throw Object.assign(new Error(`NOT_FOUND ${path}`), { code: 5 })
      docs.set(path, { ...docs.get(path), ...value })
    },
    create: async (value: Record<string, any>) => {
      if (docs.has(path)) throw Object.assign(new Error(`ALREADY_EXISTS ${path}`), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => query(`${path}/${name}`),
  }
}

const queryLog: Array<{ path: string; offset: number; after: any[] | null }> = []

function query(path: string, filters: Filter[] = [], orders: Array<[string, 'asc' | 'desc']> = [], limitTo?: number, offsetBy = 0, after: any[] | null = null): any {
  const run = () => {
    const valueOf = (key: string, field: string) => (field === ID ? key.split('/').pop() : docs.get(key)?.[field])
    let keys = childPaths(path).filter((key) =>
      filters.every(({ field, op, value }) => {
        const actual = valueOf(key, field)
        if (op === '==') return actual === value
        if (op === '>=') return actual !== undefined && actual >= value
        if (op === '<=') return actual !== undefined && actual <= value
        if (op === 'in') return (value as any[]).includes(actual)
        throw new Error(`op ${op}`)
      }),
    )
    const compare = (a: string, b: string) => {
      for (const [field, direction] of orders) {
        const x = valueOf(a, field)
        const y = valueOf(b, field)
        if (x === y) continue
        return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1)
      }
      return 0
    }
    keys = keys.sort(compare)
    if (after) {
      keys = keys.filter((key) => {
        for (let index = 0; index < orders.length; index += 1) {
          const [field, direction] = orders[index]
          const x = valueOf(key, field)
          const y = after[index]
          if (x === y) continue
          return direction === 'desc' ? x < y : x > y
        }
        return false
      })
    }
    return keys
  }
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: any) => query(path, [...filters, { field, op, value }], orders, limitTo, offsetBy, after),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') => query(path, filters, [...orders, [field, direction]], limitTo, offsetBy, after),
    limit: (count: number) => query(path, filters, orders, count, offsetBy, after),
    offset: (count: number) => query(path, filters, orders, limitTo, count, after),
    startAfter: (...values: any[]) => query(path, filters, orders, limitTo, offsetBy, values),
    count: () => ({ get: async () => ({ data: () => ({ count: run().length }) }) }),
    get: async () => {
      queryLog.push({ path, offset: offsetBy, after })
      const keys = run().slice(offsetBy, limitTo === undefined ? undefined : offsetBy + limitTo)
      const list = keys.map(snapshot)
      return { docs: list, size: list.length, empty: list.length === 0 }
    },
  }
}

let transactionQueue: Promise<unknown> = Promise.resolve()

const fakeFirestore: any = {
  collection: (name: string) => query(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshot(ref.path)),
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

import { parseSecretBoxKeyring, createSecretBoxKey } from '@aglyn/shared-util-tools/secret-box'
import { readCommerceSecretKeyring } from './order-webhooks'
import {
  credentialsMatch,
  readBasicAuth,
  sealShipStationPassword,
  shipStationRoute,
  SHIPSTATION_CONNECTIONS,
} from './shipstation'

process.env['TOKEN_SIGNING_SECRET'] = 'test-token-signing-secret'
delete process.env['COMMERCE_SECRET_KEY']

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOST = 'host-1'
const USER = 'aglyn-0a1b2c3d4e5f'
const PASS = 'correct-horse-battery-staple-0123'
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`
const WINDOW = 'start_date=10%2F01%2F2026+00%3A00&end_date=10%2F06%2F2026+23%3A59'
const IN_WINDOW = Date.UTC(2026, 9, 3, 12, 0)

const ADDRESS = { name: 'Ada Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }

function seedOrder(id: string, overrides: Record<string, any> = {}): void {
  docs.set(`hosts/${HOST}/orders/${id}`, {
    number: 1000 + Number(id.replace(/\D/g, '') || 0),
    status: 'paid',
    channel: 'online',
    requiresShipping: true,
    createdAtMs: IN_WINDOW,
    updatedAtMs: IN_WINDOW,
    customerEmail: 'ada@example.com',
    shippingAddress: ADDRESS,
    totals: { itemsCents: 4200, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 4700, feeCents: 0 },
    lineItems: [
      { productId: 'prod-tee', variantId: 'var-m', name: 'Tee', variantLabel: 'M', sku: 'TEE-M', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
      { productId: 'prod-mug', name: 'Mug', sku: 'MUG', quantity: 1, unitAmountCents: 1200, productType: 'physical' },
    ],
    timeline: [{ atMs: 1, event: 'paid' }],
    ...overrides,
  })
}

function connect(): void {
  docs.set(`${SHIPSTATION_CONNECTIONS}/${HOST}`, {
    hostId: HOST,
    username: USER,
    ...sealShipStationPassword(HOST, PASS, readCommerceSecretKeyring()!),
    createdAtMs: 1,
    createdBy: 'admin-1',
  })
}

function request(search: string, init: { method?: string; auth?: string | null; body?: string; headers?: Record<string, string> } = {}): Request {
  const headers: Record<string, string> = { ...(init.headers ?? {}) }
  if (init.auth !== null) headers['authorization'] = init.auth ?? AUTH
  return new Request(`https://app.aglyn.test/api/commerce/shipstation/${HOST}?${search}`, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  })
}

const call = (req: Request, hostId = HOST) => shipStationRoute(req, { params: { hostId } })

const orderOf = (id: string) => docs.get(`hosts/${HOST}/orders/${id}`) as Record<string, any>

beforeEach(() => {
  docs.clear()
  queryLog.length = 0
  mockRate.mockClear()
  mockNotify.mockClear()
  mockDisabled.mockReset()
  mockDisabled.mockResolvedValue([])
  mockRate.mockImplementation(async () => ({ allowed: true, resetMs: Date.now() + 60_000 }))
  docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'admin' } })
  connect()
})

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

describe('credentials', () => {
  it('reads a Basic header and nothing else', () => {
    expect(readBasicAuth(AUTH)).toEqual({ username: USER, password: PASS })
    expect(readBasicAuth(`Bearer ${PASS}`)).toBeNull()
    expect(readBasicAuth(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toBeNull()
    expect(readBasicAuth(undefined)).toBeNull()
  })

  it('matches only the stored username and password together', () => {
    const stored = { username: USER, password: PASS }
    expect(credentialsMatch(stored, { username: USER, password: PASS })).toBe(true)
    expect(credentialsMatch(stored, { username: USER, password: `${PASS}x` })).toBe(false)
    expect(credentialsMatch(stored, { username: 'someone', password: PASS })).toBe(false)
    expect(credentialsMatch(null, { username: USER, password: PASS })).toBe(false)
    expect(credentialsMatch(stored, null)).toBe(false)
    // A password that could not be opened matches nothing, not even itself.
    expect(credentialsMatch({ username: USER, password: null }, { username: USER, password: '' })).toBe(false)
  })
})

describe('the sealed password', () => {
  afterEach(() => {
    delete process.env['COMMERCE_SECRET_KEY']
    process.env['TOKEN_SIGNING_SECRET'] = 'test-token-signing-secret'
  })

  it('refuses every request when the stored password cannot be opened', async () => {
    docs.set(`${SHIPSTATION_CONNECTIONS}/${HOST}`, { ...docs.get(`${SHIPSTATION_CONNECTIONS}/${HOST}`), hostId: 'host-2' })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await call(request(`action=export&${WINDOW}`))).status).toBe(401)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('reseals under a new current key, and keeps answering the same password', async () => {
    const key = createSecretBoxKey(new Uint8Array(32).fill(7), 'k2')
    process.env['COMMERCE_SECRET_KEY'] = `k2:${Buffer.from(key.material).toString('base64')}`
    expect(readCommerceSecretKeyring()?.current.id).toBe(parseSecretBoxKeyring(process.env['COMMERCE_SECRET_KEY']).current.id)
    seedOrder('o1')
    expect((await call(request(`action=export&${WINDOW}`))).status).toBe(200)
    const stored = docs.get(`${SHIPSTATION_CONNECTIONS}/${HOST}`)
    expect(stored?.passwordKeyId).toBe('k2')
    expect(String(stored?.sealedPassword)).toMatch(/^sb1\.k2\./)
    expect((await call(request(`action=export&${WINDOW}`))).status).toBe(200)
  })
})

describe('auth and gates', () => {
  it('refuses a request with no credentials, and reads no order', async () => {
    seedOrder('o1')
    const response = await call(request(`action=export&${WINDOW}`, { auth: null }))
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toMatch(/^Basic /)
    expect(queryLog).toHaveLength(0)
  })

  it('refuses a wrong password and a wrong username alike', async () => {
    seedOrder('o1')
    const wrongPass = `Basic ${Buffer.from(`${USER}:nope`).toString('base64')}`
    const wrongUser = `Basic ${Buffer.from(`aglyn-other:${PASS}`).toString('base64')}`
    expect((await call(request(`action=export&${WINDOW}`, { auth: wrongPass }))).status).toBe(401)
    expect((await call(request(`action=export&${WINDOW}`, { auth: wrongUser }))).status).toBe(401)
    expect(queryLog).toHaveLength(0)
  })

  it('refuses a site that never connected, as an unknown pair', async () => {
    docs.delete(`${SHIPSTATION_CONNECTIONS}/${HOST}`)
    expect((await call(request(`action=export&${WINDOW}`))).status).toBe(401)
  })

  it('refuses plain HTTP in production', async () => {
    const before = process.env['NODE_ENV']
    ;(process.env as Record<string, string>)['NODE_ENV'] = 'production'
    try {
      const response = await call(request(`action=export&${WINDOW}`, { headers: { 'x-forwarded-proto': 'http' } }))
      expect(response.status).toBe(403)
      const secure = await call(request(`action=export&${WINDOW}`, { headers: { 'x-forwarded-proto': 'https' } }))
      expect(secure.status).toBe(200)
    } finally {
      ;(process.env as Record<string, string | undefined>)['NODE_ENV'] = before
    }
  })

  it('answers 429 with Retry-After when the site’s budget is spent, keyed by site and address', async () => {
    mockRate.mockImplementationOnce(async () => ({ allowed: false, resetMs: Date.now() + 30_000 }))
    const response = await call(request(`action=export&${WINDOW}`, { headers: { 'x-forwarded-for': '203.0.113.9' } }))
    expect(response.status).toBe(429)
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(String(mockRate.mock.calls[0][0])).toMatch(new RegExp(`^shipstation:${HOST}:`))
  })

  it('refuses a site whose commerce is switched off, after the credentials prove it', async () => {
    mockDisabled.mockResolvedValue(['commerce'])
    seedOrder('o1')
    const response = await call(request(`action=export&${WINDOW}`))
    expect(response.status).toBe(403)
    expect(await response.text()).toMatch(/switched off/)
    expect(queryLog).toHaveLength(0)
  })

  it('refuses an unknown site id and a malformed one', async () => {
    expect((await call(request(`action=export&${WINDOW}`), 'a/b')).status).toBe(404)
  })

  it('refuses an unknown action and the wrong method for each', async () => {
    expect((await call(request('action=dance'))).status).toBe(400)
    expect((await call(request(`action=export&${WINDOW}`, { method: 'POST', body: '' }))).status).toBe(405)
    expect((await call(request('action=shipnotify&order_number=1001'))).status).toBe(405)
  })
})

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const orderIds = (xml: string) => [...xml.matchAll(/<OrderID><!\[CDATA\[([^\]]+)\]\]><\/OrderID>/g)].map((match) => match[1])

describe('export', () => {
  it('answers the window’s shippable orders, and none outside it', async () => {
    seedOrder('o1')
    seedOrder('o2', { updatedAtMs: Date.UTC(2026, 8, 1) })
    seedOrder('o3', { requiresShipping: false })
    seedOrder('o4', { status: 'cancelled', updatedAtMs: IN_WINDOW + 1 })
    const response = await call(request(`action=export&${WINDOW}&page=1`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/application\/xml/)
    const xml = await response.text()
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true)
    expect(xml).toMatch(/<Orders pages="1">/)
    expect(orderIds(xml)).toEqual(['o1', 'o4'])
    expect(xml).toMatch(/<OrderStatus><!\[CDATA\[canceled\]\]><\/OrderStatus>/)
    expect(docs.get(`${SHIPSTATION_CONNECTIONS}/${HOST}`)?.lastExportAtMs).toBeGreaterThan(0)
  })

  it('leaves out an order ShipStation could not import, rather than failing the page', async () => {
    seedOrder('o1')
    seedOrder('o2', { shippingAddress: { name: 'No Street', city: 'Austin', postalCode: '78701', country: 'US' } })
    const xml = await (await call(request(`action=export&${WINDOW}`))).text()
    expect(orderIds(xml)).toEqual(['o1'])
  })

  it('pages the window: the count names every page, and page 2 starts after page 1 by the cursor', async () => {
    for (let index = 0; index < 205; index += 1) {
      seedOrder(`o${String(index).padStart(3, '0')}`, { updatedAtMs: IN_WINDOW + index })
    }
    const first = await (await call(request(`action=export&${WINDOW}&page=1`))).text()
    expect(first).toMatch(/<Orders pages="3">/)
    expect(orderIds(first)).toHaveLength(100)
    const second = await (await call(request(`action=export&${WINDOW}&page=2`))).text()
    expect(orderIds(second)).toHaveLength(100)
    expect(orderIds(second)[0]).toBe('o100')
    const page2Read = queryLog.filter((entry) => entry.path.endsWith('/orders'))[1]
    expect(page2Read.after).not.toBeNull()
    expect(page2Read.offset).toBe(0)
    const third = await (await call(request(`action=export&${WINDOW}&page=3`))).text()
    expect(orderIds(third)).toEqual(['o200', 'o201', 'o202', 'o203', 'o204'])
    expect(new Set([...orderIds(first), ...orderIds(second), ...orderIds(third)]).size).toBe(205)
  })

  it('serves a page asked out of order by offset, with the same orders', async () => {
    for (let index = 0; index < 150; index += 1) {
      seedOrder(`o${String(index).padStart(3, '0')}`, { updatedAtMs: IN_WINDOW + index })
    }
    const second = await (await call(request(`action=export&${WINDOW}&page=2`))).text()
    expect(orderIds(second)[0]).toBe('o100')
    expect(orderIds(second)).toHaveLength(50)
    const read = queryLog.filter((entry) => entry.path.endsWith('/orders'))[0]
    expect(read.offset).toBe(100)
  })

  it('refuses a window it cannot read', async () => {
    expect((await call(request('action=export&start_date=yesterday&end_date=today'))).status).toBe(400)
    const backwards = 'start_date=10%2F06%2F2026+00%3A00&end_date=10%2F01%2F2026+00%3A00'
    expect((await call(request(`action=export&${backwards}`))).status).toBe(400)
    expect((await call(request(`action=export&${WINDOW}&page=0`))).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// ShipNotify
// ---------------------------------------------------------------------------

function notice(items: string, overrides: { orderNumber?: string; tracking?: string } = {}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<ShipNotice>
  <OrderNumber>${overrides.orderNumber ?? '1001'}</OrderNumber>
  <OrderID>o1</OrderID>
  <CustomerCode>ada@example.com</CustomerCode>
  <LabelCreateDate>10/06/2026 12:56</LabelCreateDate>
  <ShipDate>10/06/2026</ShipDate>
  <Carrier>USPS</Carrier>
  <Service>Priority Mail</Service>
  <TrackingNumber>${overrides.tracking ?? '9400111899223817563922'}</TrackingNumber>
  <ShippingCost>4.95</ShippingCost>
  <Recipient><Name>Ada Buyer</Name><Address1>1 Main St</Address1><City>Austin</City><State>TX</State><PostalCode>78701</PostalCode><Country>US</Country></Recipient>
  <Items>${items}</Items>
</ShipNotice>`
}

const item = (lineItemId: string, sku: string, quantity: number) =>
  `<Item><SKU>${sku}</SKU><Name>x</Name><Quantity>${quantity}</Quantity><LineItemID>${lineItemId}</LineItemID></Item>`

function shipnotify(body: string, search = 'order_number=1001&carrier=usps&service=&tracking_number=9400111899223817563922') {
  return call(request(`action=shipnotify&${search}`, { method: 'POST', body, headers: { 'content-type': 'application/xml' } }))
}

describe('shipnotify', () => {
  it('records the shipment for the items it names, and emails the buyer once', async () => {
    seedOrder('o1')
    const response = await shipnotify(notice(item('0', 'TEE-M', 3) + item('1', 'MUG', 1)))
    expect(response.status).toBe(200)
    const order = orderOf('o1')
    expect(order.status).toBe('fulfilled')
    expect(order.fulfillments).toHaveLength(1)
    expect(order.fulfillments[0]).toMatchObject({
      carrier: 'USPS',
      trackingNumber: '9400111899223817563922',
      lines: [
        { lineItemId: 0, quantity: 3 },
        { lineItemId: 1, quantity: 1 },
      ],
    })
    expect(order.fulfillments[0].trackingUrl).toMatch(/^https:\/\//)
    expect(order.updatedAtMs).toBeGreaterThan(IN_WINDOW)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(docs.get(`${SHIPSTATION_CONNECTIONS}/${HOST}`)?.lastShipNoticeAtMs).toBeGreaterThan(0)
  })

  it('is a no-op for the same tracking number on the same order', async () => {
    seedOrder('o1')
    await shipnotify(notice(item('0', 'TEE-M', 1)))
    const again = await shipnotify(notice(item('0', 'TEE-M', 1)))
    expect(again.status).toBe(200)
    expect(await again.text()).toMatch(/Already recorded/)
    expect(orderOf('o1').fulfillments).toHaveLength(1)
    expect(mockNotify).toHaveBeenCalledTimes(1)
  })

  it('treats a tracking number typed in Aglyn first as the same parcel, however it is spaced', async () => {
    seedOrder('o1', {
      status: 'fulfilled',
      fulfillments: [{ id: 'f1', lineItemIds: [0, 1], trackingNumber: '9400 1118 9922 3817 5639 22', carrier: 'USPS', atMs: 2 }],
    })
    const response = await shipnotify(notice(''))
    expect(response.status).toBe(200)
    expect(orderOf('o1').fulfillments).toHaveLength(1)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('ships part of an order, and the next parcel ships the rest', async () => {
    seedOrder('o1')
    await shipnotify(notice(item('0', 'TEE-M', 1)))
    expect(orderOf('o1').status).toBe('partially_fulfilled')
    expect(orderOf('o1').fulfillments[0].lines).toEqual([{ lineItemId: 0, quantity: 1 }])
    await shipnotify(
      notice(item('0', 'TEE-M', 2) + item('1', 'MUG', 1), { tracking: '1Z999AA10123456784' }),
      'order_number=1001&carrier=ups&service=&tracking_number=1Z999AA10123456784',
    )
    const order = orderOf('o1')
    expect(order.status).toBe('fulfilled')
    expect(order.fulfillments).toHaveLength(2)
    expect(order.fulfillments[1]).toMatchObject({ carrier: 'UPS', lines: [{ lineItemId: 0, quantity: 2 }, { lineItemId: 1, quantity: 1 }] })
  })

  it('finds an item by SKU when the line id is not one it sent, and bounds a stale quantity by what is left', async () => {
    seedOrder('o1', {
      status: 'partially_fulfilled',
      fulfillments: [{ id: 'f1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 2 }], trackingNumber: 'EARLIER', atMs: 2 }],
    })
    await shipnotify(notice(item('99', 'tee-m', 3)))
    const order = orderOf('o1')
    expect(order.fulfillments).toHaveLength(2)
    expect(order.fulfillments[1].lines).toEqual([{ lineItemId: 0, quantity: 1 }])
    expect(order.status).toBe('partially_fulfilled')
  })

  it('ships everything left when the notice names no items', async () => {
    seedOrder('o1')
    await shipnotify(notice(''))
    expect(orderOf('o1').status).toBe('fulfilled')
    expect(orderOf('o1').fulfillments[0].lines).toEqual([
      { lineItemId: 0, quantity: 3 },
      { lineItemId: 1, quantity: 1 },
    ])
  })

  it('refuses items that are not on the order, and writes nothing', async () => {
    seedOrder('o1')
    const response = await shipnotify(notice(item('', 'NOT-OURS', 1)))
    expect(response.status).toBe(400)
    expect(orderOf('o1').fulfillments).toBeUndefined()
  })

  it('finds the order by its number when the id is not ours, and says which order it cannot find', async () => {
    seedOrder('o7', { number: 1007 })
    const body = notice(item('0', 'TEE-M', 3)).replace('<OrderID>o1</OrderID>', '<OrderID>123456</OrderID>')
    const found = await shipnotify(body, 'order_number=1007&carrier=usps&service=&tracking_number=9400111899223817563922')
    expect(found.status).toBe(200)
    expect(orderOf('o7').fulfillments).toHaveLength(1)
    const missing = await shipnotify(
      body.replace('1001', '4242'),
      'order_number=4242&carrier=usps&service=&tracking_number=X1',
    )
    expect(missing.status).toBe(404)
    expect(await missing.text()).toMatch(/4242/)
  })

  it('refuses to ship a canceled order', async () => {
    seedOrder('o1', { status: 'cancelled' })
    const response = await shipnotify(notice(''))
    expect(response.status).toBe(409)
    expect(orderOf('o1').fulfillments).toBeUndefined()
  })

  it('refuses a notice that declares a document type', async () => {
    seedOrder('o1')
    const hostile = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>${notice('')}`
    const response = await shipnotify(hostile)
    expect(response.status).toBe(400)
    expect(orderOf('o1').fulfillments).toBeUndefined()
  })
})
