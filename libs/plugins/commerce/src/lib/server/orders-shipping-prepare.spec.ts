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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

/**
 * `commerce/orders-shipping-prepare` (AGL-3613): it stamps only the open
 * orders that predate the stamp, and only for the order book's roles.
 */

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
}

function snapshot(path: string): any {
  const data = docs.get(path)
  return { id: path.split('/').pop(), exists: data !== undefined, data: () => data, get: (field: string) => data?.[field], ref: docRef(path) }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => snapshot(path),
    set: async (value: any) => void docs.set(path, value),
    update: async (value: any) => void docs.set(path, { ...docs.get(path), ...value }),
    create: async (value: any) => {
      if (docs.has(path)) throw new Error('ALREADY_EXISTS')
      docs.set(path, value)
    },
    delete: async () => void docs.delete(path),
    collection: (name: string) => collection(`${path}/${name}`),
  }
}

function collection(path: string, filters: Array<[string, string, any]> = [], max?: number): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: (field: string, op: string, value: any) => collection(path, [...filters, [field, op, value]], max),
    limit: (count: number) => collection(path, filters, count),
    get: async () => {
      const keys = childPaths(path)
        .filter((key) =>
          filters.every(([field, op, value]) => (op === 'in' ? value.includes(docs.get(key)?.[field]) : docs.get(key)?.[field] === value)),
        )
        .slice(0, max)
      return { docs: keys.map(snapshot) }
    },
  }
}

const fakeFirestore: any = {
  collection: (name: string) => collection(name),
  batch: () => {
    const writes: Array<[any, any]> = []
    return { update: (ref: any, value: any) => writes.push([ref, value]), commit: async () => { for (const [ref, value] of writes) await ref.update(value) } }
  },
  runTransaction: async (fn: (tx: any) => Promise<any>) => {
    const queued: Array<() => Promise<void>> = []
    const result = await fn({
      get: (ref: any) => ref.get(),
      create: (ref: any, value: any) => queued.push(() => ref.create(value)),
      set: (ref: any, value: any) => queued.push(() => ref.set(value)),
    })
    for (const write of queued) await write()
    return result
  },
}

const mockVerify = jest.fn(async (token: string) => ({ uid: token, email: `${token}@example.com` }))
let mockEntitled = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ auth: () => ({ verifyIdToken: (token: string) => mockVerify(token) }), firestore: () => fakeFirestore }) },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => mockEntitled,
}))

import { ordersShippingPrepareHandler } from './orders-shipping-prepare'

const HOST = 'host-1'

function respond() {
  const result = { status: 0, body: undefined as any }
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
    setHeader() {},
    redirect() {},
    end() {},
  }
  return { res, result }
}

async function post(uid: string | null, body: Record<string, unknown>) {
  const { res, result } = respond()
  const req = {
    method: 'POST',
    query: {},
    body: { hostId: HOST, ...body },
    headers: uid ? { authorization: `Bearer ${uid}` } : {},
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await ordersShippingPrepareHandler(req, res)
  return result
}

beforeEach(() => {
  docs.clear()
  mockEntitled = true
  docs.set(`hosts/${HOST}`, { memberRoles: { admin: 'admin', editor: 'editor', author: 'author' } })
})

describe('prepare', () => {
  it('stamps the open orders that predate the stamp, and leaves the rest alone', async () => {
    docs.set(`hosts/${HOST}/orders/old-paid`, { status: 'paid', createdAtMs: 7, lineItems: [{ productId: 'p', name: 'Mug', quantity: 1, unitAmountCents: 1 }] })
    docs.set(`hosts/${HOST}/orders/old-digital`, { status: 'paid', createdAtMs: 8, lineItems: [{ productId: 'e', name: 'Ebook', quantity: 1, unitAmountCents: 1, productType: 'digital' }] })
    docs.set(`hosts/${HOST}/orders/stamped`, { status: 'paid', createdAtMs: 9, requiresShipping: true, updatedAtMs: 50, lineItems: [] })
    docs.set(`hosts/${HOST}/orders/shipped`, { status: 'fulfilled', createdAtMs: 10, lineItems: [] })
    const result = await post('editor', {})
    expect(result.body).toEqual({ ok: true, stamped: 2 })
    expect(docs.get(`hosts/${HOST}/orders/old-paid`)).toMatchObject({ requiresShipping: true, updatedAtMs: 7 })
    expect(docs.get(`hosts/${HOST}/orders/old-digital`)).toMatchObject({ requiresShipping: false, updatedAtMs: 8 })
    expect(docs.get(`hosts/${HOST}/orders/stamped`)?.updatedAtMs).toBe(50)
    expect(docs.get(`hosts/${HOST}/orders/shipped`)?.requiresShipping).toBeUndefined()
  })

  it('refuses an author, a stranger and a missing token, and stamps nothing', async () => {
    docs.set(`hosts/${HOST}/orders/old-paid`, { status: 'paid', createdAtMs: 7, lineItems: [] })
    expect((await post('author', {})).status).toBe(403)
    expect((await post('stranger', {})).status).toBe(403)
    expect((await post(null, {})).status).toBe(401)
    expect(docs.get(`hosts/${HOST}/orders/old-paid`)?.updatedAtMs).toBeUndefined()
  })

  it('refuses a plan without selling', async () => {
    mockEntitled = false
    expect((await post('admin', {})).status).toBe(403)
  })
})
