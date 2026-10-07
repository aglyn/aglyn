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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { returnRequestHandler, returnsHandler } from './returns'

/**
 * Returns (AGL-3611): the buyer's request, the merchant's state machine,
 * receiving with restock, and the refund through the order's own route.
 *
 * The Firestore double buffers a transaction's writes and applies them at
 * commit, serializes transaction bodies, and answers the one query shape the
 * routes ask (`where(field, '==', value)`), so the race and the refusals
 * below turn on the same mechanics production does.
 */

const docs = new Map<string, Record<string, any>>()
let generated = 0

const snap = (path: string): any => {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (k: string) => data?.[k], ref: ref(path) }
}
function ref(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snap(path),
    set: async (value: any, options?: any) => void docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value),
    update: async (value: any) => {
      if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
      docs.set(path, { ...docs.get(path), ...value })
    },
    create: async (value: any) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    collection: (name: string) => collection(`${path}/${name}`),
  }
}
function collection(path: string): any {
  const run = (filters: Array<[string, any]>) => ({
    where: (field: string, _op: string, value: any) => run([...filters, [field, value]]),
    get: async () => {
      const found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) => filters.every(([field, value]) => docs.get(key)?.[field] === value))
        .map(snap)
      return { size: found.length, docs: found, empty: found.length === 0 }
    },
  })
  return { doc: (id?: string) => ref(`${path}/${id ?? `gen-${++generated}`}`), ...run([]) }
}
let queue: Promise<unknown> = Promise.resolve()
const fakeFirestore = {
  collection: (name: string) => collection(name),
  runTransaction: <T>(fn: (t: any) => Promise<T>): Promise<T> => {
    const go = queue.then(async () => {
      const writes: Array<() => Promise<void>> = []
      const result = await fn({
        get: (target: any) => target.get(),
        set: (r: any, v: any, o?: any) => writes.push(() => r.set(v, o)),
        update: (r: any, v: any) => writes.push(() => r.update(v)),
        create: (r: any, v: any) => writes.push(() => r.create(v)),
      })
      for (const write of writes) await write()
      return result
    })
    queue = go.catch(() => undefined)
    return go
  },
}

const mockVerify = jest.fn(async () => ({ uid: 'admin-1' }))
const mockNotify = jest.fn(async () => undefined)
const mockSendEmail = jest.fn(async () => undefined)
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ auth: () => ({ verifyIdToken: (...a: any[]) => mockVerify(...(a as [])) }), firestore: () => fakeFirestore }) },
  notifyHostManagers: (...a: any[]) => mockNotify(...(a as [])),
  getOrgForHost: async () => ({ org: { ownerUid: 'owner-1' } }),
  findUserByUidAcrossPools: async () => ({ record: { email: 'owner@shop.test' } }),
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  sendEmail: (...a: any[]) => mockSendEmail(...(a as [])),
}))
const mockMember = { status: 'anonymous' as string, email: '' }
jest.mock('./membership', () => ({
  readActiveMemberSession: async () =>
    mockMember.status === 'active'
      ? { status: 'active', memberId: 'm1', member: { get: () => mockMember.email } }
      : { status: 'anonymous' },
}))
jest.mock('./order-status-token', () => ({
  verifyOrderStatusToken: (_h: string, _o: string, token: string) => token === 'good-token',
  orderStatusUrl: () => 'https://shop.test/order-status?o=o1&t=good-token',
}))
const mockRefund = jest.fn()
jest.mock('./refund', () => ({ refundHandler: (...a: any[]) => mockRefund(...(a as [])) }))

const HOST = 'h1'
const DAY = 86_400_000
const now = Date.now()

function seed(overrides: Record<string, any> = {}) {
  docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'admin', 'viewer-1': 'viewer' } })
  docs.set(`hosts/${HOST}/settings/store`, { currency: 'USD' })
  docs.set(`hosts/${HOST}/orders/o1`, {
    number: 1042,
    status: 'fulfilled',
    customerEmail: 'ada@example.com',
    customerName: 'Ada',
    createdAtMs: now - 5 * DAY,
    totals: { itemsCents: 5000, shippingCents: 500, taxCents: 0, discountCents: 0, totalCents: 5500 },
    lineItems: [
      { productId: 'mug', variantId: 'v1', name: 'Mug', quantity: 3, unitAmountCents: 1000, productType: 'physical' },
      { productId: 'tee', variantId: 'v2', name: 'Tee', quantity: 1, unitAmountCents: 2000, productType: 'physical' },
    ],
    fulfillments: [{ id: 'f1', lineItemIds: [0, 1], atMs: now - 2 * DAY }],
    timeline: [],
    ...overrides,
  })
  docs.set(`hosts/${HOST}/products/mug`, { name: 'Mug', variants: [{ id: 'v1', inventory: 4 }] })
  docs.set(`hosts/${HOST}/products/tee`, { name: 'Tee', variants: [{ id: 'v2', inventory: null }] })
  docs.set(`hosts/${HOST}/locations/back`, { name: 'Back room' })
}

function respond() {
  const out = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      out.status = code
      return res
    },
    json(body: any) {
      out.body = body
      return res
    },
  } as unknown as PluginApiResponse
  return { res, out }
}
async function buyer(method: 'GET' | 'POST', input: Record<string, any>) {
  const { res, out } = respond()
  const req = { method, query: method === 'GET' ? { hostId: HOST, ...input } : {}, body: method === 'POST' ? { hostId: HOST, ...input } : undefined, headers: {}, cookies: {} } as unknown as PluginApiRequest
  await returnRequestHandler(req, res)
  return out
}
async function merchant(body: Record<string, any>, uid = 'admin-1') {
  mockVerify.mockImplementationOnce(async () => ({ uid }))
  const { res, out } = respond()
  await returnsHandler({ method: 'POST', headers: { authorization: 'Bearer tok' }, body: { hostId: HOST, ...body }, query: {}, cookies: {} } as unknown as PluginApiRequest, res)
  return out
}
const returns = () => [...docs.entries()].filter(([path]) => path.startsWith(`hosts/${HOST}/returns/`)).map(([path, value]) => ({ id: path.split('/').pop() as string, ...value }) as Record<string, any> & { id: string })
const outbox = () => [...docs.values()].filter((value) => value.pluginId === 'commerce' && value.event)

beforeEach(() => {
  docs.clear()
  generated = 0
  queue = Promise.resolve()
  mockMember.status = 'anonymous'
  mockMember.email = ''
  jest.clearAllMocks()
  mockRefund.mockImplementation(async (_req: any, res: any) => res.status(200).json({ refundedCents: 1000, fullyRefunded: false }))
  seed()
})

describe('the buyer asks', () => {
  it('hides the order from anyone without the status link or the buyer’s session', async () => {
    expect((await buyer('GET', { orderId: 'o1' })).status).toBe(404)
    expect((await buyer('GET', { orderId: 'o1', t: 'forged' })).status).toBe(404)
    mockMember.status = 'active'
    mockMember.email = 'someone-else@example.com'
    expect((await buyer('GET', { orderId: 'o1' })).status).toBe(404)
  })

  it('lists what may come back, by the status link or the signed-in buyer', async () => {
    const byLink = await buyer('GET', { orderId: 'o1', t: 'good-token' })
    expect(byLink.status).toBe(200)
    expect(byLink.body.lines.map((line: any) => line.returnable)).toEqual([3, 1])
    expect(byLink.body.windowOpen).toBe(true)
    mockMember.status = 'active'
    mockMember.email = 'ADA@example.com'
    expect((await buyer('GET', { orderId: 'o1' })).status).toBe(200)
  })

  it('opens a requested return, tells the store, and raises return.requested', async () => {
    const out = await buyer('POST', {
      orderId: 'o1',
      t: 'good-token',
      lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged' }],
      note: 'Two arrived cracked',
    })
    expect(out.status).toBe(200)
    expect(returns()).toHaveLength(1)
    expect(returns()[0]).toMatchObject({
      orderId: 'o1',
      orderNumber: '#1042',
      status: 'requested',
      requestedBy: 'buyer',
      customerNote: 'Two arrived cracked',
      lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged', name: 'Mug' }],
    })
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@shop.test', context: 'return-requested' }))
    expect(outbox().map((event) => event.event)).toEqual(['return.requested'])
    expect(docs.get(`hosts/${HOST}/orders/o1`)!.timeline.at(-1)).toMatchObject({ event: 'return-requested' })
  })

  it('refuses more than was shipped and not already being returned', async () => {
    await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged' }] })
    const again = await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged' }] })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('Only 1 of one item can be returned.')
    expect(returns()).toHaveLength(1)
  })

  it('grants exactly one of two racing requests for the last unit', async () => {
    const [a, b] = await Promise.all([
      buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 1, quantity: 1, reason: 'size_or_fit' }] }),
      buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 1, quantity: 1, reason: 'size_or_fit' }] }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(returns()).toHaveLength(1)
  })

  it('refuses after the window and when the store switched requests off', async () => {
    docs.set(`hosts/${HOST}/settings/store`, { returns: { windowDays: 1 } })
    expect((await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 1, reason: 'other' }] })).body.error).toMatch(/return window/)
    docs.set(`hosts/${HOST}/settings/store`, { returns: { enabled: false } })
    expect((await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 1, reason: 'other' }] })).body.error).toMatch(/does not take return requests/)
    expect(returns()).toHaveLength(0)
  })

  it('refuses a unit that never shipped, and an unknown reason', async () => {
    seed({ status: 'partially_fulfilled', fulfillments: [{ id: 'f1', lineItemIds: [0], lines: [{ lineItemId: 0, quantity: 1 }], atMs: now }] })
    expect((await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 1, quantity: 1, reason: 'other' }] })).status).toBe(409)
    expect((await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 1, reason: 'because' }] })).body.error).toBe('Choose a reason for each item.')
  })
})

describe('the merchant runs it', () => {
  const open = async () => {
    await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 2, reason: 'damaged' }] })
    return returns()[0].id
  }

  it('approves, emails the buyer, and refuses a viewer', async () => {
    const id = await open()
    expect((await merchant({ action: 'approve', returnId: id }, 'viewer-1')).status).toBe(403)
    const out = await merchant({ action: 'approve', returnId: id, merchantNote: 'Send it in the original box' })
    expect(out.body).toMatchObject({ ok: true, status: 'approved' })
    expect(returns()[0]).toMatchObject({ status: 'approved', merchantNote: 'Send it in the original box' })
    expect(mockSendEmail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'ada@example.com', context: 'return-approved' }))
    expect((await merchant({ action: 'approve', returnId: id })).body.already).toBe(true)
  })

  it('follows the state machine: a declined return cannot be received', async () => {
    const id = await open()
    await merchant({ action: 'decline', returnId: id, merchantNote: 'Past the window' })
    const out = await merchant({ action: 'receive', returnId: id, restock: [] })
    expect(out.status).toBe(409)
    expect(outbox().map((event) => event.event)).toEqual(['return.requested', 'return.declined'])
    // And a declined return gives its units back: the buyer may ask again.
    expect((await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 0, quantity: 3, reason: 'other' }] })).status).toBe(200)
  })

  it('receives with restock at a location, writing the stock and its ledger row', async () => {
    const id = await open()
    await merchant({ action: 'approve', returnId: id })
    const out = await merchant({ action: 'receive', returnId: id, restock: [{ lineItemId: 0, quantity: 1 }], locationId: 'back' })
    expect(out.body).toMatchObject({ ok: true, units: 1, status: 'received' })
    expect(docs.get(`hosts/${HOST}/products/mug`)!.variants[0].inventory).toBe(5)
    const rows = [...docs.entries()].filter(([path]) => path.includes('/inventoryAdjustments/')).map(([, value]) => value)
    expect(rows).toEqual([expect.objectContaining({ productId: 'mug', variantId: 'v1', delta: 1, reason: 'restock', orderId: 'o1', locationId: 'back' })])
    // A second receive is the retry it is.
    expect((await merchant({ action: 'receive', returnId: id, restock: [{ lineItemId: 0, quantity: 1 }] })).body.already).toBe(true)
    expect(docs.get(`hosts/${HOST}/products/mug`)!.variants[0].inventory).toBe(5)
  })

  it('refuses restocking more than came back, or into a location that is gone', async () => {
    const id = await open()
    await merchant({ action: 'approve', returnId: id })
    expect((await merchant({ action: 'receive', returnId: id, restock: [{ lineItemId: 0, quantity: 3 }] })).status).toBe(409)
    expect((await merchant({ action: 'receive', returnId: id, restock: [{ lineItemId: 0, quantity: 1 }], locationId: 'gone' })).status).toBe(409)
    expect(docs.get(`hosts/${HOST}/products/mug`)!.variants[0].inventory).toBe(4)
  })

  it('refunds a partial line by amount through the refund route, once', async () => {
    const id = await open()
    await merchant({ action: 'approve', returnId: id })
    await merchant({ action: 'receive', returnId: id, restock: [{ lineItemId: 0, quantity: 2 }] })
    docs.set(`hosts/${HOST}/orders/o1`, { ...docs.get(`hosts/${HOST}/orders/o1`), restockCheck: { kind: 'refund', lines: [], units: 2, fullyReversed: false, flaggedAtMs: 1 } })

    const out = await merchant({ action: 'refund', returnId: id })
    expect(out.body).toMatchObject({ ok: true, refundCents: 2000, status: 'refunded' })
    const [req] = mockRefund.mock.calls[0]
    expect(req.headers['idempotency-key']).toBe(`return:${HOST}:${id}`)
    expect(req.headers.authorization).toBe('Bearer tok')
    // 2 of 3 mugs: by amount, never naming the line (its third mug is still owned).
    expect(req.body).toEqual({ hostId: HOST, orderId: 'o1', amountCents: 2000 })
    expect(returns()[0]).toMatchObject({ status: 'refunded', refundCents: 2000 })
    // The order's restock question is answered by what the return did.
    expect(docs.get(`hosts/${HOST}/orders/o1`)!.restockCheck).toMatchObject({ resolution: 'restocked', resolvedBy: 'admin-1' })
    expect(outbox().map((event) => event.event)).toEqual(['return.requested', 'return.approved', 'return.received', 'return.refunded'])
    expect(mockSendEmail).toHaveBeenLastCalledWith(expect.objectContaining({ context: 'return-refunded' }))

    expect((await merchant({ action: 'refund', returnId: id })).body.already).toBe(true)
    expect(mockRefund).toHaveBeenCalledTimes(1)
  })

  it('names a whole line when the return takes all of it', async () => {
    await buyer('POST', { orderId: 'o1', t: 'good-token', lines: [{ lineItemId: 1, quantity: 1, reason: 'size_or_fit' }] })
    const id = returns()[0].id
    await merchant({ action: 'approve', returnId: id })
    await merchant({ action: 'refund', returnId: id })
    expect(mockRefund.mock.calls[0][0].body).toEqual({ hostId: HOST, orderId: 'o1', amountCents: 2000, lineItemIds: [1] })
  })

  it('passes a refused refund through and leaves the return as it was', async () => {
    const id = await open()
    await merchant({ action: 'approve', returnId: id })
    mockRefund.mockImplementationOnce(async (_req: any, res: any) => res.status(403).json({ error: 'Refunds require an admin of the whole workspace' }))
    const out = await merchant({ action: 'refund', returnId: id })
    expect(out).toEqual({ status: 403, body: { error: 'Refunds require an admin of the whole workspace' } })
    expect(returns()[0].status).toBe('approved')
  })

  it('opens a merchant return as approved, from the order', async () => {
    const out = await merchant({ action: 'create', orderId: 'o1', lines: [{ lineItemId: 1, quantity: 1, reason: 'wrong_item' }], note: 'Swapping for the right size' })
    expect(out.body.status).toBe('approved')
    expect(returns()[0]).toMatchObject({ requestedBy: 'merchant', merchantNote: 'Swapping for the right size' })
  })

  it('attaches a return label from a shipping plugin, https only', async () => {
    const id = await open()
    expect((await merchant({ action: 'attach-label', returnId: id, label: { carrier: 'USPS', trackingNumber: '9400', labelUrl: 'http://x' } })).status).toBe(409)
    await merchant({ action: 'attach-label', returnId: id, label: { carrier: 'USPS', trackingNumber: '9400', labelUrl: 'https://labels.test/1.pdf' } })
    expect(returns()[0].returnLabel).toMatchObject({ carrier: 'USPS', labelUrl: 'https://labels.test/1.pdf', trackingUrl: expect.stringContaining('usps.com') })
    // Still only requested: the buyer hears nothing until it is approved.
    expect(mockSendEmail).not.toHaveBeenCalledWith(expect.objectContaining({ context: 'return-approved' }))
  })

  it('emails a label attached after the approval, in the approval email', async () => {
    const id = await open()
    await merchant({ action: 'approve', returnId: id, notify: false })
    mockSendEmail.mockClear()
    await merchant({ action: 'attach-label', returnId: id, label: { carrier: 'UPS', trackingNumber: '1Z9', labelUrl: 'https://labels.test/2.pdf' } })
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ada@example.com', context: 'return-approved', text: expect.stringContaining('https://labels.test/2.pdf') }),
    )
  })
})
