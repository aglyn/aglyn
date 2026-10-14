/**
 * @jest-environment node
 */
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

import type { PluginLocalDeliveryRecord } from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { createSecretBoxKey } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import { createDoordashDriveProvider } from '../providers/doordash'
import { createMemoryCourierStore } from '../testing/memory-store'
import { createMockHttp, type MockAnswer, type MockCall } from '../testing/mock-http'
import { courierRef, createEngine } from './engine'
import { createCourierRoutes, sha256, webhookAuthorized, type CourierRole } from './routes'

/**
 * The couriers console API (AGL-3695): the gate's refusal answers as is,
 * keys are validated before DoorDash is asked, the webhook token is shown
 * once, refusals keep their status, and DoorDash's webhook is verified by its
 * Authorization before anything is read.
 */

const HOST = 'host-1'
const ORDER = 'order-1'
const SECRET = randomBytes(24).toString('base64url')

const record: PluginLocalDeliveryRecord = {
  hostId: HOST,
  recordId: ORDER,
  displayRef: '#1042',
  sellerStatus: 'paid',
  status: 'scheduled',
  dispatchable: true,
  currency: 'usd',
  valueCents: 1000,
  itemCount: 1,
  pickup: { name: 'Bakery', address: { line1: '1 Main St', postalCode: '62701', country: 'US' }, phone: '+12175550100' },
  dropoff: { name: 'Ada', address: { line1: '9 Elm St', postalCode: '62704', country: 'US' }, phone: '+12175550199' },
  testMode: false,
  courier: null,
}

function setup(options: { gate?: (role: CourierRole) => Response | null; configured?: boolean } = {}) {
  const store = createMemoryCourierStore()
  const answers = {
    fn: (call: MockCall): MockAnswer => {
      if (call.url.endsWith('/quotes')) return { status: 200, body: { external_delivery_id: call.body.external_delivery_id, fee: 900, currency: 'USD' } }
      if (call.url.endsWith('/accept')) return { status: 200, body: { delivery_status: 'created' } }
      if (call.url.includes('aglyn-key-check')) return { status: 404, body: {} }
      return { status: 200, body: { delivery_status: 'created' } }
    },
  }
  const { http, calls } = createMockHttp((call) => answers.fn(call))
  const key = createSecretBoxKey(randomBytes(32).toString('base64'), 'k1')
  const writes: unknown[] = []
  const deps = {
    now: () => 1_000,
    store,
    keyring: () => ({ current: key, keys: [key] }),
    provider: () => createDoordashDriveProvider({ http, now: () => 1_000 }),
    records: () => ({
      read: async () => record,
      recordCourier: async (write: unknown) => {
        writes.push(write)
        return { outcome: 'recorded' as const, status: 'scheduled' as const }
      },
    }),
  }
  const engine = createEngine(deps)
  const activity: unknown[] = []
  const routes = createCourierRoutes({
    now: () => 1_000,
    store,
    engine,
    provider: deps.provider,
    configured: () => options.configured !== false,
    gate: async (request, role) => {
      const refused = options.gate?.(role)
      if (refused) return refused
      const body = request.method === 'GET' ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>)
      return { orgId: 'org-1', hostId: HOST, uid: 'member-1', body }
    },
    consoleAddress: (path) => `https://console.example${path}`,
    logActivity: async (input) => void activity.push(input),
  })
  return { routes, store, calls, answers, activity, writes }
}

const post = (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Request(`https://console.example/api/couriers/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ hostId: HOST, ...body }),
  })
const get = (path: string, query: Record<string, string> = {}) =>
  new Request(`https://console.example/api/couriers/${path}?${new URLSearchParams({ hostId: HOST, ...query })}`)

const keys = { developerId: 'dev-0001', keyId: 'key-0001', signingSecret: SECRET }

describe('couriers routes (AGL-3695)', () => {
  it('answers the gate’s refusal as is', async () => {
    const { routes } = setup({ gate: () => Response.json({ error: 'Couriers are not available on this deployment.' }, { status: 404 }) })
    const response = await routes.list(get('connection'))
    expect(response.status).toBe(404)
  })

  it('asks for admin to handle keys, and editor to work orders', async () => {
    const roles: CourierRole[] = []
    const { routes } = setup({
      gate: (role) => {
        roles.push(role)
        return null
      },
    })
    await routes.connect(post('connect', { live: keys }))
    await routes.disconnect(post('disconnect', {}))
    await routes.quote(post('quote', { orderId: ORDER }))
    await routes.list(get('connection'))
    expect(roles).toEqual(['admin', 'admin', 'editor', 'editor'])
  })

  it('connects, shows the webhook token once, and never answers a secret', async () => {
    const { routes, activity } = setup()
    const response = await routes.connect(post('connect', { live: keys }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.webhookToken).toEqual(expect.any(String))
    expect(body.connection).toMatchObject({
      provider: 'doordash',
      live: { configured: true, developerId: 'dev-0001', lastTestOk: true },
      test: { configured: false },
      webhookTokenSet: true,
      webhookUrl: 'https://console.example/api/couriers/webhooks/doordash?site=host-1',
    })
    expect(JSON.stringify(body)).not.toContain(SECRET)
    expect(activity).toEqual([expect.objectContaining({ action: 'connected', provider: 'doordash' })])

    const listed = await (await routes.list(get('connection'))).json()
    expect(listed.available).toBe(true)
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(JSON.stringify(listed)).not.toContain(body.webhookToken)
  })

  it('refuses malformed keys before asking DoorDash', async () => {
    const { routes, calls } = setup()
    const response = await routes.connect(post('connect', { live: { developerId: 'dev', keyId: '', signingSecret: 'x' } }))
    expect(response.status).toBe(400)
    expect(calls).toHaveLength(0)
    const none = await routes.connect(post('connect', {}))
    expect(none.status).toBe(400)
  })

  it('validates the store’s phone', async () => {
    const { routes } = setup()
    await routes.connect(post('connect', { live: keys }))
    expect((await routes.settings(post('settings', { pickupPhone: '12' }))).status).toBe(400)
    const saved = await (await routes.settings(post('settings', { pickupPhone: '(217) 555-0100', pickupNote: 'Side door' }))).json()
    expect(saved.connection).toMatchObject({ pickupPhone: '+12175550100', pickupNote: 'Side door' })
  })

  it('quotes, books with the attempt key, and refuses a missing one', async () => {
    const { routes, activity } = setup()
    await routes.connect(post('connect', { live: keys }))
    const quoted = await (await routes.quote(post('quote', { orderId: ORDER }))).json()
    expect(quoted.quote).toMatchObject({ feeCents: 900, providerLabel: 'DoorDash' })
    expect((await routes.dispatch(post('dispatch', { orderId: ORDER }))).status).toBe(400)
    const booked = await routes.dispatch(post('dispatch', { orderId: ORDER, idempotencyKey: 'attempt-0001' }))
    expect(booked.status).toBe(200)
    expect((await booked.json()).run).toMatchObject({ state: 'requested', deliveryRef: courierRef(ORDER, 1) })
    expect(activity.at(-1)).toMatchObject({ action: 'dispatched', orderId: ORDER })
    const order = await (await routes.order(get('order', { orderId: ORDER }))).json()
    expect(order.run.state).toBe('requested')
  })

  it('refuses a disconnect while a courier is out', async () => {
    const { routes } = setup()
    await routes.connect(post('connect', { live: keys }))
    await routes.quote(post('quote', { orderId: ORDER }))
    await routes.dispatch(post('dispatch', { orderId: ORDER, idempotencyKey: 'attempt-0001' }))
    expect((await routes.disconnect(post('disconnect', {}))).status).toBe(409)
  })

  it('refuses a bad order id and a wrong method', async () => {
    const { routes } = setup()
    expect((await routes.quote(post('quote', { orderId: '__x__' }))).status).toBe(400)
    expect((await routes.quote(get('quote', { orderId: ORDER }))).status).toBe(405)
  })
})

describe('DoorDash’s webhook (AGL-3695)', () => {
  async function bookedSetup() {
    const context = setup()
    const connected = await (await context.routes.connect(post('connect', { live: keys }))).json()
    await context.routes.quote(post('quote', { orderId: ORDER }))
    await context.routes.dispatch(post('dispatch', { orderId: ORDER, idempotencyKey: 'attempt-0001' }))
    return { ...context, token: connected.webhookToken as string }
  }

  const hook = (body: unknown, authorization?: string, site = HOST) =>
    new Request(`https://console.example/api/couriers/webhooks/doordash?site=${site}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { authorization } : {}) },
      body: JSON.stringify(body),
    })

  const pickedUp = {
    event_name: 'DASHER_PICKED_UP',
    created_at: '2026-10-08T15:30:00Z',
    external_delivery_id: courierRef(ORDER, 1),
    tracking_url: 'https://doordash.com/t/1',
  }

  it('refuses a call without the merchant’s token, reading nothing', async () => {
    const { routes, store } = await bookedSetup()
    expect((await routes.webhookDoordash(hook(pickedUp))).status).toBe(401)
    expect((await routes.webhookDoordash(hook(pickedUp, 'Basic wrong'))).status).toBe(401)
    expect((await routes.webhookDoordash(hook(pickedUp, 'x', 'other-host'))).status).toBe(401)
    expect(store.delivery(HOST, ORDER)?.run?.state).toBe('requested')
  })

  it('applies a verified event once, with or without the Basic scheme', async () => {
    const { routes, store, token, writes } = await bookedSetup()
    const first = await routes.webhookDoordash(hook(pickedUp, token))
    expect(await first.json()).toEqual({ ok: true, result: 'applied' })
    expect(store.delivery(HOST, ORDER)?.run?.state).toBe('picked_up')
    const count = writes.length
    const again = await routes.webhookDoordash(hook(pickedUp, `Basic ${token}`))
    expect(await again.json()).toEqual({ ok: true, result: 'duplicate' })
    expect(writes).toHaveLength(count)
  })

  it('acknowledges an event for a run it did not book', async () => {
    const { routes, token } = await bookedSetup()
    const response = await routes.webhookDoordash(hook({ event_name: 'DASHER_PICKED_UP', external_delivery_id: 'not-ours' }, token))
    expect(await response.json()).toEqual({ ok: true, result: 'ignored' })
  })

  it('does not exist on a deployment without the key', async () => {
    const { routes } = setup({ configured: false })
    expect((await routes.webhookDoordash(hook(pickedUp, 'x'))).status).toBe(404)
  })

  it('compares tokens by hash', () => {
    expect(webhookAuthorized('abc', sha256('abc'))).toBe(true)
    expect(webhookAuthorized('Bearer abc', sha256('abc'))).toBe(true)
    expect(webhookAuthorized('abd', sha256('abc'))).toBe(false)
    expect(webhookAuthorized('', sha256(''))).toBe(false)
    expect(webhookAuthorized('abc', null)).toBe(false)
  })
})
