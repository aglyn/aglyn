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
 * The console's side of the ShipStation connection (AGL-3613): who may mint,
 * show, rotate and revoke the credentials, that the password is stored only
 * sealed with the secret box (bound to its site), and that `connect` stamps
 * the open orders that predate the feed's fields.
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
const mockActivity = jest.fn(async (..._args: unknown[]) => undefined)
let mockEntitled = true

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ auth: () => ({ verifyIdToken: (token: string) => mockVerify(token) }), firestore: () => fakeFirestore }) },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  logHostActivity: (...args: unknown[]) => mockActivity(...args),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => mockEntitled,
}))

import { openShipStationPassword, SHIPSTATION_CONNECTIONS } from './shipstation'
import { readCommerceSecretKeyring } from './order-webhooks'
import { shippingConnectorsHandler } from './shipping-connectors'

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
  await shippingConnectorsHandler(req, res)
  return result
}

async function status(uid: string) {
  const { res, result } = respond()
  await shippingConnectorsHandler(
    { method: 'GET', query: { hostId: HOST }, body: undefined, headers: { authorization: `Bearer ${uid}` }, cookies: {}, socket: {} } as never,
    res,
  )
  return result
}

const connection = () => docs.get(`${SHIPSTATION_CONNECTIONS}/${HOST}`)

const savedEnv = { ...process.env }
afterAll(() => {
  process.env = savedEnv
})

const opened = (stored: any) => openShipStationPassword(stored, readCommerceSecretKeyring())?.password

beforeEach(() => {
  process.env['TOKEN_SIGNING_SECRET'] = 'test-token-signing-secret'
  delete process.env['COMMERCE_SECRET_KEY']
  docs.clear()
  mockActivity.mockClear()
  mockEntitled = true
  docs.set(`hosts/${HOST}`, { memberRoles: { admin: 'admin', editor: 'editor', author: 'author' } })
})

describe('connect, show, rotate, disconnect', () => {
  it('lets an admin connect, answers the password, and stores it only sealed', async () => {
    docs.set(`hosts/${HOST}/orders/old-paid`, { status: 'paid', createdAtMs: 7, lineItems: [{ productId: 'p', name: 'Mug', quantity: 1, unitAmountCents: 1 }] })
    const result = await post('admin', { action: 'connect' })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ available: true, connected: true, username: expect.stringMatching(/^aglyn-[0-9a-f]{12}$/) })
    expect(result.body.password.length).toBeGreaterThanOrEqual(32)
    const stored = connection()
    expect(stored?.sealedPassword).toMatch(/^sb1\./)
    expect(stored?.passwordKeyId).toBe('tss1')
    expect(stored?.passwordHash).toBeUndefined()
    expect(JSON.stringify(stored)).not.toContain(result.body.password)
    expect(opened(stored)).toBe(result.body.password)
    expect(mockActivity).toHaveBeenCalledWith(HOST, expect.objectContaining({ uid: 'admin' }), 'Connected ShipStation', expect.any(Object))
    // The open orders written before the feed's fields are stamped on connect.
    expect(docs.get(`hosts/${HOST}/orders/old-paid`)).toMatchObject({ requiresShipping: true, updatedAtMs: 7 })
    const read = await status('editor')
    expect(read.body).toEqual({ available: true, connected: true, username: stored?.username, createdAtMs: stored?.createdAtMs })
    expect(read.body.password).toBeUndefined()
  })

  it('a sealed password copied onto another site opens for no one', async () => {
    await post('admin', { action: 'connect' })
    const stored = connection()
    expect(opened({ ...stored, hostId: 'host-2' })).toBeUndefined()
  })

  it('shows the password again to an admin only, and logs it', async () => {
    const made = await post('admin', { action: 'connect' })
    const shown = await post('admin', { action: 'reveal' })
    expect(shown.status).toBe(200)
    expect(shown.body.password).toBe(made.body.password)
    expect(mockActivity).toHaveBeenCalledWith(HOST, expect.anything(), 'Showed the ShipStation password', expect.any(Object))
    expect((await post('editor', { action: 'reveal' })).status).toBe(403)
  })

  it('refuses an editor, an author and a stranger, and writes nothing', async () => {
    for (const uid of ['editor', 'author', 'stranger']) {
      const result = await post(uid, { action: 'connect' })
      expect(result.status).toBe(403)
    }
    expect((await post(null, { action: 'connect' })).status).toBe(401)
    expect((await post('admin', { action: 'status' })).status).toBe(400)
    expect((await post('admin', { action: 'drop-tables' })).status).toBe(400)
    expect(connection()).toBeUndefined()
  })

  it('refuses a second connect, and rotates to a new password that ends the old one', async () => {
    const first = await post('admin', { action: 'connect' })
    expect((await post('admin', { action: 'connect' })).status).toBe(409)
    docs.set(`${SHIPSTATION_CONNECTIONS}/${HOST}`, { ...connection(), exportCursor: { key: 'k', page: 1, after: [1, 'a'] }, passwordHash: 'f'.repeat(64) })
    const rotated = await post('admin', { action: 'rotate' })
    expect(rotated.status).toBe(200)
    expect(rotated.body.password).not.toBe(first.body.password)
    expect(rotated.body.username).toBe(first.body.username)
    expect(opened(connection())).toBe(rotated.body.password)
    expect(connection()?.rotatedAtMs).toBeGreaterThan(0)
    expect(connection()?.exportCursor).toBeUndefined()
    expect(connection()?.passwordHash).toBeUndefined()
  })

  it('disconnects, and a rotate or show after that is refused', async () => {
    await post('admin', { action: 'connect' })
    expect((await post('admin', { action: 'disconnect' })).body).toEqual({ available: true, connected: false })
    expect(connection()).toBeUndefined()
    expect((await post('admin', { action: 'rotate' })).status).toBe(409)
    expect((await post('admin', { action: 'reveal' })).status).toBe(409)
  })

  it('refuses a plan without selling', async () => {
    mockEntitled = false
    expect((await post('admin', { action: 'connect' })).status).toBe(403)
    expect(connection()).toBeUndefined()
  })

  it('says it is unavailable, and mints nothing, on a deployment with no keyring', async () => {
    delete process.env['TOKEN_SIGNING_SECRET']
    expect((await status('admin')).body).toEqual({ available: false, connected: false })
    expect((await post('admin', { action: 'connect' })).status).toBe(503)
    expect(connection()).toBeUndefined()
  })
})

describe('the ShippingEasy card through the same door (AGL-3633)', () => {
  it('lets an editor read the status and only an admin change it', async () => {
    const { res, result } = respond()
    await shippingConnectorsHandler(
      {
        method: 'GET',
        query: { hostId: HOST, connector: 'shippingeasy' },
        body: undefined,
        headers: { authorization: 'Bearer editor' },
        cookies: {},
        socket: {},
      } as never,
      res,
    )
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ available: true, connected: false })

    const editor = await post('editor', { connector: 'shippingeasy', action: 'sync' })
    expect(editor.status).toBe(403)
    expect(editor.body.error).toMatch(/ShippingEasy/)
    const author = await post('author', { connector: 'shippingeasy', action: 'disconnect' })
    expect(author.status).toBe(403)
  })

  it('refuses an unknown connector and an action the connector does not have', async () => {
    expect((await post('admin', { connector: 'shipbob', action: 'connect' })).status).toBe(400)
    expect((await post('admin', { connector: 'shippingeasy', action: 'reveal' })).status).toBe(400)
    expect((await post('admin', { connector: 'shipstation', action: 'sync' })).status).toBe(400)
  })

  it('refuses a site whose plan has no commerce', async () => {
    mockEntitled = false
    expect((await post('admin', { connector: 'shippingeasy', action: 'disconnect' })).status).toBe(403)
  })
})
