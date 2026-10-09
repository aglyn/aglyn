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

import type { PluginDomainEventEnvelope } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import {
  registerPluginOrderEmailCopies,
  resolvePluginOrderEmailCopies,
} from '@aglyn/aglyn/plugin-manager/plugin-order-email-copies'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { randomBytes } from 'node:crypto'
import { createMemoryFirestore, type MemoryFirestore } from '../testing/memory-firestore'
import { setReviewPlatformsFetchForTests } from './config'
import { setReviewPlatformsDbForTests } from './db'
import {
  inviteThroughTrustpilotApi,
  invitationRef,
  sendOrderToYotpo,
  trustpilotEmailCopy,
  type OrderEventPayload,
  type OrderFulfilledPayload,
} from './invitations'
import { orderRoute, settingsRoute } from './routes'

/**
 * Review platforms' server half through its doors: the console routes and
 * the gate each climbs, the settings a merchant connects (sealed, never read
 * back), the Trustpilot blind copy commerce's buyer emails ask for, and the
 * order events that invite through Trustpilot's API and Yotpo — each once
 * per order, never for a test, canceled or refunded order, and only for a
 * buyer the site may market to. An in-memory Firestore and a recording
 * service; nothing leaves the process.
 */

const ORG = 'org-candles'
const HOST = 'host-candles'
let db: MemoryFirestore

const TOKENS: Record<string, Record<string, unknown>> = {
  'tok-admin': { uid: 'uid-admin', email: 'ada@example.com', email_verified: true },
  'tok-editor': { uid: 'uid-editor', email: 'ed@example.com', email_verified: true },
  'tok-viewer': { uid: 'uid-viewer', email: 'vic@example.com', email_verified: true },
  'tok-unverified': { uid: 'uid-admin', email: 'ada@example.com', email_verified: false },
  'tok-outsider': { uid: 'uid-out', email: 'out@example.com', email_verified: true },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => db,
      auth: () => ({
        verifyIdToken: async (token: string) => {
          const decoded = TOKENS[token]
          if (!decoded) throw Object.assign(new Error('Decoding Firebase ID token failed.'), { code: 'auth/argument-error' })
          return decoded
        },
      }),
    }),
  },
  getOrgForHost: async (hostId: string) =>
    hostId === 'host-candles' ? { orgId: 'org-candles', org: { name: 'Candles', plan: 'pro' } } : null,
  getHostDocAdmin: async (hostId: string) =>
    hostId === 'host-candles'
      ? { memberRoles: { 'uid-admin': 'admin', 'uid-editor': 'editor', 'uid-viewer': 'viewer' } }
      : null,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  isEmailVerified: (decoded: { email_verified?: boolean }) => decoded.email_verified === true,
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/aglyn/app-utils/plan-entitlements', () => ({
  checkEntitlement: () => true,
}))

/** Each address's marketing status on the site, as the campaign decision answers it. */
const marketing = new Map<string, 'subscribed' | 'unsubscribed' | 'withheld'>()
let consentReadFails = false

jest.mock('@aglyn/aglyn/plugin-manager/plugin-person-records', () => ({
  findPluginPerson: async (request: { email: string }) => ({ data: { email: request.email } }),
}))

jest.mock('@aglyn/tenant-data-admin/server/site-marketing-sync', () => ({
  readSiteMarketingStatuses: async (input: { people: Array<{ email: string }> }) => {
    if (consentReadFails) throw new Error('suppressions unreadable')
    return input.people.map((person) => marketing.get(person.email) ?? 'withheld')
  },
}))

/** Every service call, recorded; `fail` makes the next call to a path answer that status. */
const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
const fail = new Map<string, number>()
const serviceFetch = async (url: string, init: RequestInit) => {
  const raw = init.body ? String(init.body) : undefined
  let body: unknown
  try {
    body = raw ? JSON.parse(raw) : undefined
  } catch {
    body = raw
  }
  calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body })
  const path = new URL(url).pathname
  const status = fail.get(path)
  if (status) {
    fail.delete(path)
    return new Response(JSON.stringify({ error: 'no' }), { status })
  }
  if (path.endsWith('/accesstoken')) return new Response(JSON.stringify({ access_token: 'tp_token' }), { status: 200 })
  if (path.endsWith('/access_tokens')) return new Response(JSON.stringify({ access_token: 'yt_token' }), { status: 200 })
  if (path.endsWith('/email-invitations')) return new Response('', { status: 202 })
  if (path.endsWith('/orders')) return new Response(JSON.stringify({ order: { yotpo_id: 'y_1' } }), { status: 201 })
  return new Response(JSON.stringify({ product: { yotpo_id: 'p_1' } }), { status: 201 })
}

function request(method: string, route: string, options: { token?: string; query?: Record<string, string>; body?: unknown } = {}) {
  const query = new URLSearchParams({ hostId: HOST, ...(options.query ?? {}) }).toString()
  return new Request(`https://console.example/api/${route}?${query}`, {
    method,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  })
}

async function save(change: Record<string, unknown>, token = 'tok-admin') {
  return settingsRoute(request('POST', 'review-platforms/settings', { token, body: { hostId: HOST, change } }))
}

async function connect(change: Record<string, unknown>) {
  const response = await save(change)
  expect(response.status).toBe(200)
  return (await response.json()).settings
}

const BCC = 'candles.example+a1b2c3@invite.trustpilot.com'
const BUSINESS_UNIT = '5d3f8a2b9c1e4f0012345678'
const YOTPO_APP_KEY = 'AbCdEf0123456789'

const ORDER = {
  id: 'cs_live_1',
  number: 1042,
  status: 'fulfilled',
  livemode: true,
  currency: 'usd',
  customerEmail: 'ann@example.com',
  customerName: 'Ann Lee',
  lineItems: [
    { productId: 'lamp', name: 'Lamp', sku: 'L-1', quantity: 2, unitAmountCents: 10_000 },
    { productId: 'pdf', name: 'Guide', quantity: 1, unitAmountCents: 500 },
  ],
  totals: { totalCents: 20_500 },
  refundedCents: 0,
  created: '2026-10-06T15:00:00.000Z',
}

function envelope<P>(event: string, payload: P, id = `${event}:1`): PluginDomainEventEnvelope<P> {
  return { id, event, hostId: HOST, orgId: ORG, occurredAtMs: Date.UTC(2026, 9, 7), attempt: 1, payload }
}

function copyRequest(overrides: Record<string, unknown> = {}) {
  return {
    hostId: HOST,
    recordId: ORDER.id,
    emailKey: 'order-shipped',
    moment: 'shipped',
    recipient: 'ann@example.com',
    order: ORDER as unknown as Record<string, unknown>,
    ...overrides,
  }
}

async function invitation(recordId = ORDER.id) {
  return (await invitationRef(ORG, HOST, recordId).get()).data() as Record<string, any> | undefined
}

const callsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment))

beforeEach(() => {
  db = createMemoryFirestore()
  setReviewPlatformsDbForTests(db)
  setReviewPlatformsFetchForTests(serviceFetch as never)
  calls.length = 0
  fail.clear()
  marketing.clear()
  marketing.set('ann@example.com', 'subscribed')
  consentReadFails = false
  process.env['REVIEW_PLATFORMS_TOKEN_KEY'] = randomBytes(32).toString('base64')
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  setReviewPlatformsDbForTests(null)
  setReviewPlatformsFetchForTests(null)
  delete process.env['REVIEW_PLATFORMS_TOKEN_KEY']
  jest.restoreAllMocks()
})

describe('the gate', () => {
  it('refuses no token, an unverified address, an outsider and a non-admin write', async () => {
    expect((await settingsRoute(request('GET', 'review-platforms/settings'))).status).toBe(401)
    expect((await settingsRoute(request('GET', 'review-platforms/settings', { token: 'tok-unverified' }))).status).toBe(403)
    expect((await settingsRoute(request('GET', 'review-platforms/settings', { token: 'tok-outsider' }))).status).toBe(403)
    expect((await settingsRoute(request('GET', 'review-platforms/settings', { token: 'tok-viewer' }))).status).toBe(200)
    expect((await save({ platform: 'trustpilot', mode: 'bcc', bccAddress: BCC }, 'tok-editor')).status).toBe(403)
    const elsewhere = await settingsRoute(
      new Request('https://console.example/api/review-platforms/settings?hostId=host-other', {
        headers: { authorization: 'Bearer tok-admin' },
      }),
    )
    expect(elsewhere.status).toBe(404)
  })
})

describe('settings', () => {
  it('takes only a Trustpilot invitation address for the blind copy', async () => {
    const refused = await save({ platform: 'trustpilot', mode: 'bcc', bccAddress: 'me@gmail.com' })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toMatch(/@invite\.trustpilot\.com/)
    expect((await save({ platform: 'trustpilot', mode: 'bcc' })).status).toBe(400)
    const settings = await connect({ platform: 'trustpilot', mode: 'bcc', bccAddress: ` ${BCC.toUpperCase()} `, sendOn: 'delivered' })
    expect(settings.trustpilot).toMatchObject({ mode: 'bcc', bccAddress: BCC, sendOn: 'delivered' })
  })

  it('offers the blind copy without a deployment key, and nothing that needs one', async () => {
    delete process.env['REVIEW_PLATFORMS_TOKEN_KEY']
    const read = await (await settingsRoute(request('GET', 'review-platforms/settings', { token: 'tok-admin' }))).json()
    expect(read.settings.apiAvailable).toBe(false)
    await connect({ platform: 'trustpilot', mode: 'bcc', bccAddress: BCC })
    const refused = await save({ platform: 'yotpo', appKey: YOTPO_APP_KEY, secretKey: 'yotpo-secret', enabled: true })
    expect(refused.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  it('checks a Trustpilot key with Trustpilot, seals it, and never reads it back', async () => {
    fail.set('/v1/oauth/oauth-business-users-for-applications/accesstoken', 401)
    const refused = await save({ platform: 'trustpilot', mode: 'api', apiKey: 'tp-key', apiSecret: 'tp-secret', businessUnitId: BUSINESS_UNIT })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toBe('Trustpilot did not accept those keys.')
    const settings = await connect({
      platform: 'trustpilot',
      mode: 'api',
      apiKey: 'tp-key',
      apiSecret: 'tp-secret',
      businessUnitId: BUSINESS_UNIT,
      locale: 'en_gb',
    })
    expect(settings.trustpilot).toMatchObject({ mode: 'api', apiConnected: true, businessUnitId: BUSINESS_UNIT, locale: 'en-GB' })
    const token = callsTo('accesstoken').at(-1)
    expect(token?.headers['Authorization']).toBe(`Basic ${Buffer.from('tp-key:tp-secret').toString('base64')}`)
    expect(token?.body).toBe('grant_type=client_credentials')
    const stored = JSON.stringify((await db.collection('orgs').doc(ORG).collection('reviewPlatformsHostSettings').doc(HOST).get()).data())
    expect(stored).not.toContain('tp-secret')
    expect(stored).not.toContain('tp-key')
    const read = JSON.stringify(await (await settingsRoute(request('GET', 'review-platforms/settings', { token: 'tok-admin' }))).json())
    expect(read).not.toContain('tp-secret')
    const disconnected = await connect({ platform: 'trustpilot', disconnect: true })
    expect(disconnected.trustpilot).toMatchObject({ mode: 'off', apiConnected: false })
  })

  it('checks a Yotpo key pair with Yotpo, and drops a secret when the app key changes', async () => {
    const settings = await connect({ platform: 'yotpo', appKey: YOTPO_APP_KEY, secretKey: 'yotpo-secret', enabled: true })
    expect(settings.yotpo).toEqual({ enabled: true, connected: true, appKey: YOTPO_APP_KEY })
    expect(callsTo(`/stores/${YOTPO_APP_KEY}/access_tokens`)[0]?.body).toEqual({ secret: 'yotpo-secret' })
    const moved = await connect({ platform: 'yotpo', appKey: 'ZyXwVu9876543210', enabled: false })
    expect(moved.yotpo).toEqual({ enabled: false, connected: false, appKey: 'ZyXwVu9876543210' })
  })
})

describe('the Trustpilot blind copy on a buyer email', () => {
  beforeEach(async () => {
    await connect({ platform: 'trustpilot', mode: 'bcc', bccAddress: BCC, sendOn: 'shipped' })
  })

  it('copies the first shipped email once, with the data block Trustpilot reads', async () => {
    const copy = await trustpilotEmailCopy(copyRequest())
    expect(copy?.bcc).toEqual([BCC])
    expect(copy?.dataBlocks).toEqual([
      {
        type: 'application/json+trustpilot',
        json: { recipientName: 'Ann Lee', recipientEmail: 'ann@example.com', referenceId: '1042' },
      },
    ])
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'sending', via: 'bcc' })
    await copy?.settle?.(true)
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'sent', via: 'bcc' })
    // A second parcel, then the delivery: no second invitation.
    expect(await trustpilotEmailCopy(copyRequest({ emailKey: 'order-shipped' }))).toBeNull()
    expect(await trustpilotEmailCopy(copyRequest({ emailKey: 'order-delivered', moment: 'delivered' }))).toBeNull()
  })

  it('reaches commerce through core’s seam, joined with nothing else', async () => {
    registerPluginOrderEmailCopies((input) => trustpilotEmailCopy(input), { pluginId: 'review-platforms' })
    const copies = await resolvePluginOrderEmailCopies(copyRequest(), { timeoutMs: 1000 })
    expect(copies.bcc).toEqual([BCC])
    expect(copies.html).toBe(
      '<script type="application/json+trustpilot">{"recipientName":"Ann Lee","recipientEmail":"ann@example.com","referenceId":"1042"}</script>',
    )
    await copies.settle(false)
    // The email did not leave, so the next one may carry the copy.
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'failed' })
    const again = await trustpilotEmailCopy(copyRequest({ moment: 'delivered' }))
    expect(again?.bcc).toEqual([BCC])
  })

  it('rides only the moment the merchant chose', async () => {
    await connect({ platform: 'trustpilot', sendOn: 'delivered' })
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
    expect(await trustpilotEmailCopy(copyRequest({ moment: 'receipt', emailKey: 'order-receipt' }))).toBeNull()
    expect((await trustpilotEmailCopy(copyRequest({ moment: 'picked_up', emailKey: 'order-picked-up' })))?.bcc).toEqual([BCC])
  })

  it('never for a test, canceled or refunded order, nor a buyer the site may not market to', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...ORDER, id: 'cs_test_1', livemode: undefined }, 'test_mode'],
      [{ ...ORDER, id: 'o-2', livemode: false }, 'test_mode'],
      [{ ...ORDER, id: 'o-3', status: 'cancelled' }, 'cancelled'],
      [{ ...ORDER, id: 'o-4', refundedCents: 20_500 }, 'refunded'],
    ]
    for (const [order, reason] of cases) {
      expect(await trustpilotEmailCopy(copyRequest({ recordId: order.id, order }))).toBeNull()
      expect((await invitation(String(order.id)))?.trustpilot).toMatchObject({ status: 'skipped', reason })
    }
    marketing.set('ann@example.com', 'unsubscribed')
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'skipped', reason: 'no_consent' })
    marketing.set('ann@example.com', 'withheld')
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
    // Consent recorded later: the next email carries the copy.
    marketing.set('ann@example.com', 'subscribed')
    expect((await trustpilotEmailCopy(copyRequest()))?.bcc).toEqual([BCC])
  })

  it('adds no copy when consent cannot be read', async () => {
    consentReadFails = true
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
    expect(await invitation()).toBeUndefined()
  })

  it('adds nothing for a site with Trustpilot off', async () => {
    await connect({ platform: 'trustpilot', mode: 'off' })
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
  })
})

describe('Trustpilot by API', () => {
  beforeEach(async () => {
    await connect({
      platform: 'trustpilot',
      mode: 'api',
      apiKey: 'tp-key',
      apiSecret: 'tp-secret',
      businessUnitId: BUSINESS_UNIT,
      businessUserId: 'a1b2c3d4e5f6a7b8c9d0e1f2',
      sendOn: 'shipped',
    })
    calls.length = 0
  })

  it('invites once on the first shipment, as the business user, for a service review', async () => {
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: ORDER }))
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: ORDER }, 'order.fulfilled:2'))
    const invites = callsTo('/email-invitations')
    expect(invites).toHaveLength(1)
    expect(invites[0].url).toBe(`https://invitations-api.trustpilot.com/v1/private/business-units/${BUSINESS_UNIT}/email-invitations`)
    expect(invites[0].headers['Authorization']).toBe('Bearer tp_token')
    expect(invites[0].headers['x-business-user-id']).toBe('a1b2c3d4e5f6a7b8c9d0e1f2')
    expect(invites[0].body).toEqual({
      consumerEmail: 'ann@example.com',
      consumerName: 'Ann Lee',
      referenceNumber: '1042',
      locale: 'en-US',
      type: 'email',
      serviceReviewInvitation: { tags: ['aglyn'] },
    })
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'sent', via: 'api' })
    // The blind copy never doubles an API invitation.
    await connect({ platform: 'trustpilot', mode: 'bcc', bccAddress: BCC })
    expect(await trustpilotEmailCopy(copyRequest())).toBeNull()
  })

  it('waits for delivery when the merchant chose it', async () => {
    await connect({ platform: 'trustpilot', sendOn: 'delivered' })
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: ORDER }))
    expect(callsTo('/email-invitations')).toHaveLength(0)
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.delivered', { order: { ...ORDER, status: 'delivered' } }))
    expect(callsTo('/email-invitations')).toHaveLength(1)
  })

  it('retries a service outage, and records a refusal without retrying it', async () => {
    fail.set(`/v1/private/business-units/${BUSINESS_UNIT}/email-invitations`, 503)
    await expect(inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: ORDER }))).rejects.toThrow()
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'failed' })
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: ORDER }))
    expect((await invitation())?.trustpilot).toMatchObject({ status: 'sent' })

    const other = { ...ORDER, id: 'o-9' }
    fail.set(`/v1/private/business-units/${BUSINESS_UNIT}/email-invitations`, 400)
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: other }))
    expect((await invitation('o-9'))?.trustpilot).toMatchObject({ status: 'failed', error: 'Trustpilot refused it (400).' })
    calls.length = 0
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: other }))
    expect(callsTo('/email-invitations')).toHaveLength(0)
  })

  it('skips a test-mode order and a buyer who unsubscribed', async () => {
    await inviteThroughTrustpilotApi(envelope<OrderEventPayload>('order.fulfilled', { order: { ...ORDER, livemode: false } }))
    marketing.set('bo@example.com', 'unsubscribed')
    await inviteThroughTrustpilotApi(
      envelope<OrderEventPayload>('order.fulfilled', { order: { ...ORDER, id: 'o-5', customerEmail: 'bo@example.com' } }),
    )
    expect(callsTo('/email-invitations')).toHaveLength(0)
    expect((await invitation('o-5'))?.trustpilot).toMatchObject({ status: 'skipped', reason: 'no_consent' })
  })
})

describe('Yotpo Reviews', () => {
  beforeEach(async () => {
    await connect({ platform: 'yotpo', appKey: YOTPO_APP_KEY, secretKey: 'yotpo-secret', enabled: true })
    calls.length = 0
  })

  const fulfilled = (order = ORDER) =>
    envelope<OrderFulfilledPayload>('order.fulfilled', { order, fulfillment: { id: 'f_1', at: '2026-10-07T12:00:00.000Z' } })

  it('creates each product, then the order with a successful fulfillment, once', async () => {
    await sendOrderToYotpo(fulfilled())
    await sendOrderToYotpo(fulfilled())
    const products = callsTo('/products')
    expect(products.map((call) => call.body.product.external_id)).toEqual(['lamp', 'pdf'])
    expect(products[0].headers['X-Yotpo-Token']).toBe('yt_token')
    const orders = callsTo('/orders')
    expect(orders).toHaveLength(1)
    expect(orders[0].body.order).toMatchObject({
      external_id: 'cs_live_1',
      order_date: '2026-10-06T15:00:00.000Z',
      currency: 'USD',
      total_price: 205,
      customer: { email: 'ann@example.com', first_name: 'Ann', last_name: 'Lee' },
      line_items: [
        { external_product_id: 'lamp', quantity: 2, total_price: 200 },
        { external_product_id: 'pdf', quantity: 1, total_price: 5 },
      ],
      fulfillments: [{ external_id: 'f_1', fulfillment_date: '2026-10-07T12:00:00.000Z', status: 'success' }],
    })
    expect((await invitation())?.yotpo).toMatchObject({ status: 'sent', via: 'api' })
  })

  it('takes Yotpo’s “already exists” as done', async () => {
    fail.set(`/core/v3/stores/${YOTPO_APP_KEY}/products`, 409)
    fail.set(`/core/v3/stores/${YOTPO_APP_KEY}/orders`, 409)
    await sendOrderToYotpo(fulfilled())
    expect((await invitation())?.yotpo).toMatchObject({ status: 'sent' })
  })

  it('sends nothing for a refunded order, a switched-off store or a buyer without consent', async () => {
    await sendOrderToYotpo(fulfilled({ ...ORDER, status: 'refunded' }))
    marketing.set('ann@example.com', 'withheld')
    await sendOrderToYotpo(fulfilled({ ...ORDER, id: 'o-7' }))
    expect(callsTo('/orders')).toHaveLength(0)
    await connect({ platform: 'yotpo', enabled: false })
    marketing.set('ann@example.com', 'subscribed')
    calls.length = 0
    await sendOrderToYotpo(fulfilled({ ...ORDER, id: 'o-8' }))
    expect(calls).toHaveLength(0)
  })

  it('retries an outage', async () => {
    fail.set(`/core/v3/stores/${YOTPO_APP_KEY}/orders`, 500)
    await expect(sendOrderToYotpo(fulfilled())).rejects.toThrow()
    await sendOrderToYotpo(fulfilled())
    expect((await invitation())?.yotpo).toMatchObject({ status: 'sent' })
  })
})

describe('the order route', () => {
  it('says whether each service was asked, without a credential or an address', async () => {
    await connect({ platform: 'trustpilot', mode: 'bcc', bccAddress: BCC })
    marketing.set('ann@example.com', 'unsubscribed')
    await trustpilotEmailCopy(copyRequest())
    const response = await orderRoute(request('GET', 'review-platforms/order', { token: 'tok-viewer', query: { recordId: ORDER.id } }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.order.trustpilot).toMatchObject({ status: 'skipped', reason: 'no_consent' })
    expect(body.order.yotpo).toBeNull()
    expect(JSON.stringify(body)).not.toContain('ann@example.com')
    expect((await orderRoute(request('GET', 'review-platforms/order', { token: 'tok-viewer' }))).status).toBe(400)
  })
})
