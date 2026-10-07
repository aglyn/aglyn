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
import { aftershipSlugFor, aftershipTrackingStatus, narvarCarrierFor } from '../model/carriers'
import { normalizeRetailerMoniker, normalizeTrackingPageUrl } from '../model/post-purchase-settings'
import { createAftershipTracking, verifyAftershipWebhook } from './aftership'
import { centsToDecimal, decimalToCents, PostPurchaseProviderError } from './http'
import { narvarTrackingPage, upsertNarvarOrder } from './narvar'
import { cancelRouteOrder, createRouteOrder, createRouteShipment, quoteRoute } from './route'

/**
 * The three vendor adapters against a recording `fetch`: what each sends,
 * how each reads money back into integer cents, what each treats as
 * success on a retry, and how AfterShip's signature is held. Nothing
 * leaves the process.
 */

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

function recorder(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = {
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const { status, body } = answer(call)
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchImpl }
}

const ROUTE = { token: 'rt_secret', apiBase: 'https://api.route.com/v2' }

describe('money crosses as two-place decimals and comes back as integer cents', () => {
  it('writes cents as a decimal string', () => {
    expect(centsToDecimal(1234)).toBe('12.34')
    expect(centsToDecimal(5)).toBe('0.05')
    expect(centsToDecimal(0)).toBe('0.00')
  })

  it('reads a decimal back exactly, and refuses what it cannot', () => {
    expect(decimalToCents('1.98')).toBe(198)
    expect(decimalToCents(1.98)).toBe(198)
    expect(decimalToCents('2')).toBe(200)
    expect(decimalToCents('2.5')).toBe(250)
    expect(decimalToCents(1.9800000000000002)).toBe(198)
    expect(decimalToCents('1.987')).toBeNull()
    expect(decimalToCents('-1.00')).toBeNull()
    expect(decimalToCents('abc')).toBeNull()
    expect(decimalToCents(undefined)).toBeNull()
  })
})

describe('Route', () => {
  it('quotes the shipped subtotal and answers the premium in cents', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200, body: { id: 'q_1', premium: { amount: 1.98, currency: 'USD' } } }))
    const quote = await quoteRoute(
      { ...ROUTE, fetchImpl },
      { subtotalCents: 10_000, currency: 'usd', items: [{ name: 'Lamp', quantity: 1, unitCents: 10_000 }] },
    )
    expect(quote).toEqual({ quoteId: 'q_1', premiumCents: 198, currency: 'usd' })
    expect(calls[0].url).toBe('https://api.route.com/v2/quotes')
    expect(calls[0].headers['Token']).toBe('rt_secret')
    expect(calls[0].body).toMatchObject({ subtotal: '100.00', currency: 'USD', cart_items: [{ unit_price: '100.00' }] })
  })

  it('refuses a premium it cannot charge exactly, or in another currency', async () => {
    for (const premium of [{ amount: '1.987', currency: 'USD' }, { amount: '0', currency: 'USD' }, { amount: '2.00', currency: 'EUR' }]) {
      const { fetchImpl } = recorder(() => ({ status: 200, body: { premium } }))
      await expect(
        quoteRoute({ ...ROUTE, fetchImpl }, { subtotalCents: 100, currency: 'usd', items: [] }),
      ).rejects.toBeInstanceOf(PostPurchaseProviderError)
    }
  })

  it('opens a policy under the order’s own id, and reads 409 as one already open', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200, body: { id: 'pol_1' } }))
    const order = {
      sourceOrderId: 'cs_1',
      sourceOrderNumber: '1042',
      createdAtMs: Date.UTC(2026, 9, 7),
      currency: 'usd',
      subtotalCents: 10_000,
      premiumCents: 198,
      quoteId: 'q_1',
      customer: { name: 'Ann Lee', email: 'ann@example.com' },
      shipTo: { line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' },
      items: [{ id: 'p1', name: 'Lamp', quantity: 1, unitCents: 10_000 }],
    }
    await expect(createRouteOrder({ ...ROUTE, fetchImpl }, order)).resolves.toEqual({ outcome: 'created', policyId: 'pol_1' })
    expect(calls[0].body).toMatchObject({
      source_order_id: 'cs_1',
      paid_to_insure: '1.98',
      amount_covered: '100.00',
      insurance_selected: true,
      customer_details: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' },
      shipping_details: { zip: '02108', country_code: 'US' },
    })
    const duplicate = recorder(() => ({ status: 409, body: { error: 'exists' } }))
    await expect(createRouteOrder({ ...ROUTE, fetchImpl: duplicate.fetchImpl }, order)).resolves.toEqual({
      outcome: 'already',
      policyId: null,
    })
  })

  it('tells a parcel once, treats a repeat as done, and cancels by policy', async () => {
    const { calls, fetchImpl } = recorder((call) => ({ status: call.url.endsWith('/shipments') && calls.length > 1 ? 409 : 200, body: {} }))
    const shipment = { sourceOrderId: 'cs_1', trackingNumber: '1Z1', carrier: 'UPS', itemIds: ['p1'] }
    await createRouteShipment({ ...ROUTE, fetchImpl }, shipment)
    await createRouteShipment({ ...ROUTE, fetchImpl }, shipment)
    await cancelRouteOrder({ ...ROUTE, fetchImpl }, 'pol/1')
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.route.com/v2/shipments',
      'https://api.route.com/v2/shipments',
      'https://api.route.com/v2/orders/pol%2F1/cancel',
    ])
  })

  it('names a refusal permanent or not', () => {
    expect(new PostPurchaseProviderError('Route', 401, 'x').permanent).toBe(true)
    expect(new PostPurchaseProviderError('Route', 429, 'x').permanent).toBe(false)
    expect(new PostPurchaseProviderError('Route', 503, 'x').permanent).toBe(false)
    expect(new PostPurchaseProviderError('Route', 0, 'x').permanent).toBe(false)
  })
})

describe('AfterShip', () => {
  it('follows a parcel with the carrier’s slug and the order as custom fields', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 201, body: { data: { id: 'trk_1' } } }))
    await expect(
      createAftershipTracking({ apiKey: 'as_key', trackingNumber: '1Z1', carrier: 'UPS Ground', hostId: 'h', recordId: 'o', orderNumber: '1042', fetchImpl }),
    ).resolves.toEqual({ outcome: 'created', trackingId: 'trk_1' })
    expect(calls[0].headers['as-api-key']).toBe('as_key')
    expect(calls[0].body).toMatchObject({ tracking_number: '1Z1', slug: 'ups', custom_fields: { host_id: 'h', record_id: 'o' } })
  })

  it('reads AfterShip’s duplicate code as already followed', async () => {
    const { fetchImpl } = recorder(() => ({ status: 400, body: { meta: { code: 4003 } } }))
    await expect(
      createAftershipTracking({ apiKey: 'k', trackingNumber: '1Z1', hostId: 'h', recordId: 'o', fetchImpl }),
    ).resolves.toEqual({ outcome: 'already', trackingId: null })
  })

  it('verifies the signature before reading, and maps the tag', () => {
    const body = JSON.stringify({
      ts: 1_700_000_000,
      msg: {
        tracking_number: '1Z1',
        tag: 'Delivered',
        custom_fields: { host_id: 'h', record_id: 'o' },
        checkpoints: [{ checkpoint_time: '2026-10-07T12:00:00Z', message: 'Left at front door' }],
      },
    })
    const signature = createHmac('sha256', 'whsec').update(body).digest('base64')
    expect(verifyAftershipWebhook({ rawBody: body, signatureHeader: signature, secret: 'whsec' })).toEqual({
      ok: true,
      event: {
        trackingNumber: '1Z1',
        status: 'delivered',
        detail: 'Left at front door',
        atMs: Date.parse('2026-10-07T12:00:00Z'),
        hostId: 'h',
        recordId: 'o',
      },
    })
    expect(verifyAftershipWebhook({ rawBody: body, signatureHeader: 'forged', secret: 'whsec' })).toMatchObject({ ok: false, status: 401 })
    expect(verifyAftershipWebhook({ rawBody: body, signatureHeader: null, secret: 'whsec' })).toMatchObject({ ok: false, status: 401 })
    expect(verifyAftershipWebhook({ rawBody: body, signatureHeader: signature, secret: null })).toMatchObject({ ok: false, status: 404 })
  })

  it('maps every tag that says something, and ignores the ones that do not', () => {
    expect(aftershipTrackingStatus('InfoReceived')).toBe('pre_transit')
    expect(aftershipTrackingStatus('InTransit')).toBe('in_transit')
    expect(aftershipTrackingStatus('OutForDelivery')).toBe('out_for_delivery')
    expect(aftershipTrackingStatus('AvailableForPickup')).toBe('out_for_delivery')
    expect(aftershipTrackingStatus('AttemptFail')).toBe('exception')
    expect(aftershipTrackingStatus('Exception', 'Exception_011')).toBe('returned')
    expect(aftershipTrackingStatus('Exception', 'Exception_004')).toBe('exception')
    expect(aftershipTrackingStatus('Pending')).toBeNull()
    expect(aftershipTrackingStatus('Expired')).toBeNull()
  })
})

describe('Narvar', () => {
  it('sends the whole order under Basic auth', async () => {
    const { calls, fetchImpl } = recorder(() => ({ status: 200, body: { status: 'SUCCESS' } }))
    await upsertNarvarOrder(
      { accountId: 'acct', authToken: 'tok', apiBase: 'https://ws.narvar.com/api/v1', fetchImpl },
      {
        orderNumber: '1042',
        createdAtMs: Date.UTC(2026, 9, 7),
        status: 'SHIPPED',
        currency: 'usd',
        customer: { name: 'Ann Lee', email: 'ann@example.com' },
        shipTo: { line1: '2 B St', city: 'Boston', postalCode: '02108', country: 'US' },
        items: [{ id: 'p1', name: 'Lamp', sku: 'L-1', quantity: 2, unitCents: 2_500 }],
        shipments: [{ carrier: 'FedEx', trackingNumber: '77', atMs: Date.UTC(2026, 9, 8), lines: [{ itemId: 'p1', sku: 'L-1', quantity: 2 }] }],
      },
    )
    expect(calls[0].headers['Authorization']).toBe(`Basic ${Buffer.from('acct:tok').toString('base64')}`)
    expect(calls[0].body.order_info).toMatchObject({
      order_number: '1042',
      status: 'SHIPPED',
      currency_code: 'USD',
      order_items: [{ item_id: 'p1', sku: 'L-1', quantity: 2, unit_price: '25.00' }],
      shipments: [{ carrier: 'fedex', tracking_number: '77' }],
      customer: { first_name: 'Ann', last_name: 'Lee', email: 'ann@example.com' },
    })
  })

  it('links the retailer’s own tracking page only for a carrier it can name', () => {
    expect(narvarTrackingPage('candles', 'USPS Priority', '9400 1')).toBe(
      'https://candles.narvar.com/candles/tracking/usps?tracking_numbers=94001',
    )
    expect(narvarTrackingPage('candles', 'Pups Express', '1')).toBeNull()
    expect(narvarTrackingPage('Bad Moniker', 'UPS', '1')).toBeNull()
  })
})

describe('carrier words and settings values', () => {
  it('matches a carrier by prefix, never by substring', () => {
    expect(aftershipSlugFor('USPS Priority Mail')).toBe('usps')
    expect(aftershipSlugFor('ups')).toBe('ups')
    expect(aftershipSlugFor('Pups Express')).toBeNull()
    expect(narvarCarrierFor('Canada Post')).toBeNull()
    expect(aftershipSlugFor('Canada Post')).toBe('canada-post')
  })

  it('keeps only an https tracking page with nothing hidden in it', () => {
    expect(normalizeTrackingPageUrl('https://candles.aftership.com/')).toBe('https://candles.aftership.com')
    expect(normalizeTrackingPageUrl('http://candles.aftership.com')).toBeNull()
    expect(normalizeTrackingPageUrl('https://user:pw@x.example')).toBeNull()
    expect(normalizeTrackingPageUrl('https://x.example/?a=1')).toBeNull()
    expect(normalizeTrackingPageUrl('')).toBeNull()
    expect(normalizeRetailerMoniker(' Candles ')).toBe('candles')
    expect(normalizeRetailerMoniker('candles.narvar.com')).toBeNull()
  })
})
