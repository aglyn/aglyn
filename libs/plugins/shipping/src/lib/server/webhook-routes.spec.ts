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

import {
  registerPluginShipmentRecords,
  type PluginShipmentRecords,
  type PluginTrackingUpdate,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { createHmac, randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setShippingDbForTests } from './db'
import { setLabelBillingFetchForTests } from './label-billing'
import { trackerDocId } from './trackers'
import { easypostWebhookRoute, shippoWebhookRoute } from './webhook-routes'

/**
 * The providers' webhook doors, end to end: a request is refused before its
 * payload is read unless it proves itself, a verified tracking event moves
 * the seller's order forward once, an event of the other mode is
 * acknowledged and ignored, and a refund event settles the label's void —
 * once, and never walking a voided label back.
 */

let db: MemoryFirestore
const ORG = 'org-candles'

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => db }) },
}))

const stripeCalls: string[] = []
const stripeFetch = (async (url: string) => {
  stripeCalls.push(new URL(String(url)).pathname)
  return new Response(JSON.stringify({ id: 're_1' }), { status: 200 })
}) as typeof fetch

const tracking: PluginTrackingUpdate[] = []
const SELLER: PluginShipmentRecords = {
  read: async () => null,
  recordShipment: async () => ({ outcome: 'recorded', shipmentId: 'ful-1' }),
  recordTracking: async (update) => {
    tracking.push(update)
    return { outcome: 'recorded' }
  },
  shipFromAddresses: async () => [],
}

const SHIPPO_TOKEN = 'tok_shippo_webhook'
const EASYPOST_SECRET = 'ep_webhook_secret'

function shippoEvent(status: string, date: string, test = false) {
  return JSON.stringify({
    event: 'track_updated',
    test,
    data: { carrier: 'usps', tracking_number: '9400111', tracking_status: { status, status_details: status, status_date: date } },
  })
}

function post(route: (request: Request) => Promise<Response>, body: string, query = '', headers: Record<string, string> = {}) {
  return route(new Request(`https://console.example.com/api/shipping/webhooks/x${query}`, { method: 'POST', body, headers }))
}

const signEasypost = (body: string) =>
  `hmac-sha256-hex=${createHmac('sha256', EASYPOST_SECRET.normalize('NFKD')).update(body).digest('hex')}`

beforeEach(async () => {
  db = createMemoryFirestore()
  setShippingDbForTests(db)
  setLabelBillingFetchForTests(stripeFetch)
  stripeCalls.length = 0
  tracking.length = 0
  process.env['SHIPPO_API_TOKEN'] = 'shippo_live_platform'
  process.env['SHIPPING_TOKEN_KEY'] = randomBytes(32).toString('base64')
  process.env['SHIPPO_WEBHOOK_TOKEN'] = SHIPPO_TOKEN
  process.env['EASYPOST_WEBHOOK_SECRET'] = EASYPOST_SECRET
  resetPluginServicesForTests()
  registerPluginShipmentRecords(SELLER, { pluginId: 'seller' })
  await db.collection('shippingTrackers').doc(trackerDocId('shippo', '9400111')).set({
    orgId: ORG,
    hostId: 'host-candles',
    recordId: 'order-1',
    labelId: 'lbl_1',
    providerId: 'shippo',
    carrier: 'usps',
    trackingNumber: '9400111',
    kind: 'outbound',
    createdAtMs: 1,
  })
  await db.collection('shippingTrackers').doc(trackerDocId('easypost', 'EZ1')).set({
    orgId: ORG,
    hostId: 'host-candles',
    recordId: 'order-2',
    labelId: 'lbl_2',
    providerId: 'easypost',
    carrier: 'USPS',
    trackingNumber: 'EZ1',
    kind: 'outbound',
    createdAtMs: 1,
  })
  await db.collection('orgs').doc(ORG).collection('shippingLabels').doc('lbl_2').set({
    labelId: 'lbl_2',
    status: 'void_pending',
    billing: { method: 'account_debit', state: 'charged', chargeCents: 625, markupPct: 0, currency: 'usd', month: '2026-10', stripePaymentId: 'py_1' },
  })
})

afterAll(() => {
  setShippingDbForTests(null)
  setLabelBillingFetchForTests(null)
})

describe('the Shippo webhook', () => {
  it('refuses a GET, an unconfigured door and a wrong token before reading the payload', async () => {
    expect((await shippoWebhookRoute(new Request('https://console.example.com/x', { method: 'GET' }))).status).toBe(405)
    expect((await post(shippoWebhookRoute, shippoEvent('DELIVERED', '2026-10-06T10:00:00Z'), '?token=wrong')).status).toBe(401)
    delete process.env['SHIPPO_WEBHOOK_TOKEN']
    expect((await post(shippoWebhookRoute, shippoEvent('DELIVERED', '2026-10-06T10:00:00Z'), `?token=${SHIPPO_TOKEN}`)).status).toBe(404)
    expect(tracking).toHaveLength(0)
  })

  it('moves the order forward once, ignores a redelivery and never walks a parcel back', async () => {
    const transit = await post(shippoWebhookRoute, shippoEvent('TRANSIT', '2026-10-05T10:00:00Z'), `?token=${SHIPPO_TOKEN}`)
    expect(await transit.json()).toEqual({ ok: true, applied: { recorded: 1 } })
    const delivered = await post(shippoWebhookRoute, shippoEvent('DELIVERED', '2026-10-06T10:00:00Z'), `?token=${SHIPPO_TOKEN}`)
    expect(await delivered.json()).toEqual({ ok: true, applied: { recorded: 1 } })
    const again = await post(shippoWebhookRoute, shippoEvent('DELIVERED', '2026-10-06T10:00:00Z'), `?token=${SHIPPO_TOKEN}`)
    expect(await again.json()).toEqual({ ok: true, applied: { ignored: 1 } })
    const late = await post(shippoWebhookRoute, shippoEvent('TRANSIT', '2026-10-06T11:00:00Z'), `?token=${SHIPPO_TOKEN}`)
    expect(await late.json()).toEqual({ ok: true, applied: { stale: 1 } })
    expect(tracking.map((update) => [update.recordId, update.status])).toEqual([
      ['order-1', 'in_transit'],
      ['order-1', 'delivered'],
    ])
    expect(db.docs.get(`orgs/${ORG}/shippingLabels/lbl_1`)).toMatchObject({ trackingStatus: 'delivered' })
  })

  it('acknowledges a test event at a live deployment without applying it', async () => {
    const response = await post(shippoWebhookRoute, shippoEvent('DELIVERED', '2026-10-06T10:00:00Z', true), `?token=${SHIPPO_TOKEN}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, applied: { other_mode: 1 } })
    expect(tracking).toHaveLength(0)
  })

  it('answers 200 for a parcel nobody here follows, so the provider stops retrying', async () => {
    const body = JSON.stringify({
      event: 'track_updated',
      test: false,
      data: { carrier: 'usps', tracking_number: 'NOT-OURS', tracking_status: { status: 'DELIVERED', status_date: '2026-10-06T10:00:00Z' } },
    })
    const response = await post(shippoWebhookRoute, body, `?token=${SHIPPO_TOKEN}`)
    expect(await response.json()).toEqual({ ok: true, applied: { unknown_parcel: 1 } })
  })
})

describe('the EasyPost webhook', () => {
  const refund = (status: 'refunded' | 'rejected', trackingCode = 'EZ1') =>
    JSON.stringify({
      description: status === 'refunded' ? 'refund.successful' : 'refund.failed',
      mode: 'production',
      result: { object: 'Refund', tracking_code: trackingCode, status },
    })

  it('refuses an unsigned or wrongly signed request', async () => {
    const body = refund('refunded')
    expect((await post(easypostWebhookRoute, body)).status).toBe(401)
    expect((await post(easypostWebhookRoute, body, '', { 'x-hmac-signature': 'hmac-sha256-hex=00' })).status).toBe(401)
    expect(stripeCalls).toHaveLength(0)
  })

  it('settles a void once refunded, crediting the debit once, and a late rejection leaves it voided', async () => {
    const body = refund('refunded')
    const first = await post(easypostWebhookRoute, body, '', { 'x-hmac-signature': signEasypost(body) })
    expect(await first.json()).toEqual({ ok: true, applied: { refund: 1 } })
    expect(db.docs.get(`orgs/${ORG}/shippingLabels/lbl_2`)).toMatchObject({ status: 'voided', billing: { state: 'credited' } })
    await post(easypostWebhookRoute, body, '', { 'x-hmac-signature': signEasypost(body) })
    expect(stripeCalls.filter((path) => path === '/v1/refunds')).toHaveLength(1)
    const rejected = refund('rejected')
    await post(easypostWebhookRoute, rejected, '', { 'x-hmac-signature': signEasypost(rejected) })
    expect(db.docs.get(`orgs/${ORG}/shippingLabels/lbl_2`)).toMatchObject({ status: 'voided' })
  })

  it('takes a refund for a label that is not held here without failing', async () => {
    await db.collection('shippingTrackers').doc(trackerDocId('easypost', 'EZ9')).set({
      orgId: ORG,
      hostId: 'host-candles',
      recordId: 'order-9',
      labelId: 'lbl_missing',
      providerId: 'easypost',
      carrier: 'USPS',
      trackingNumber: 'EZ9',
      createdAtMs: 1,
    })
    const body = refund('refunded', 'EZ9')
    const response = await post(easypostWebhookRoute, body, '', { 'x-hmac-signature': signEasypost(body) })
    expect(response.status).toBe(200)
    expect(db.docs.get(`orgs/${ORG}/shippingLabels/lbl_missing`)).toBeUndefined()
  })
})
