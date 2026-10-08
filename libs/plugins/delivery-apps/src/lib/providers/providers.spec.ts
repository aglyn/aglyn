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

import { createHmac } from 'node:crypto'
import {
  DOORDASH_ORDER_ADJUST,
  DOORDASH_ORDER_CANCEL,
  DOORDASH_ORDER_CREATE,
  GRUBHUB_ORDER_CREATED,
  GRUBHUB_ORDER_REFUNDED,
  UBER_ORDER,
  UBER_ORDER_CANCEL,
  UBER_ORDER_NOTIFICATION,
} from '../testing/fixtures'
import { mockHttp, sentJson } from '../testing/mock-http'
import { createDoordashProvider, doordashJwt } from './doordash'
import { createGrubhubProvider, grubhubAuthorization } from './grubhub'
import { ProviderError } from './http'
import { incomingOrderProblem, menuItemId, readMenuItemId, shortName, type Menu, type WebhookRequest } from './provider'
import { createUberEatsProvider, uberSignature } from './uber-eats'

const NOW = Date.parse('2026-10-07T18:01:00Z')
const SIGNING = Buffer.from('doordash-signing-secret-32-bytes!').toString('base64url')
const DOORDASH = { developerId: 'dev-1', keyId: 'key-1', signingSecret: SIGNING, webhookSecret: 'dd-hook-token', providerType: 'aglyn', sandbox: false }
const UBER = { clientId: 'uber-client', clientSecret: 'uber-secret', sandbox: false }
const GH_KEY = Buffer.from('grubhub-mac-key').toString('base64')
const GRUBHUB = { clientId: 'gh-client', secretKey: GH_KEY, partnerKey: 'gh-partner', sandbox: true }

const webhook = (body: unknown, headers: Record<string, string>, url = 'https://console.example.com/api/delivery-apps/webhooks/x'): WebhookRequest => ({
  rawBody: typeof body === 'string' ? body : JSON.stringify(body),
  headers: new Headers(headers),
  url,
  method: 'POST',
})

const ref = { externalOrderId: 'ord-1', externalStoreId: 'store-1', recordId: 'doordash-abc' }

const MENU: Menu = {
  name: 'Corner Grill',
  currency: 'USD',
  categories: [
    {
      id: 'aglyn-category-1',
      name: 'Burgers',
      items: [
        { externalItemId: 'aglyn:burger:default', name: 'Classic Burger', description: 'Beef', priceCents: 1200, imageUrl: 'https://cdn.example.com/b.jpg', available: true },
        { externalItemId: 'aglyn:melt:default', name: 'Patty Melt', description: '', priceCents: 1300, imageUrl: null, available: false },
      ],
    },
  ],
}

describe('provider helpers (AGL-3644)', () => {
  it('names a configuration by menu item id, and reads only ours back', () => {
    expect(menuItemId('burger', 'default')).toBe('aglyn:burger:default')
    expect(readMenuItemId('aglyn:burger:default')).toEqual({ productId: 'burger', variantId: 'default' })
    expect(readMenuItemId('FRY-1')).toBeNull()
    expect(readMenuItemId('aglyn:__x__:v')).toBeNull()
    expect(readMenuItemId(null)).toBeNull()
  })

  it('keeps a first name and last initial only', () => {
    expect(shortName('Jamie', 'Rivera')).toBe('Jamie R.')
    expect(shortName('Alex Morgan')).toBe('Alex M.')
    expect(shortName('Cher')).toBe('Cher')
    expect(shortName('', 'X')).toBeNull()
  })
})

describe('DoorDash (AGL-3644)', () => {
  const provider = (http = mockHttp([]).http) => createDoordashProvider({ config: DOORDASH, http, now: () => NOW })

  it('admits a webhook with the integration token only', () => {
    const p = provider()
    expect(p.verify(webhook(DOORDASH_ORDER_CREATE, { authorization: 'Bearer dd-hook-token' }), NOW)).toBe(true)
    expect(p.verify(webhook(DOORDASH_ORDER_CREATE, { authorization: 'dd-hook-token' }), NOW)).toBe(true)
    expect(p.verify(webhook(DOORDASH_ORDER_CREATE, { authorization: 'Bearer wrong' }), NOW)).toBe(false)
    expect(p.verify(webhook(DOORDASH_ORDER_CREATE, {}), NOW)).toBe(false)
  })

  it('reads a new order: items with options folded into the unit price, the totals the store is owed, the short code', async () => {
    const [event] = await provider().parse(webhook(DOORDASH_ORDER_CREATE, {}))
    expect(event).toEqual({
      kind: 'created',
      order: {
        externalOrderId: '3f1c8e2a-dd01-4b7e-9a51-6f0c2d9e8a10',
        externalRef: 'A1B2C3',
        storeIds: ['aglyn-store-7', '24680'],
        placedAtMs: Date.parse('2026-10-07T18:00:00Z'),
        pickupAtMs: Date.parse('2026-10-07T18:20:00Z'),
        currency: 'USD',
        lines: [
          { externalLineId: 'line-1', externalItemId: 'aglyn:burger:default', name: 'Classic Burger', quantity: 2, unitPriceCents: 1300, options: ['Cheese'], instructions: 'No onions' },
          { externalLineId: 'line-2', externalItemId: 'FRY-1', name: 'Fries', quantity: 1, unitPriceCents: 400, options: [], instructions: null },
        ],
        subtotalCents: 3000,
        taxCents: 240,
        discountCents: 0,
        totalCents: 3240,
        customerName: 'Jamie R.',
        instructions: 'Leave at the door',
        handoff: 'courier',
      },
    })
    expect(incomingOrderProblem((event as any).order)).toBeNull()
  })

  it('reads an adjustment as the order now stands, and a cancel', async () => {
    const [adjust] = await provider().parse(webhook(DOORDASH_ORDER_ADJUST, {}))
    expect(adjust).toMatchObject({ kind: 'updated', eventId: 'adj-77', order: { totalCents: 2808, lines: [{ externalLineId: 'line-1' }] } })
    const [cancel] = await provider().parse(webhook(DOORDASH_ORDER_CANCEL, {}))
    expect(cancel).toEqual({
      kind: 'cancelled',
      externalOrderId: DOORDASH_ORDER_CREATE.order.id,
      storeIds: ['aglyn-store-7', '24680'],
      reason: 'Customer canceled',
    })
    expect(await provider().parse(webhook({ event: { type: 'Something' }, order: {} }, {}))).toEqual([{ kind: 'ignored', reason: 'event Something' }])
    expect(await provider().parse(webhook('not json', {}))).toEqual([{ kind: 'ignored', reason: 'no order in event' }])
  })

  it('signs every call with a DoorDash JWT, five minutes long', () => {
    const token = doordashJwt(DOORDASH, NOW)
    const [header, payload, signature] = token.split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      aud: 'doordash',
      iss: 'dev-1',
      kid: 'key-1',
      iat: NOW / 1000,
      exp: NOW / 1000 + 300,
    })
    const expected = createHmac('sha256', Buffer.from(SIGNING, 'base64url')).update(`${header}.${payload}`).digest('base64url')
    expect(signature).toBe(expected)
  })

  it('confirms, fails and readies an order, and pushes the menu', async () => {
    const { http, calls } = mockHttp([{ match: 'openapi.doordash.com', body: {} }])
    const p = provider(http)
    await p.accept(ref, 20, NOW)
    await p.reject(ref, 'Kitchen is closed')
    await p.ready?.(ref)
    await p.publishMenu('aglyn-store-7', MENU)
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PATCH https://openapi.doordash.com/marketplace/api/v1/orders/ord-1',
      'PATCH https://openapi.doordash.com/marketplace/api/v1/orders/ord-1',
      'PATCH https://openapi.doordash.com/marketplace/api/v1/orders/ord-1/events/order_ready_for_pickup',
      'POST https://openapi.doordash.com/marketplace/api/v1/menus',
    ])
    expect(calls[0].headers['authorization']).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(sentJson(calls[0])).toEqual({
      merchant_supplied_id: 'doordash-abc',
      order_status: 'success',
      prep_time: new Date(NOW + 20 * 60_000).toISOString(),
    })
    expect(sentJson(calls[1])).toEqual({ order_status: 'fail', failure_reason: 'Kitchen is closed' })
    expect(sentJson(calls[3]).store).toEqual({ merchant_supplied_id: 'aglyn-store-7', provider_type: 'aglyn' })
    expect(sentJson(calls[3]).menu.categories[0].items).toEqual([
      expect.objectContaining({ merchant_supplied_id: 'aglyn:burger:default', price: 1200, active: true, original_image_url: 'https://cdn.example.com/b.jpg' }),
      expect.objectContaining({ merchant_supplied_id: 'aglyn:melt:default', active: false }),
    ])
  })

  it('turns a refusal into a provider error the engine can judge', async () => {
    const { http } = mockHttp([{ match: 'openapi.doordash.com', status: 400, body: { message: 'Order is no longer pending' } }])
    await expect(provider(http).accept(ref, 15, NOW)).rejects.toMatchObject({ kind: 'invalid', message: 'Order is no longer pending' })
  })
})

describe('Uber Eats (AGL-3644)', () => {
  const routes = () =>
    mockHttp([
      { method: 'POST', match: 'auth.uber.com/oauth/v2/token', body: { access_token: 'uber-token', expires_in: 2592000 } },
      { method: 'GET', match: 'api.uber.com/v2/eats/order/uber-order-9', body: UBER_ORDER },
      { match: 'api.uber.com/v', body: {} },
    ])

  it('admits a webhook whose X-Uber-Signature is the body signed with the client secret', () => {
    const p = createUberEatsProvider({ config: UBER, http: mockHttp([]).http, now: () => NOW })
    const body = JSON.stringify(UBER_ORDER_NOTIFICATION)
    const signature = createHmac('sha256', 'uber-secret').update(body).digest('hex')
    expect(uberSignature(body, 'uber-secret')).toBe(signature)
    expect(p.verify(webhook(body, { 'x-uber-signature': signature }), NOW)).toBe(true)
    expect(p.verify(webhook(body, { 'x-uber-signature': signature.toUpperCase() }), NOW)).toBe(true)
    expect(p.verify(webhook(`${body} `, { 'x-uber-signature': signature }), NOW)).toBe(false)
    expect(p.verify(webhook(body, {}), NOW)).toBe(false)
  })

  it('reads the named order back, with a token asked for once', async () => {
    const { http, calls } = routes()
    const p = createUberEatsProvider({ config: UBER, http, now: () => NOW })
    const [event] = await p.parse(webhook(UBER_ORDER_NOTIFICATION, {}))
    expect(event).toEqual({
      kind: 'created',
      order: {
        externalOrderId: 'uber-order-9',
        externalRef: '9F2C1',
        storeIds: ['uber-store-1'],
        placedAtMs: Date.parse('2026-10-07T18:00:00Z'),
        pickupAtMs: Date.parse('2026-10-07T18:15:00Z'),
        currency: 'USD',
        lines: [
          { externalLineId: 'inst-1', externalItemId: 'aglyn:burger:default', name: 'Classic Burger', quantity: 1, unitPriceCents: 1350, options: ['Bacon'], instructions: null },
        ],
        subtotalCents: 1350,
        taxCents: 108,
        discountCents: 0,
        totalCents: 1458,
        customerName: 'Sam L.',
        instructions: 'Extra napkins',
        handoff: 'courier',
      },
    })
    await p.accept(ref, 15, NOW)
    expect(calls.filter((call) => call.url.includes('auth.uber.com'))).toHaveLength(1)
    const token = new URLSearchParams(calls[0].body ?? '')
    expect(Object.fromEntries(token)).toMatchObject({ client_id: 'uber-client', client_secret: 'uber-secret', grant_type: 'client_credentials' })
    expect(calls[1].headers['authorization']).toBe('Bearer uber-token')
  })

  it('reads a cancel and a failure without calling Uber', async () => {
    const { http, calls } = routes()
    const p = createUberEatsProvider({ config: UBER, http, now: () => NOW })
    expect(await p.parse(webhook(UBER_ORDER_CANCEL, {}))).toEqual([
      { kind: 'cancelled', externalOrderId: 'uber-order-9', storeIds: ['uber-store-1'], reason: 'Canceled on Uber Eats' },
    ])
    expect(await p.parse(webhook({ ...UBER_ORDER_CANCEL, event_type: 'orders.failure' }, {}))).toEqual([
      expect.objectContaining({ kind: 'cancelled', reason: 'Uber Eats could not complete the order' }),
    ])
    expect(calls).toHaveLength(0)
  })

  it('accepts and denies through the POS endpoints, takes no "ready", and sends the menu', async () => {
    const { http, calls } = routes()
    const p = createUberEatsProvider({ config: UBER, http, now: () => NOW })
    expect(p.ready).toBeUndefined()
    await p.accept(ref, 15, NOW)
    await p.reject(ref, 'Kitchen is closed')
    await p.publishMenu('uber-store-1', MENU)
    const api = calls.filter((call) => call.url.startsWith('https://api.uber.com'))
    expect(api.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api.uber.com/v1/eats/orders/ord-1/accept_pos_order',
      'POST https://api.uber.com/v1/eats/orders/ord-1/deny_pos_order',
      'PUT https://api.uber.com/v2/eats/stores/uber-store-1/menus',
    ])
    expect(sentJson(api[0])).toEqual({ reason: 'accepted', external_reference_id: 'doordash-abc' })
    expect(sentJson(api[1])).toEqual({ reason: { explanation: 'Kitchen is closed', code: 'STORE_CLOSED' } })
    const menu = sentJson(api[2])
    expect(menu.items[0]).toMatchObject({ id: 'aglyn:burger:default', price_info: { price: 1200 } })
    expect(menu.items[1].suspension_info).toBeDefined()
    expect(menu.categories[0].entities).toEqual([
      { id: 'aglyn:burger:default', type: 'ITEM' },
      { id: 'aglyn:melt:default', type: 'ITEM' },
    ])
  })

  it('asks for a new token once the old one is near its end', async () => {
    let clock = NOW
    const { http, calls } = mockHttp([
      { method: 'POST', match: 'auth.uber.com', body: { access_token: 't', expires_in: 120 } },
      { match: 'api.uber.com', body: {} },
    ])
    const p = createUberEatsProvider({ config: UBER, http, now: () => clock })
    await p.accept(ref, 15, clock)
    clock += 90_000
    await p.accept(ref, 15, clock)
    expect(calls.filter((call) => call.url.includes('auth.uber.com'))).toHaveLength(2)
  })
})

describe('Grubhub (AGL-3644)', () => {
  const URL_HOOK = 'https://console.example.com/api/delivery-apps/webhooks/grubhub'
  const signed = (body: unknown, at = NOW, config = GRUBHUB) => {
    const raw = JSON.stringify(body)
    return webhook(raw, { authorization: grubhubAuthorization(config, { method: 'POST', url: URL_HOOK, body: raw }, at, () => 'abc') }, URL_HOOK)
  }

  it('admits a webhook with a valid MAC from five minutes either side of now, and nothing else', () => {
    const p = createGrubhubProvider({ config: GRUBHUB, http: mockHttp([]).http, now: () => NOW })
    expect(p.verify(signed(GRUBHUB_ORDER_CREATED), NOW)).toBe(true)
    expect(p.verify(signed(GRUBHUB_ORDER_CREATED, NOW - 4 * 60_000), NOW)).toBe(true)
    expect(p.verify(signed(GRUBHUB_ORDER_CREATED, NOW - 6 * 60_000), NOW)).toBe(false)
    expect(p.verify(signed(GRUBHUB_ORDER_CREATED, NOW, { ...GRUBHUB, secretKey: Buffer.from('other').toString('base64') }), NOW)).toBe(false)
    expect(p.verify(signed(GRUBHUB_ORDER_CREATED, NOW, { ...GRUBHUB, clientId: 'someone-else' }), NOW)).toBe(false)
    const tampered = signed(GRUBHUB_ORDER_CREATED)
    expect(p.verify({ ...tampered, rawBody: tampered.rawBody.replace('1600', '16') }, NOW)).toBe(false)
    expect(p.verify(webhook(GRUBHUB_ORDER_CREATED, { authorization: 'Bearer x' }, URL_HOOK), NOW)).toBe(false)
  })

  it('reads a new order and a refund', async () => {
    const p = createGrubhubProvider({ config: GRUBHUB, http: mockHttp([]).http, now: () => NOW })
    const [created] = await p.parse(signed(GRUBHUB_ORDER_CREATED))
    expect(created).toMatchObject({
      kind: 'created',
      order: {
        externalOrderId: 'gh-555',
        externalRef: '5551-2',
        storeIds: ['112233'],
        totalCents: 1728,
        customerName: 'Alex M.',
        lines: [
          { externalLineId: 'gl-1', externalItemId: 'aglyn:burger:default', unitPriceCents: 1200 },
          { externalLineId: 'gl-2', externalItemId: 'FRY-1', unitPriceCents: 400 },
        ],
      },
    })
    expect(await p.parse(signed(GRUBHUB_ORDER_REFUNDED))).toEqual([
      { kind: 'refunded', externalOrderId: 'gh-555', storeIds: ['112233'], refundId: 'gh-refund-1', amountCents: 400, reason: 'Missing fries' },
    ])
    expect(await p.parse(signed({ ...GRUBHUB_ORDER_REFUNDED, refund: { amount: 1 } }))).toEqual([
      { kind: 'ignored', reason: 'a refund with no id or amount' },
    ])
  })

  it('signs each call, sends the partner key, and uses the pre-production host in the sandbox', async () => {
    const { http, calls } = mockHttp([{ match: 'grubhub.com', body: {} }])
    const p = createGrubhubProvider({ config: GRUBHUB, http, now: () => NOW, random: () => 'n1' })
    await p.accept({ ...ref, externalStoreId: '112233' }, 25, NOW)
    await p.ready?.({ ...ref, externalStoreId: '112233' })
    await p.publishMenu('112233', MENU)
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT https://api-third-party-gtm-pp.grubhub.com/pos/v1/merchant/112233/orders/ord-1/status',
      'PUT https://api-third-party-gtm-pp.grubhub.com/pos/v1/merchant/112233/orders/ord-1/status',
      'PUT https://api-third-party-gtm-pp.grubhub.com/pos/v1/merchant/112233/menu',
    ])
    expect(sentJson(calls[0])).toEqual({ status: 'CONFIRMED', wait_time_in_minutes: 25 })
    expect(sentJson(calls[1])).toEqual({ status: 'READY_FOR_PICKUP' })
    expect(calls[0].headers['x-gh-partner-key']).toBe('gh-partner')
    // The call's own MAC verifies under the same scheme a webhook is checked by.
    const verifier = createGrubhubProvider({ config: GRUBHUB, http, now: () => NOW })
    expect(
      verifier.verify(
        { rawBody: calls[0].body ?? '', headers: new Headers({ authorization: calls[0].headers['authorization'] }), url: calls[0].url, method: 'PUT' },
        NOW,
      ),
    ).toBe(true)
  })

  it('surfaces an outage as transient, for the job to send again', async () => {
    const { http } = mockHttp([{ match: 'grubhub.com', status: 503, body: {} }])
    const p = createGrubhubProvider({ config: GRUBHUB, http, now: () => NOW })
    const failure = await p.reject({ ...ref, externalStoreId: '112233' }, 'Closed').catch((error) => error)
    expect(failure).toBeInstanceOf(ProviderError)
    expect(failure.kind).toBe('transient')
  })
})
