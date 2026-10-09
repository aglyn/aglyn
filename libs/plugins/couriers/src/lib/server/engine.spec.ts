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

import type {
  PluginLocalDeliveryRecord,
  PluginLocalDeliveryRecords,
  PluginRecordCourierWrite,
} from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { createSecretBoxKey, parseSecretBoxKeyring, type SecretBoxKeyring } from '@aglyn/shared-util-tools/secret-box'
import { randomBytes } from 'node:crypto'
import { createDoordashDriveProvider } from '../providers/doordash'
import type { CourierKeys } from '../providers/provider'
import { createMemoryCourierStore, type MemoryCourierStore } from '../testing/memory-store'
import { createMockHttp, type MockAnswer, type MockCall } from '../testing/mock-http'
import { courierRef, courierStepAllowed, createEngine, orderIdOfRef, sellerStep, type CourierRefusal } from './engine'
import { onOrderCancelled, onOrderRefunded } from './intake'
import { runCouriersTick } from './job'
import type { StoredRun } from './store'

/**
 * The courier engine (AGL-3695), driven end to end against an in-memory
 * store, a fake seller and DoorDash Drive's adapter over mocked HTTP: one run
 * per order, a retried booking never books twice, steps only go forward, a
 * redelivered webhook is a no-op, and the seller hears each step it owes.
 */

const HOST = 'host-1'
const ORG = 'org-1'
const ORDER = 'order-1'
const LIVE: CourierKeys = { developerId: 'dev-live', keyId: 'key-live', signingSecret: randomBytes(24).toString('base64url') }
const TEST: CourierKeys = { developerId: 'dev-test', keyId: 'key-test', signingSecret: randomBytes(24).toString('base64url') }

function keyring(): SecretBoxKeyring {
  const key = createSecretBoxKey(randomBytes(32).toString('base64'), 'k1')
  return { current: key, keys: [key] }
}

function record(overrides: Partial<PluginLocalDeliveryRecord> = {}): PluginLocalDeliveryRecord {
  return {
    hostId: HOST,
    recordId: ORDER,
    displayRef: '#1042',
    sellerStatus: 'paid',
    status: 'scheduled',
    dispatchable: true,
    currency: 'usd',
    valueCents: 1000,
    itemCount: 2,
    pickup: {
      name: 'Northwind Bakery',
      address: { line1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
      phone: '+12175550100',
    },
    dropoff: {
      name: 'Ada Lovelace',
      address: { line1: '9 Elm St', city: 'Springfield', state: 'IL', postalCode: '62704', country: 'US' },
      phone: '+12175550199',
    },
    testMode: false,
    courier: null,
    ...overrides,
  }
}

interface Harness {
  store: MemoryCourierStore
  engine: ReturnType<typeof createEngine>
  calls: MockCall[]
  writes: PluginRecordCourierWrite[]
  setRecord(next: PluginLocalDeliveryRecord | null): void
  setNow(ms: number): void
  respond: { fn: (call: MockCall) => MockAnswer }
}

const quoteBody = (ref: string) => ({
  external_delivery_id: ref,
  delivery_status: 'quote',
  fee: 975,
  currency: 'USD',
  dropoff_time_estimated: '2026-10-08T15:45:00Z',
})

function harness(): Harness {
  const store = createMemoryCourierStore()
  let current: PluginLocalDeliveryRecord | null = record()
  let now = 1_000_000
  const writes: PluginRecordCourierWrite[] = []
  const respond = {
    fn: (call: MockCall): MockAnswer => {
      if (call.url.endsWith('/quotes')) return { status: 200, body: quoteBody(call.body.external_delivery_id) }
      if (call.url.endsWith('/accept')) {
        const ref = call.url.split('/quotes/')[1].split('/')[0]
        return { status: 200, body: { external_delivery_id: ref, delivery_status: 'created', fee: 975, tracking_url: 'https://doordash.com/t/1' } }
      }
      if (call.url.endsWith('/cancel')) return { status: 200, body: { delivery_status: 'cancelled' } }
      if (call.url.includes('/deliveries/aglyn-key-check')) return { status: 404, body: {} }
      return { status: 200, body: { delivery_status: 'enroute_to_pickup' } }
    },
  }
  const { http, calls } = createMockHttp((call) => respond.fn(call))
  const ring = keyring()
  const records: PluginLocalDeliveryRecords = {
    read: async () => current,
    recordCourier: async (write) => {
      writes.push(write)
      return { outcome: 'recorded', status: write.move ?? 'scheduled' }
    },
  }
  const engine = createEngine({
    now: () => now,
    store,
    provider: () => createDoordashDriveProvider({ http, now: () => now }),
    keyring: () => ring,
    records: () => records,
  })
  return {
    store,
    engine,
    calls,
    writes,
    setRecord: (next) => {
      current = next
    },
    setNow: (ms) => {
      now = ms
    },
    respond,
  }
}

async function connect(h: Harness, keys: Partial<Record<'live' | 'test', CourierKeys>> = { live: LIVE, test: TEST }) {
  return h.engine.connect({
    orgId: ORG,
    hostId: HOST,
    uid: 'admin-1',
    provider: 'doordash',
    keys,
    newWebhookToken: () => ({ token: 'tok', hash: 'hash' }),
  })
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a refusal')
    },
    (error: CourierRefusal) => ({ status: error.status, message: error.message }),
  )

describe('connecting (AGL-3695)', () => {
  it('tests each key with DoorDash, then seals it; the secret is never stored in the clear', async () => {
    const h = harness()
    const { connection, webhookToken } = await connect(h)
    expect(webhookToken).toBe('tok')
    expect(connection.live?.lastTestOk).toBe(true)
    const stored = JSON.stringify([...h.store.connections.values()])
    expect(stored).not.toContain(LIVE.signingSecret)
    expect(stored).not.toContain(TEST.signingSecret)
    expect(h.calls.filter((call) => call.url.includes('aglyn-key-check'))).toHaveLength(2)
  })

  it('refuses a key DoorDash refuses, and stores nothing', async () => {
    const h = harness()
    h.respond.fn = () => ({ status: 401, body: { message: 'bad key' } })
    await expect(refusal(connect(h))).resolves.toMatchObject({ status: 400 })
    expect(h.store.connections.size).toBe(0)
  })

  it('keeps the other mode’s key and the webhook token when one key is replaced', async () => {
    const h = harness()
    await connect(h)
    const { connection, webhookToken } = await connect(h, { test: TEST })
    expect(webhookToken).toBeNull()
    expect(connection.live?.developerId).toBe('dev-live')
    expect(connection.webhookTokenHash).toBe('hash')
  })
})

describe('quoting and booking (AGL-3695)', () => {
  it('quotes under a fresh reference, then books it once', async () => {
    const h = harness()
    await connect(h)
    const quoted = await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    expect(quoted.quote).toMatchObject({ feeCents: 975, currency: 'usd', testMode: false })
    const quoteCall = h.calls.find((call) => call.url.endsWith('/quotes'))
    expect(quoteCall?.body.external_delivery_id).toBe(courierRef(ORDER, 1))
    // Signed with the LIVE key: the order was paid live.
    const payload = JSON.parse(Buffer.from(quoteCall!.headers['Authorization'].split('.')[1], 'base64url').toString())
    expect(payload.iss).toBe('dev-live')

    const booked = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
    expect(booked.run).toMatchObject({ state: 'requested', pending: false, trackingUrl: 'https://doordash.com/t/1', feeCents: 975 })
    expect(booked.quote).toBeNull()
    expect(h.writes.at(-1)).toMatchObject({ courier: { state: 'requested', deliveryRef: courierRef(ORDER, 1) } })
    expect(h.writes.at(-1)?.move).toBeUndefined()

    // The same attempt again answers the same run and books nothing.
    const again = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
    expect(again.run?.deliveryRef).toBe(courierRef(ORDER, 1))
    expect(h.calls.filter((call) => call.url.endsWith('/accept'))).toHaveLength(1)

    // Another attempt, and another quote, are refused while the courier is out.
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0002' }))).resolves.toEqual({
      status: 409,
      message: 'A courier is already on this order.',
    })
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toMatchObject({ status: 409 })
  })

  it('books two racing attempts only once', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const results = await Promise.allSettled([
      h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-aaaa' }),
      h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-bbbb' }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(h.calls.filter((call) => call.url.endsWith('/accept'))).toHaveLength(1)
  })

  it('refuses a quote that expired', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    h.setNow(1_000_000 + 5 * 60 * 1000 + 1)
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))).resolves.toEqual({
      status: 409,
      message: 'That quote expired. Get a new one.',
    })
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))).resolves.toMatchObject({
      status: 409,
    })
  })

  it('refuses without a quote, and for a drop the seller will not hand over', async () => {
    const h = harness()
    await connect(h)
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))).resolves.toEqual({
      status: 409,
      message: 'Get a quote first.',
    })
    h.setRecord(record({ dispatchable: false, sellerStatus: 'refunded' }))
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toEqual({ status: 409, message: 'A courier can’t be sent for an order that is refunded.' })
    h.setRecord(record({ dropoff: { ...record().dropoff!, phone: undefined } }))
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toEqual({ status: 409, message: 'This order has no phone number for the courier to call.' })
    h.setRecord(record({ pickup: null }))
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toMatchObject({ status: 409 })
    h.setRecord(null)
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toMatchObject({ status: 404 })
  })

  it('uses the test key for a test-mode order, and refuses when there is none', async () => {
    const h = harness()
    await connect(h, { live: LIVE })
    h.setRecord(record({ testMode: true }))
    await expect(
      refusal(h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toMatchObject({ status: 409, message: expect.stringContaining('test keys') })
    await connect(h, { test: TEST })
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const quoteCall = h.calls.filter((call) => call.url.endsWith('/quotes')).at(-1)
    const payload = JSON.parse(Buffer.from(quoteCall!.headers['Authorization'].split('.')[1], 'base64url').toString())
    expect(payload.iss).toBe('dev-test')
    const booked = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
    expect(booked.run?.testMode).toBe(true)
  })

  it('fills the store’s phone and note when the location has none', async () => {
    const h = harness()
    await connect(h)
    await h.store.patchConnection(`${HOST}_doordash`, { pickupPhone: '+12175550111', pickupNote: 'Side door' })
    h.setRecord(record({ pickup: { ...record().pickup!, phone: undefined } }))
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const body = h.calls.find((call) => call.url.endsWith('/quotes'))!.body
    expect(body.pickup_phone_number).toBe('+12175550111')
    expect(body.pickup_instructions).toBe('Side door')
  })

  it('keeps a booking whose answer was lost pending, and the job settles it', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const base = h.respond.fn
    h.respond.fn = (call) => (call.url.endsWith('/accept') ? 'network-error' : base(call))
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))).resolves.toMatchObject({
      status: 502,
      message: expect.stringContaining('Don’t book again'),
    })
    expect(h.store.delivery(HOST, ORDER)?.run).toMatchObject({ pending: true, state: 'requested' })
    // The console retries with the same key: the claimed run, no second booking.
    const retried = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
    expect(retried.run?.pending).toBe(true)

    // The job asks DoorDash for the reference and adopts what it finds.
    h.respond.fn = base
    h.setNow(1_000_000 + 2 * 60 * 1000)
    const counts = await runCouriersTick({ engine: h.engine, store: h.store, now: () => 1_000_000 + 2 * 60 * 1000 }, { deadlineMs: Number.MAX_SAFE_INTEGER })
    expect(counts.settled).toBe(1)
    expect(h.store.delivery(HOST, ORDER)?.run).toMatchObject({ pending: false, state: 'assigned' })
    expect(h.calls.filter((call) => call.url.endsWith('/accept'))).toHaveLength(1)
  })

  it('releases a lost booking DoorDash never got', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const base = h.respond.fn
    h.respond.fn = (call) => (call.url.endsWith('/accept') ? 'network-error' : base(call))
    await refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))
    h.respond.fn = (call) => (call.method === 'GET' ? { status: 404, body: {} } : base(call))
    await runCouriersTick({ engine: h.engine, store: h.store, now: () => 2_000_000 }, { deadlineMs: Number.MAX_SAFE_INTEGER })
    const delivery = h.store.delivery(HOST, ORDER)
    expect(delivery?.run).toBeNull()
    expect(delivery?.open).toBe(false)
    expect(delivery?.history[0]).toMatchObject({ state: 'cancelled', reason: 'The booking never reached the courier' })
  })

  it('adopts the run DoorDash already holds when the reference was booked before', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const base = h.respond.fn
    h.respond.fn = (call) =>
      call.url.endsWith('/accept') ? { status: 409, body: { message: 'Duplicate delivery ID' } } : base(call)
    const booked = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
    expect(booked.run).toMatchObject({ pending: false, state: 'assigned' })
  })

  it('releases the claim when DoorDash refuses the booking', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const base = h.respond.fn
    h.respond.fn = (call) =>
      call.url.endsWith('/accept') ? { status: 400, body: { message: 'Quote has expired' } } : base(call)
    await expect(refusal(h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' }))).resolves.toEqual({
      status: 409,
      message: 'DoorDash did not book a courier: Quote has expired',
    })
    const delivery = h.store.delivery(HOST, ORDER)
    expect(delivery?.run).toBeNull()
    expect(delivery?.open).toBe(false)
    // A new quote gets a new reference.
    h.respond.fn = base
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    expect(h.store.delivery(HOST, ORDER)?.quote?.deliveryRef).toBe(courierRef(ORDER, 2))
  })
})

async function booked(h: Harness) {
  await connect(h)
  await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
  await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0001' })
  h.writes.length = 0
}

const event = (state: StoredRun['state'] | null, key: string, extra: Record<string, unknown> = {}) => ({
  deliveryRef: courierRef(ORDER, 1),
  state,
  trackingUrl: null,
  etaMs: null,
  pickupEtaMs: null,
  feeCents: null,
  currency: null,
  reason: null,
  eventKey: key,
  ...extra,
})

describe('following the courier (AGL-3695)', () => {
  it('takes the delivery out the door at pickup and delivers it at the drop, once each', async () => {
    const h = harness()
    await booked(h)
    await h.engine.applySnapshot(HOST, ORDER, event('assigned', 'e1'), { eventKey: 'e1' })
    expect(h.writes.at(-1)?.move).toBeUndefined()
    await h.engine.applySnapshot(HOST, ORDER, event('picked_up', 'e2', { etaMs: 9_000_000 }), { eventKey: 'e2' })
    expect(h.writes.at(-1)).toMatchObject({ move: 'out_for_delivery', courier: { state: 'picked_up', etaMs: 9_000_000 } })
    // Redelivered: nothing.
    const writes = h.writes.length
    await expect(h.engine.applySnapshot(HOST, ORDER, event('picked_up', 'e2'), { eventKey: 'e2' })).resolves.toBe('duplicate')
    expect(h.writes).toHaveLength(writes)
    // Out of order: a late "assigned" never moves it back.
    await h.engine.applySnapshot(HOST, ORDER, event('assigned', 'e0'), { eventKey: 'e0' })
    expect(h.store.delivery(HOST, ORDER)?.run?.state).toBe('picked_up')
    await h.engine.applySnapshot(HOST, ORDER, event('delivered', 'e3'), { eventKey: 'e3' })
    expect(h.writes.at(-1)).toMatchObject({ move: 'delivered' })
    const delivery = h.store.delivery(HOST, ORDER)
    expect(delivery?.open).toBe(false)
    // Nothing leaves "delivered".
    await h.engine.applySnapshot(HOST, ORDER, event('cancelled', 'e4'), { eventKey: 'e4' })
    expect(h.store.delivery(HOST, ORDER)?.run?.state).toBe('delivered')
  })

  it('fails the delivery with DoorDash’s reason when DoorDash cancels it', async () => {
    const h = harness()
    await booked(h)
    await h.engine.applySnapshot(HOST, ORDER, event('cancelled', 'e1', { reason: 'No Dasher could take it' }), { eventKey: 'e1' })
    expect(h.writes.at(-1)).toMatchObject({
      move: 'failed',
      reason: 'DoorDash canceled the delivery: No Dasher could take it',
      courier: { state: 'cancelled', reason: 'No Dasher could take it' },
    })
  })

  it('fails the delivery when the courier brings it back', async () => {
    const h = harness()
    await booked(h)
    await h.engine.applySnapshot(HOST, ORDER, event('picked_up', 'e1'), { eventKey: 'e1' })
    await h.engine.applySnapshot(HOST, ORDER, event('returning', 'e2', { reason: 'customer unavailable' }), { eventKey: 'e2' })
    expect(h.writes.at(-1)).toMatchObject({ move: 'failed', reason: 'DoorDash is bringing it back: customer unavailable' })
  })

  it('ignores an event for a run that is not the order’s current one', async () => {
    const h = harness()
    await booked(h)
    await expect(
      h.engine.applySnapshot(HOST, ORDER, { ...event('delivered', 'x'), deliveryRef: courierRef(ORDER, 7) }, { eventKey: 'x' }),
    ).resolves.toBe('stale')
  })

  it('lets the store call the courier off without failing the delivery', async () => {
    const h = harness()
    await booked(h)
    const view = await h.engine.cancel({ hostId: HOST, orderId: ORDER, reason: 'Canceled by the store', byStore: true })
    expect(view.run).toMatchObject({ state: 'cancelled' })
    expect(h.calls.at(-1)).toMatchObject({ method: 'PUT' })
    expect(h.writes.at(-1)?.move).toBeUndefined()
    expect(h.writes.at(-1)?.courier?.state).toBe('cancelled')
    // A new courier can be quoted and booked after.
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    const again = await h.engine.dispatch({ hostId: HOST, orderId: ORDER, uid: 'u', idempotencyKey: 'attempt-0002' })
    expect(again.run?.deliveryRef).toBe(courierRef(ORDER, 2))
    expect(again.history[0]?.state).toBe('cancelled')
  })

  it('reports DoorDash refusing to cancel', async () => {
    const h = harness()
    await booked(h)
    const base = h.respond.fn
    h.respond.fn = (call) => (call.url.endsWith('/cancel') ? { status: 400, body: { message: 'Dasher has picked up' } } : base(call))
    await expect(refusal(h.engine.cancel({ hostId: HOST, orderId: ORDER, reason: 'x', byStore: true }))).resolves.toEqual({
      status: 409,
      message: 'DoorDash did not cancel the courier: Dasher has picked up',
    })
    expect(h.store.delivery(HOST, ORDER)?.run?.state).toBe('requested')
  })
})

describe('refunds and cancels call the courier off (AGL-3695)', () => {
  const envelope = (extra: Record<string, unknown> = {}) => ({
    id: 'evt-1',
    hostId: HOST,
    orgId: ORG,
    occurredAtMs: 1,
    payload: { order: { id: ORDER }, ...extra },
  })

  it('marks the run on a canceled order, and the job cancels it at DoorDash without failing the delivery', async () => {
    const h = harness()
    await booked(h)
    await onOrderCancelled({ store: h.store, now: () => 2 }, envelope() as never)
    expect(h.store.delivery(HOST, ORDER)?.run).toMatchObject({ cancelRequested: true, cancelReason: 'The order was canceled' })
    const counts = await runCouriersTick({ engine: h.engine, store: h.store, now: () => 3 }, { deadlineMs: Number.MAX_SAFE_INTEGER })
    expect(counts.cancelled).toBe(1)
    expect(h.store.delivery(HOST, ORDER)?.run?.state).toBe('cancelled')
    expect(h.writes.at(-1)?.move).toBeUndefined()
    // A second event is a no-op.
    await onOrderCancelled({ store: h.store, now: () => 4 }, envelope() as never)
    expect(h.calls.filter((call) => call.url.endsWith('/cancel'))).toHaveLength(1)
  })

  it('calls the courier off on a full refund only', async () => {
    const h = harness()
    await booked(h)
    await onOrderRefunded({ store: h.store, now: () => 2 }, envelope({ refund: { full: false } }) as never)
    expect(h.store.delivery(HOST, ORDER)?.run?.cancelRequested).toBe(false)
    await onOrderRefunded({ store: h.store, now: () => 2 }, envelope({ refund: { full: true } }) as never)
    expect(h.store.delivery(HOST, ORDER)?.run).toMatchObject({ cancelRequested: true, cancelReason: 'The order was refunded' })
  })

  it('drops an open quote when the order is canceled', async () => {
    const h = harness()
    await connect(h)
    await h.engine.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })
    await onOrderCancelled({ store: h.store, now: () => 2 }, envelope() as never)
    expect(h.store.delivery(HOST, ORDER)?.quote).toBeNull()
  })
})

describe('rules (AGL-3695)', () => {
  it('only steps forward, and never out of a final state', () => {
    expect(courierStepAllowed('requested', 'assigned')).toBe(true)
    expect(courierStepAllowed('picked_up', 'assigned')).toBe(false)
    expect(courierStepAllowed('assigned', 'cancelled')).toBe(true)
    expect(courierStepAllowed('delivered', 'cancelled')).toBe(false)
    expect(courierStepAllowed('picked_up', 'returning')).toBe(true)
  })

  it('reads the order back from our reference only', () => {
    expect(orderIdOfRef(courierRef('abc-def', 3))).toBe('abc-def')
    expect(orderIdOfRef('someone-else')).toBeNull()
  })

  it('never fails a delivery the store or a refund called off', () => {
    const base = { provider: 'doordash', state: 'cancelled', reason: null, cancelRequested: false, cancelledByStore: true } as unknown as StoredRun
    expect(sellerStep('requested', base)).toEqual({})
    expect(sellerStep('requested', { ...base, cancelledByStore: false, cancelRequested: true })).toEqual({})
    expect(sellerStep('requested', { ...base, cancelledByStore: false })).toMatchObject({ move: 'failed' })
  })

  it('opens keys only with the key they were sealed under', async () => {
    const h = harness()
    await connect(h)
    const other = createEngine({
      now: () => 1,
      store: h.store,
      provider: () => createDoordashDriveProvider({ http: createMockHttp(() => ({ status: 200, body: {} })).http }),
      keyring: () => parseSecretBoxKeyring(randomBytes(32).toString('base64')),
      records: () => ({ read: async () => record(), recordCourier: async () => ({ outcome: 'unchanged', status: 'scheduled' }) }),
    })
    await expect(
      refusal(other.quote({ orgId: ORG, hostId: HOST, orderId: ORDER, uid: 'u', provider: 'doordash' })),
    ).resolves.toMatchObject({ status: 409, message: expect.stringContaining('can no longer be read') })
  })
})
