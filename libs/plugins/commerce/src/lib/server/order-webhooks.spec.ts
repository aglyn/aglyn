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
import { createHmac } from 'node:crypto'
import {
  deliverOrderEventToWebhooks,
  orderWebhooksHandler,
  postOrderWebhook,
  signOrderWebhook,
} from './order-webhooks'
import { parseOrderWebhookSignature } from '../model/order-webhooks'

/**
 * Merchant order webhooks (AGL-3611): the console's door (who may, what is
 * stored, the secret shown once and stored sealed) and the subscriber (signed
 * POSTs, one endpoint's failure retried without re-posting the others, the
 * last attempt dead-lettered with the managers told).
 */

const docs = new Map<string, Record<string, any>>()
let generated = 0
const INCREMENT = Symbol('increment')

function apply(path: string, value: Record<string, any>) {
  const next = { ...(docs.get(path) ?? {}) }
  for (const [key, field] of Object.entries(value)) {
    next[key] = field && field[INCREMENT] !== undefined ? (Number(next[key]) || 0) + field[INCREMENT] : field
  }
  docs.set(path, next)
}
const snap = (path: string): any => {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (k: string) => data?.[k] }
}
function ref(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snap(path),
    set: async (value: any) => void docs.set(path, value),
    update: async (value: any) => {
      if (!docs.has(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
      apply(path, value)
    },
    create: async (value: any) => {
      if (docs.has(path)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
      docs.set(path, value)
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collection(`${path}/${name}`),
  }
}
function collection(path: string): any {
  const run = (filters: Array<[string, any]>, max = Infinity) => ({
    where: (field: string, _op: string, value: any) => run([...filters, [field, value]], max),
    limit: (n: number) => run(filters, n),
    get: async () => {
      const found = [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .filter((key) => filters.every(([field, value]) => docs.get(key)?.[field] === value))
        .slice(0, max)
        .map(snap)
      return { size: found.length, docs: found, empty: found.length === 0 }
    },
  })
  return { doc: (id?: string) => ref(`${path}/${id ?? `gen-${++generated}`}`), ...run([]) }
}
const fakeFirestore = {
  collection: (name: string) => collection(name),
  batch: () => {
    const writes: Array<() => Promise<void>> = []
    const batch = {
      set: (r: any, v: any) => (writes.push(() => r.set(v)), batch),
      update: (r: any, v: any) => (writes.push(() => r.update(v)), batch),
      delete: (r: any) => (writes.push(() => r.delete()), batch),
      commit: async () => {
        for (const write of writes) await write()
      },
    }
    return batch
  },
  runTransaction: async <T,>(fn: (t: any) => Promise<T>): Promise<T> => {
    const writes: Array<() => Promise<void>> = []
    const result = await fn({
      get: (target: any) => target.get(),
      create: (r: any, v: any) => writes.push(() => r.create(v)),
    })
    for (const write of writes) await write()
    return result
  },
}

const mockVerify = jest.fn(async () => ({ uid: 'admin-1' }))
const mockNotify = jest.fn(async () => undefined)
const mockFetch = jest.fn()
const mockPermissions = jest.fn(async () => ({ orgWide: true, hostRole: 'admin' }))
jest.mock('@aglyn/tenant-data-admin', () => {
  const firestoreNamespace = {
    FieldValue: { increment: (n: number) => ({ [INCREMENT]: n }) },
    Timestamp: { fromMillis: (ms: number) => ({ ms }) },
  }
  return {
    firebaseAdmin: {
      app: () => ({ auth: () => ({ verifyIdToken: (...a: any[]) => mockVerify(...(a as [])) }), firestore: () => fakeFirestore }),
      firestore: firestoreNamespace,
    },
    notifyHostManagers: (...a: any[]) => mockNotify(...(a as [])),
    fetchConfiguredPublicUrl: (...a: any[]) => mockFetch(...a),
    configuredUrlRefusal: (url: string) => (String(url).startsWith('https://') ? null : 'not-https'),
    describeConfiguredUrlRefusal: () => 'the address must start with https://',
  }
})
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: (...a: any[]) => mockPermissions(...(a as [])),
}))

const HOST = 'h1'
const KEY = Buffer.alloc(32, 7).toString('base64')

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
async function call(body: Record<string, any>, uid = 'admin-1') {
  mockVerify.mockImplementationOnce(async () => ({ uid }))
  const { res, out } = respond()
  await orderWebhooksHandler(
    { method: 'POST', headers: { authorization: 'Bearer tok' }, body: { hostId: HOST, ...body }, query: {}, cookies: {} } as unknown as PluginApiRequest,
    res,
  )
  return out
}
const envelope = (overrides: Record<string, any> = {}) => ({
  id: 'evt-1',
  event: 'order.paid',
  hostId: HOST,
  orgId: null,
  occurredAtMs: Date.now(),
  attempt: 1,
  payload: { order: { id: 'o1', object: 'order' } },
  ...overrides,
})
const deliveries = () => [...docs.entries()].filter(([path]) => path.startsWith(`hosts/${HOST}/orderWebhookDeliveries/`)).map(([path, value]) => ({ id: path.split('/').pop(), ...value }) as Record<string, any>)

beforeEach(() => {
  docs.clear()
  generated = 0
  jest.clearAllMocks()
  process.env['COMMERCE_SECRET_KEY'] = KEY
  delete process.env['TOKEN_SIGNING_SECRET']
  docs.set(`hosts/${HOST}`, { memberRoles: { 'admin-1': 'admin', 'editor-1': 'editor' } })
  mockFetch.mockResolvedValue({ ok: true, status: 200 })
})
afterAll(() => {
  delete process.env['COMMERCE_SECRET_KEY']
  delete process.env['TOKEN_SIGNING_SECRET']
})

describe('the console door', () => {
  it('lets only an admin of the whole workspace manage webhooks', async () => {
    expect((await call({ action: 'status' }, 'editor-1')).status).toBe(403)
    mockPermissions.mockResolvedValueOnce({ orgWide: false, hostRole: 'admin' })
    expect((await call({ action: 'status' })).status).toBe(403)
    const status = await call({ action: 'status' })
    expect(status.body).toMatchObject({ configured: true })
    expect(status.body.events.map((entry: any) => entry.event)).toContain('return.requested')
  })

  it('says it is not configured, and adds nothing, without a key', async () => {
    delete process.env['COMMERCE_SECRET_KEY']
    expect((await call({ action: 'status' })).body.configured).toBe(false)
    expect((await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid'] })).status).toBe(503)
  })

  it('seals with a key derived from the token signing secret, which still opens once a dedicated key is set', async () => {
    delete process.env['COMMERCE_SECRET_KEY']
    process.env['TOKEN_SIGNING_SECRET'] = 'tss-for-spec'
    const created = await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid'] })
    expect(docs.get(`hosts/${HOST}/orderWebhookSecrets/${created.body.id}`)!.secretKeyId).toBe('tss1')
    process.env['COMMERCE_SECRET_KEY'] = KEY
    await deliverOrderEventToWebhooks(envelope())
    const [, init] = mockFetch.mock.calls[0]
    const parsed = parseOrderWebhookSignature(init.headers['Aglyn-Signature'])!
    expect(parsed.signatures[0]).toBe(signOrderWebhook(created.body.secret, parsed.timestamp, init.body))
  })

  it('shows the secret once and stores it only sealed, apart from the endpoint', async () => {
    const out = await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid', 'nope', 'order.refunded'], description: 'ERP' })
    expect(out.status).toBe(200)
    expect(out.body.secret).toMatch(/^whsec_/)
    const endpoint = docs.get(`hosts/${HOST}/orderWebhooks/${out.body.id}`)!
    expect(endpoint).toMatchObject({ url: 'https://erp.test/hook', events: ['order.paid', 'order.refunded'], enabled: true, secretHint: out.body.secret.slice(-4) })
    expect(JSON.stringify(endpoint)).not.toContain(out.body.secret)
    const sealed = docs.get(`hosts/${HOST}/orderWebhookSecrets/${out.body.id}`)!
    expect(sealed.sealedSecret).toMatch(/^sb1\./)
    expect(sealed.sealedSecret).not.toContain(out.body.secret)
  })

  it('refuses an address that is not https, an empty event list, and an eleventh endpoint', async () => {
    expect((await call({ action: 'create', url: 'http://erp.test/hook', events: ['order.paid'] })).status).toBe(400)
    expect((await call({ action: 'create', url: 'https://erp.test/hook', events: [] })).status).toBe(400)
    for (let i = 0; i < 10; i++) {
      expect((await call({ action: 'create', url: `https://erp.test/${i}`, events: ['order.paid'] })).status).toBe(200)
    }
    expect((await call({ action: 'create', url: 'https://erp.test/11', events: ['order.paid'] })).status).toBe(409)
  })

  it('rolls the secret, so the old one no longer signs', async () => {
    const created = await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid'] })
    const rolled = await call({ action: 'roll-secret', endpointId: created.body.id })
    expect(rolled.body.secret).not.toBe(created.body.secret)
    await deliverOrderEventToWebhooks(envelope())
    const [, init] = mockFetch.mock.calls[0]
    const parsed = parseOrderWebhookSignature(init.headers['Aglyn-Signature'])!
    expect(parsed.signatures[0]).toBe(signOrderWebhook(rolled.body.secret, parsed.timestamp, init.body))
  })

  it('updates, pauses and deletes an endpoint with its secret', async () => {
    const created = await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid'] })
    const id = created.body.id
    expect((await call({ action: 'update', endpointId: id, enabled: false, events: ['order.cancelled'] })).status).toBe(200)
    expect(docs.get(`hosts/${HOST}/orderWebhooks/${id}`)).toMatchObject({ enabled: false, events: ['order.cancelled'] })
    expect((await call({ action: 'update', endpointId: id, url: 'ftp://x' })).status).toBe(400)
    expect((await call({ action: 'delete', endpointId: id })).status).toBe(200)
    expect(docs.has(`hosts/${HOST}/orderWebhooks/${id}`)).toBe(false)
    expect(docs.has(`hosts/${HOST}/orderWebhookSecrets/${id}`)).toBe(false)
  })

  it('sends a test event now and logs it', async () => {
    const created = await call({ action: 'create', url: 'https://erp.test/hook', events: ['order.paid'] })
    mockFetch.mockResolvedValueOnce({ ok: true, status: 500 })
    const out = await call({ action: 'test', endpointId: created.body.id })
    expect(out.body).toMatchObject({ delivered: false, attempt: { httpStatus: 500, error: 'The endpoint answered 500' } })
    expect(deliveries()[0]).toMatchObject({ test: true, event: 'webhook.test', status: 'failed' })
  })
})

describe('delivery', () => {
  async function endpoint(url: string, events = ['order.paid']) {
    return (await call({ action: 'create', url, events })).body as { id: string; secret: string }
  }

  it('posts a signed body a receiver can check, with the event id stable across attempts', async () => {
    const { secret } = await endpoint('https://erp.test/hook')
    await deliverOrderEventToWebhooks(envelope())
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://erp.test/hook')
    expect(init.headers).toMatchObject({ 'Aglyn-Event': 'order.paid', 'Aglyn-Event-Id': 'evt-1', 'content-type': 'application/json' })
    const parsed = parseOrderWebhookSignature(init.headers['Aglyn-Signature'])!
    const expected = createHmac('sha256', secret).update(`${parsed.timestamp}.${init.body}`).digest('hex')
    expect(parsed.signatures).toEqual([expected])
    expect(JSON.parse(init.body)).toMatchObject({ id: 'evt-1', type: 'order.paid', siteId: HOST, data: { order: { id: 'o1' } } })
    expect(deliveries()[0]).toMatchObject({ status: 'delivered', eventId: 'evt-1', orderId: 'o1' })
  })

  it('skips an endpoint that does not take the event, is paused, or was added after it', async () => {
    await endpoint('https://erp.test/refunds', ['order.refunded'])
    const paused = await endpoint('https://erp.test/paused')
    await call({ action: 'update', endpointId: paused.id, enabled: false })
    await deliverOrderEventToWebhooks(envelope({ occurredAtMs: Date.now() - 60_000 }))
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('retries only the endpoint that failed, and throws so the outbox backs off', async () => {
    await endpoint('https://a.test/hook')
    await endpoint('https://b.test/hook')
    mockFetch.mockImplementation(async (url: string) => ({ ok: true, status: url.startsWith('https://b.') ? 503 : 204 }))
    await expect(deliverOrderEventToWebhooks(envelope())).rejects.toThrow('1 of 2')
    expect(deliveries().map((row) => row.status).sort()).toEqual(['delivered', 'retrying'])

    mockFetch.mockClear()
    mockFetch.mockResolvedValue({ ok: true, status: 200 })
    await expect(deliverOrderEventToWebhooks(envelope({ attempt: 2 }))).resolves.toEqual({ delivered: 2, failed: 0 })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('https://b.test/hook')
    const b = deliveries().find((row) => row.attempts.length === 2)!
    expect(b.status).toBe('delivered')
  })

  it('dead-letters on the last attempt and tells the managers instead of throwing', async () => {
    const { id } = await endpoint('https://erp.test/hook')
    mockFetch.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    await expect(deliverOrderEventToWebhooks(envelope({ attempt: 8 }))).resolves.toEqual({ delivered: 0, failed: 1 })
    expect(deliveries()[0]).toMatchObject({ status: 'failed', attempts: [{ httpStatus: null, error: 'No answer within 8 seconds' }] })
    expect(docs.get(`hosts/${HOST}/orderWebhooks/${id}`)).toMatchObject({ consecutiveFailures: 1, lastDeliveryStatus: 'failed' })
    expect(mockNotify).toHaveBeenCalledWith(HOST, expect.objectContaining({ title: 'An order webhook could not be delivered' }))
  })

  it('resends a logged delivery from the console', async () => {
    await endpoint('https://erp.test/hook')
    mockFetch.mockResolvedValueOnce({ ok: true, status: 500 })
    await deliverOrderEventToWebhooks(envelope({ attempt: 8 }))
    const [row] = deliveries()
    const out = await call({ action: 'resend', deliveryId: row.id })
    expect(out.body.delivered).toBe(true)
    expect(deliveries()[0]).toMatchObject({ status: 'delivered' })
    expect(deliveries()[0].attempts).toHaveLength(2)
  })

  it('treats a redirect as a failure and a refusal as an attempt, never a throw out of the post', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 302 })
    const redirect = await postOrderWebhook({ url: 'https://x.test', secret: 's', event: 'order.paid', eventId: 'e', body: '{}' })
    expect(redirect).toMatchObject({ delivered: false, attempt: { httpStatus: 302 } })
    mockFetch.mockResolvedValueOnce({ ok: false, refusal: 'private-address', host: 'x.test' })
    const refused = await postOrderWebhook({ url: 'https://x.test', secret: 's', event: 'order.paid', eventId: 'e', body: '{}' })
    expect(refused.delivered).toBe(false)
    expect(refused.attempt.error).toMatch(/^Not sent: /)
  })
})
