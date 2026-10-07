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

import { createEasypostProvider, EASYPOST_API_BASE, readCarrierTypes } from './easypost'
import { createEasyshipProvider, EASYSHIP_API_BASE, easyshipServiceKey } from './easyship'
import type { ProviderFetch } from './http'
import { createSendcloudProvider, SENDCLOUD_API_BASE } from './sendcloud'
import { createShipperHqEngine, ratingInfoFor, readShipperHqQuote, SHIPPERHQ_GRAPHQL_URL } from './shipperhq'
import { createShippoProvider, SHIPPO_CONNECTABLE_CARRIERS } from './shippo'
import { ShippingProviderError, type ProviderShipmentInput } from './types'

/**
 * The merchant-account adapters (AGL-3632) — Easyship, Sendcloud and
 * ShipperHQ — and EasyPost's carrier-type connect, held to each vendor's
 * API reference with every call answered here. Nothing leaves the process.
 */

interface Answer {
  status?: number
  body?: unknown
  raw?: Uint8Array
  headers?: Record<string, string>
}

function recordingFetch(answers: Answer[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
  const fetchImpl: ProviderFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const answer = answers.shift() ?? {}
    if (answer.raw) return new Response(answer.raw as unknown as BodyInit, { status: answer.status ?? 200, headers: answer.headers })
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200, headers: answer.headers })
  }) as ProviderFetch
  return { calls, fetchImpl }
}

const SHIPMENT: ProviderShipmentInput = {
  from: { name: 'Studio', line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
  to: { name: 'Ann', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US', email: 'ann@example.com' },
  parcels: [{ weightGrams: 800, lengthCm: 30, widthCm: 20, heightCm: 10 }],
  currency: 'usd',
  valueCents: 3_000,
}

const INTERNATIONAL: ProviderShipmentInput = {
  ...SHIPMENT,
  to: { name: 'Jo', line1: '9 Rue', city: 'Paris', postalCode: '75001', country: 'FR' },
  customs: {
    items: [{ description: 'Candle', quantity: 2, valueCents: 3_000, weightGrams: 600, hsCode: '340600', originCountry: 'US' }],
    signer: 'Rosa',
  },
}

describe('Easyship, on the merchant’s own account', () => {
  const ACCOUNT = { providerId: 'easyship' as const, accountId: 'org-1', apiKey: 'prod_token' }

  it('checks the token by reading the account, with the merchant’s bearer token', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { account: { name: 'Candle Co', easyship_company_id: 'CUS1' } } }])
    const verified = await createEasyshipProvider({ fetchImpl }).verifyCredentials!(ACCOUNT)
    expect(verified).toEqual({ accountName: 'Candle Co' })
    expect(calls[0]).toMatchObject({ url: `${EASYSHIP_API_BASE}/account`, method: 'GET' })
    expect(calls[0].headers['Authorization']).toBe('Bearer prod_token')
  })

  it('quotes by drafting a shipment, in kilograms and centimetres, and reads its ranked rates', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          shipment: {
            easyship_shipment_id: 'ESUS1',
            rates: [
              {
                courier_service: { id: 'cs-cheap', name: 'USPS Ground Advantage', umbrella_name: 'USPS' },
                total_charge: 7.4,
                currency: 'USD',
                max_delivery_time: 5,
                cost_rank: 1,
                delivery_time_rank: 2,
                value_for_money_rank: 1,
              },
              {
                courier_service: { id: 'cs-fast', name: 'UPS Next Day Air', umbrella_name: 'UPS' },
                total_charge: '41.00',
                currency: 'USD',
                max_delivery_time: 1,
                cost_rank: 2,
                delivery_time_rank: 1,
              },
              { courier_service: null, total_charge: 1 },
            ],
          },
        },
      },
    ])
    const quote = await createEasyshipProvider({ fetchImpl, itemCategory: 'home_decor' }).quoteRates(ACCOUNT, SHIPMENT)
    expect(calls[0]).toMatchObject({ url: `${EASYSHIP_API_BASE}/shipments`, method: 'POST' })
    expect(calls[0].body).toMatchObject({
      origin_address: { line_1: '1 A St', city: 'Austin', postal_code: '78701', country_alpha2: 'US', contact_name: 'Studio' },
      destination_address: { line_1: '2 B St', country_alpha2: 'US', contact_email: 'ann@example.com' },
      incoterms: 'DDU',
      insurance: { is_insured: false },
      shipping_settings: { units: { weight: 'kg', dimensions: 'cm' }, buy_label: false },
      parcels: [
        {
          box: { length: 30, width: 20, height: 10 },
          total_actual_weight: 0.8,
          items: [{ description: 'Merchandise', quantity: 1, declared_currency: 'USD', declared_customs_value: 30, category: 'home_decor' }],
        },
      ],
    })
    expect(quote.shipmentId).toBe('ESUS1')
    expect(quote.rates).toEqual([
      expect.objectContaining({
        rateId: 'cs-cheap',
        shipmentId: 'ESUS1',
        serviceKey: 'usps:usps_ground_advantage',
        amountCents: 740,
        currency: 'usd',
        estimatedDays: 5,
        badges: ['cheapest', 'best_value'],
      }),
      expect.objectContaining({ rateId: 'cs-fast', amountCents: 4_100, badges: ['fastest'] }),
    ])
  })

  it('declares each customs line with its tariff code across a border', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { shipment: { easyship_shipment_id: 'ESUS2', rates: [] } } }])
    const quote = await createEasyshipProvider({ fetchImpl }).quoteRates(ACCOUNT, INTERNATIONAL)
    expect(calls[0].body.parcels[0].items).toEqual([
      {
        description: 'Candle',
        quantity: 2,
        actual_weight: 0.3,
        declared_currency: 'USD',
        declared_customs_value: 15,
        origin_country_alpha2: 'US',
        hs_code: '340600',
      },
    ])
    expect(quote.messages).toEqual(['No courier on the Easyship account serves this shipment.'])
  })

  it('buys the label for the chosen courier and keeps a link it can share', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          shipment: {
            easyship_shipment_id: 'ESUS1',
            label_state: 'generated',
            courier_service: { id: 'cs-cheap', name: 'USPS Ground Advantage', umbrella_name: 'USPS' },
            rates: [{ courier_service: { id: 'cs-cheap' }, total_charge: 7.4, currency: 'USD' }],
            trackings: [{ tracking_number: '9400TRK', leg_number: 1 }],
            tracking_page_url: 'https://www.trackmyshipment.co/shipment-tracking/ESUS1',
            shipping_documents: [{ category: 'label', format: 'url', url: 'https://labels.easyship.com/l.pdf' }],
          },
        },
      },
    ])
    const label = await createEasyshipProvider({ fetchImpl }).buyLabel(ACCOUNT, {
      shipmentId: 'ESUS1',
      rateId: 'cs-cheap',
      format: 'pdf_4x6',
      reference: 'host/order-1/lbl_1',
    })
    expect(calls[0]).toMatchObject({
      url: `${EASYSHIP_API_BASE}/shipments/ESUS1/label`,
      method: 'POST',
      body: { courier_service_id: 'cs-cheap' },
    })
    expect(label).toEqual({
      providerLabelId: 'ESUS1',
      shipmentId: 'ESUS1',
      trackingNumber: '9400TRK',
      trackingUrl: 'https://www.trackmyshipment.co/shipment-tracking/ESUS1',
      labelUrl: 'https://labels.easyship.com/l.pdf',
      carrier: 'USPS',
      serviceKey: 'usps:usps_ground_advantage',
      serviceLabel: 'USPS Ground Advantage',
      amountCents: 740,
      currency: 'usd',
    })
  })

  it('serves a base64-only label through labelDocument, and refuses a failed one', async () => {
    const pdf = Buffer.from('%PDF-1.4 label')
    const { fetchImpl } = recordingFetch([
      {
        body: {
          shipment: {
            easyship_shipment_id: 'ESUS1',
            label_state: 'generated',
            trackings: [{ tracking_number: 'T1' }],
            shipping_documents: [{ category: 'label', format: 'pdf', base64_encoded_strings: [pdf.toString('base64')] }],
          },
        },
      },
      {
        body: {
          shipment: {
            shipping_documents: [{ category: 'label', format: 'pdf', base64_encoded_strings: [pdf.toString('base64')] }],
          },
        },
      },
      { body: { shipment: { label_state: 'failed' } } },
    ])
    const provider = createEasyshipProvider({ fetchImpl })
    const label = await provider.buyLabel(ACCOUNT, { shipmentId: 'ESUS1', rateId: 'cs', format: 'pdf_4x6', reference: 'r' })
    expect(label.labelUrl).toBe('')
    expect(label.documentRef).toBe('label')
    const file = await provider.labelDocument!(ACCOUNT, { documentRef: 'label', shipmentId: 'ESUS1' })
    expect(file.contentType).toBe('application/pdf')
    expect(Buffer.from(file.body).toString()).toBe('%PDF-1.4 label')
    await expect(
      provider.buyLabel(ACCOUNT, { shipmentId: 'ESUS1', rateId: 'cs', format: 'pdf_4x6', reference: 'r' }),
    ).rejects.toBeInstanceOf(ShippingProviderError)
  })

  it('cancels to void, and reads a refusal as rejected rather than an outage', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { body: { success: { message: 'Shipment successfully cancelled' } } },
      { status: 422, body: { error: { message: 'Shipment cannot be cancelled' } } },
      { status: 503, body: {} },
    ])
    const provider = createEasyshipProvider({ fetchImpl })
    expect(await provider.voidLabel(ACCOUNT, { providerLabelId: 'ESUS1', shipmentId: 'ESUS1' })).toBe('refunded')
    expect(calls[0]).toMatchObject({ url: `${EASYSHIP_API_BASE}/shipments/ESUS1/cancel`, method: 'POST' })
    expect(await provider.voidLabel(ACCOUNT, { providerLabelId: 'ESUS1', shipmentId: 'ESUS1' })).toBe('rejected')
    await expect(provider.voidLabel(ACCOUNT, { providerLabelId: 'ESUS1', shipmentId: 'ESUS1' })).rejects.toMatchObject({ status: 503 })
  })

  it('never bills an address check, and opens no account of its own', async () => {
    const { calls, fetchImpl } = recordingFetch([])
    const provider = createEasyshipProvider({ fetchImpl })
    expect(await provider.validateAddress(ACCOUNT, SHIPMENT.to)).toEqual({ verdict: 'unknown', messages: [] })
    expect(await provider.listCarrierAccounts(ACCOUNT)).toEqual([])
    await expect(provider.createAccount({ orgId: 'o', name: 'n', email: 'e', company: 'c' })).rejects.toMatchObject({ status: 501 })
    expect(calls).toHaveLength(0)
  })

  it('keys a service the same way every time', () => {
    expect(easyshipServiceKey('FedEx', 'FedEx International Priority®')).toBe('fedex:fedex_international_priority')
    expect(easyshipServiceKey('', '')).toBe('courier:service')
  })
})

describe('Sendcloud, on the merchant’s own account', () => {
  const ACCOUNT = { providerId: 'sendcloud' as const, accountId: 'org-1', apiKey: 'pub', apiSecret: 'sec' }
  const BASIC = `Basic ${Buffer.from('pub:sec').toString('base64')}`

  it('checks the keys with the metadata of the integration they belong to', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { user_id: 7, integration_id: 4242 } }, { body: {} }])
    const provider = createSendcloudProvider({ fetchImpl })
    expect(await provider.verifyCredentials!(ACCOUNT)).toEqual({ accountName: 'Sendcloud integration 4242' })
    expect(calls[0]).toMatchObject({ url: `${SENDCLOUD_API_BASE}/user/auth/metadata`, method: 'GET' })
    expect(calls[0].headers['Authorization']).toBe(BASIC)
    await expect(provider.verifyCredentials!(ACCOUNT)).rejects.toMatchObject({ status: 401 })
  })

  it('quotes shipping options with prices, and keeps the quote id its own', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          data: [
            {
              code: 'postnl:standard',
              name: 'PostNL Standard',
              carrier: { code: 'postnl', name: 'PostNL' },
              quotes: [{ price: { total: { value: '6.95', currency: 'EUR' } }, lead_time: 30 }],
            },
            { code: 'dhl:express', name: 'DHL Express', carrier: { code: 'dhl', name: 'DHL' }, quotes: [{ price: { total: { value: '19.50', currency: 'EUR' } }, lead_time: 20 }] },
            { code: 'noprice:x', name: 'No price', quotes: null },
          ],
        },
      },
    ])
    const quote = await createSendcloudProvider({ fetchImpl }).quoteRates(ACCOUNT, { ...SHIPMENT, currency: 'eur' })
    expect(calls[0]).toMatchObject({ url: `${SENDCLOUD_API_BASE}/shipping-options`, method: 'POST' })
    expect(calls[0].body).toMatchObject({
      from_address: { country_code: 'US', postal_code: '78701', address_line_1: '1 A St' },
      to_address: { country_code: 'US', postal_code: '02108' },
      parcels: [{ weight: { value: '0.800', unit: 'kg' }, dimensions: { length: '30', width: '20', height: '10', unit: 'cm' } }],
      calculate_quotes: true,
    })
    expect(quote.shipmentId).toMatch(/^sc_[0-9a-f]{32}$/)
    expect(quote.rates).toEqual([
      expect.objectContaining({ rateId: 'postnl:standard', serviceKey: 'postnl:standard', carrier: 'PostNL', amountCents: 695, currency: 'eur', estimatedDays: 2, badges: ['cheapest'] }),
      expect.objectContaining({ rateId: 'dhl:express', amountCents: 1_950, estimatedDays: 1, badges: [] }),
    ])
  })

  it('announces the label from the quoted shipment, customs and all, and serves its file itself', async () => {
    const link = `${new URL(SENDCLOUD_API_BASE).origin}/api/v3/parcels/99/documents/label`
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          data: {
            id: 'shp-77',
            parcels: [
              {
                id: 99,
                tracking_number: 'JVGL1',
                tracking_url: 'https://tracking.sendcloud.sc/JVGL1',
                documents: [{ type: 'label', document_type: 'label', link }],
              },
            ],
          },
        },
      },
      { raw: new Uint8Array(Buffer.from('%PDF')), headers: { 'content-type': 'application/pdf' } },
    ])
    const provider = createSendcloudProvider({ fetchImpl })
    const label = await provider.buyLabel(ACCOUNT, {
      shipmentId: 'sc_1',
      rateId: 'dhl:express',
      format: 'zpl',
      reference: 'host/order-1/lbl_9',
      shipment: INTERNATIONAL,
    })
    expect(calls[0]).toMatchObject({ url: `${SENDCLOUD_API_BASE}/shipments/announce`, method: 'POST' })
    expect(calls[0].body).toMatchObject({
      ship_with: { type: 'shipping_option_code', properties: { shipping_option_code: 'dhl:express' } },
      to_address: { country_code: 'FR', city: 'Paris' },
      label_details: { mime_type: 'application/zpl' },
      customs_information: { invoice_number: 'host/order-1/lbl_9', export_reason: 'commercial_goods' },
      parcels: [
        {
          parcel_items: [
            { description: 'Candle', quantity: 2, hs_code: '340600', origin_country: 'US', price: { value: '15.00', currency: 'USD' } },
          ],
        },
      ],
    })
    expect(label).toMatchObject({
      providerLabelId: 'shp-77',
      shipmentId: 'sc_1',
      trackingNumber: 'JVGL1',
      trackingUrl: 'https://tracking.sendcloud.sc/JVGL1',
      labelUrl: '',
      documentRef: link,
      carrier: 'dhl',
      amountCents: 0,
    })
    const file = await provider.labelDocument!(ACCOUNT, { documentRef: link, shipmentId: 'shp-77' })
    expect(calls[1].headers['Authorization']).toBe(BASIC)
    expect(Buffer.from(file.body).toString()).toBe('%PDF')
  })

  it('never fetches a document off its own host with the merchant’s keys', async () => {
    const { calls, fetchImpl } = recordingFetch([])
    await expect(
      createSendcloudProvider({ fetchImpl }).labelDocument!(ACCOUNT, { documentRef: 'https://evil.example/x', shipmentId: 's' }),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('refuses to announce without what was quoted', async () => {
    const { fetchImpl } = recordingFetch([])
    await expect(
      createSendcloudProvider({ fetchImpl }).buyLabel(ACCOUNT, { shipmentId: 's', rateId: 'r', format: 'pdf_4x6', reference: 'x' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('reads a cancel as refunded, queued or refused', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { body: { data: { status: 'cancelled' } } },
      { status: 202, body: { data: { status: 'queued' } } },
      { status: 409, body: { errors: [{ detail: 'This shipment is already being cancelled.' }] } },
    ])
    const provider = createSendcloudProvider({ fetchImpl })
    expect(await provider.voidLabel(ACCOUNT, { providerLabelId: 'shp-77', shipmentId: 'sc_1' })).toBe('refunded')
    expect(calls[0].url).toBe(`${SENDCLOUD_API_BASE}/shipments/shp-77/cancel`)
    expect(await provider.voidLabel(ACCOUNT, { providerLabelId: 'shp-77', shipmentId: 'sc_1' })).toBe('pending')
    expect(await provider.voidLabel(ACCOUNT, { providerLabelId: 'shp-77', shipmentId: 'sc_1' })).toBe('rejected')
  })

  it('reads a parcel’s latest tracking event', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          events: [
            { event_at: '2026-10-01T10:00:00Z', phase: 'announced' },
            { event_at: '2026-10-03T10:00:00Z', phase: 'delivered', description: 'Delivered to recipient' },
          ],
          tracking_numbers: [{ tracking_url: 'https://t.example/1' }],
        },
      },
    ])
    const tracking = await createSendcloudProvider({ fetchImpl }).getTracking(ACCOUNT, { carrier: 'dhl', trackingNumber: 'JVGL 1' })
    expect(calls[0].url).toBe(`${SENDCLOUD_API_BASE}/parcels/tracking/JVGL%201`)
    expect(tracking).toEqual({
      status: 'delivered',
      detail: 'Delivered to recipient',
      atMs: Date.parse('2026-10-03T10:00:00Z'),
      trackingUrl: 'https://t.example/1',
    })
  })
})

describe('ShipperHQ, the merchant’s checkout rate rules', () => {
  const CREDENTIALS = { apiKey: 'key', authCode: 'code', scope: 'LIVE' as const, weightUnit: 'lb' as const }
  const QUOTE = {
    data: {
      retrieveShippingQuote: {
        transactionId: 't1',
        carriers: [
          {
            carrierCode: 'ups',
            carrierTitle: 'UPS',
            shippingRates: [
              { code: 'GND', title: 'Ground', totalCharges: 9.5 },
              { code: '2DA', title: 'UPS 2nd Day Air', totalCharges: '21.00' },
            ],
          },
          { carrierCode: 'flat', carrierTitle: 'Free Shipping', shippingRates: [{ code: 'free', title: 'Free', totalCharges: 0 }] },
          { carrierCode: 'fedex', carrierTitle: 'FedEx', error: { externalErrorMessage: 'FedEx does not deliver here' } },
        ],
        errors: [],
      },
    },
  }

  it('mints a token, then asks for a quote with the scope and a session', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { data: { createSecretToken: { token: 'jwt-1' } } } }, { body: QUOTE }, { body: QUOTE }])
    const engine = createShipperHqEngine({ fetchImpl })
    const result = await engine.quote('org-1', CREDENTIALS, { to: SHIPMENT.to, parcels: SHIPMENT.parcels, currency: 'usd', valueCents: 3_000 })
    expect(calls[0]).toMatchObject({ url: SHIPPERHQ_GRAPHQL_URL, method: 'POST', body: { variables: { api_key: 'key', auth_code: 'code' } } })
    expect(calls[0].body.query).toContain('createSecretToken(api_key: $api_key, auth_code: $auth_code)')
    expect(calls[1].headers).toMatchObject({ 'X-ShipperHQ-Secret-Token': 'jwt-1', 'X-ShipperHQ-Scope': 'LIVE' })
    expect(calls[1].headers['X-ShipperHQ-Session']).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls[1].body.query).toContain('retrieveShippingQuote(ratingInfo: $ratingInfo)')
    expect(calls[1].body.variables.ratingInfo).toMatchObject({
      cart: { declaredValue: 30, freeShipping: false, items: [{ itemId: '1', qty: 1, type: 'SIMPLE', weight: 1.76, storePrice: 30 }] },
      destination: { country: 'US', region: 'MA', city: 'Boston', zipcode: '02108' },
      cartType: 'STD',
      siteDetails: { ecommerceCart: 'Aglyn' },
    })
    expect(result.quotes).toEqual([
      { serviceKey: 'flat:free', carrier: 'Free Shipping', service: 'Free', label: 'Free Shipping Free', amountCents: 0, currency: 'usd' },
      { serviceKey: 'ups:gnd', carrier: 'UPS', service: 'Ground', label: 'UPS Ground', amountCents: 950, currency: 'usd' },
      { serviceKey: 'ups:2da', carrier: 'UPS', service: 'UPS 2nd Day Air', label: 'UPS 2nd Day Air', amountCents: 2_100, currency: 'usd' },
    ])
    expect(result.messages).toEqual(['FedEx does not deliver here'])
    // The token is reused for the next quote.
    await engine.quote('org-1', CREDENTIALS, { to: SHIPMENT.to, parcels: SHIPMENT.parcels, currency: 'usd', valueCents: 3_000 })
    expect(calls).toHaveLength(3)
  })

  it('mints again once when ShipperHQ refuses a held token', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { body: { data: { createSecretToken: { token: 'old' } } } },
      { status: 401, body: { errors: [{ message: 'Token expired' }] } },
      { body: { data: { createSecretToken: { token: 'new' } } } },
      { body: QUOTE },
    ])
    const result = await createShipperHqEngine({ fetchImpl }).quote('org-1', CREDENTIALS, {
      to: SHIPMENT.to,
      parcels: SHIPMENT.parcels,
      currency: 'usd',
      valueCents: 3_000,
    })
    expect(calls[3].headers['X-ShipperHQ-Secret-Token']).toBe('new')
    expect(result.quotes).toHaveLength(3)
  })

  it('refuses credentials that mint no token, in ShipperHQ’s words', async () => {
    const { fetchImpl } = recordingFetch([{ body: { data: { createSecretToken: null }, errors: [{ message: 'Invalid credentials' }] } }])
    await expect(createShipperHqEngine({ fetchImpl }).verify(CREDENTIALS)).rejects.toMatchObject({ status: 401, providerId: 'shipperhq' })
  })

  it('weighs in kilograms when the website does, and splits value by weight across parcels', () => {
    const info = ratingInfoFor(
      { ...CREDENTIALS, weightUnit: 'kg' },
      { to: SHIPMENT.to, parcels: [{ weightGrams: 1_500 }, { weightGrams: 500 }], currency: 'usd', valueCents: 10_000 },
    ) as any
    expect(info.cart.items.map((item: any) => [item.weight, item.storePrice])).toEqual([
      [1.5, 75],
      [0.5, 25],
    ])
  })

  it('reads an empty or malformed answer as no quotes', () => {
    expect(readShipperHqQuote(null, 'usd')).toEqual({ quotes: [], messages: [] })
    expect(
      readShipperHqQuote({ carriers: [{ carrierCode: 'x', shippingRates: [{ code: 'y', totalCharges: 'n/a' }] }] }, 'usd').quotes,
    ).toEqual([])
  })
})

describe('connecting a carrier account of the merchant’s own', () => {
  it('reads EasyPost’s carrier types into forms, leaving out custom workflows and hidden fields', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: [
          {
            type: 'DhlExpressAccount',
            readable: 'DHL Express',
            fields: {
              credentials: {
                account_number: { visibility: 'visible', label: 'DHL Account Number' },
                password: { visibility: 'password', label: 'Password' },
                is_reseller: { visibility: 'checkbox', label: 'Reseller account' },
                internal: { visibility: 'fake', label: 'Internal' },
              },
            },
          },
          { type: 'UpsAccount', readable: 'UPS', fields: { custom_workflow: true, credentials: { account_number: {} } } },
          { type: 'CanadaPostAccount', readable: 'Canada Post', fields: { credentials: { api_key: { visibility: 'masked', label: 'API key' } } } },
          { type: 'bad type', fields: { credentials: { a: {} } } },
        ],
      },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZAKplatform', fetchImpl })
    const forms = await provider.connectableCarriers!({ providerId: 'easypost', accountId: 'u', apiKey: 'EZAKchild' })
    expect(calls[0]).toMatchObject({ url: `${EASYPOST_API_BASE}/carrier_types`, method: 'GET' })
    expect(forms).toEqual([
      { carrier: 'CanadaPostAccount', label: 'Canada Post', flow: 'credentials', fields: [{ key: 'api_key', label: 'API key', secret: true }] },
      {
        carrier: 'DhlExpressAccount',
        label: 'DHL Express',
        flow: 'credentials',
        fields: [
          { key: 'account_number', label: 'DHL Account Number', secret: false },
          { key: 'password', label: 'Password', secret: true },
          { key: 'is_reseller', label: 'Reseller account', secret: false, checkbox: true },
        ],
      },
    ])
    expect(readCarrierTypes(null)).toEqual([])
  })

  it('connects one on EasyPost with the child’s key and the carrier’s own credentials', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { id: 'ca_dhl', type: 'DhlExpressAccount', readable: 'DHL Express' } }])
    const provider = createEasypostProvider({ apiKey: 'EZAKplatform', fetchImpl })
    const connected = await provider.connectCarrierAccount!(
      { providerId: 'easypost', accountId: 'u', apiKey: 'EZAKchild' },
      {
        carrier: 'DhlExpressAccount',
        accountNumber: '',
        credentials: { account_number: '12345', password: 'pw', 'bad key!': 'x', empty: '' },
        contact: { name: '', email: '', phone: '' },
        address: { country: 'US' },
      },
    )
    expect(calls[0]).toMatchObject({
      url: `${EASYPOST_API_BASE}/carrier_accounts`,
      method: 'POST',
      body: {
        carrier_account: {
          type: 'DhlExpressAccount',
          description: 'DhlExpress (own account)',
          credentials: { account_number: '12345', password: 'pw' },
        },
      },
    })
    expect(calls[0].headers['Authorization']).toBe(`Basic ${Buffer.from('EZAKchild:').toString('base64')}`)
    expect(connected.carrierAccount).toEqual({
      id: 'ca_dhl',
      carrier: 'dhlexpress',
      carrierName: 'DHL Express',
      accountNumber: '12345',
      active: true,
      platformOwned: false,
      authorization: 'connected',
    })
  })

  it('offers Shippo’s two account-holder forms, and refuses any other carrier there', async () => {
    const { calls, fetchImpl } = recordingFetch([])
    const provider = createShippoProvider({ token: 'shippo_live_x', fetchImpl })
    expect(await provider.connectableCarriers!({ providerId: 'shippo', accountId: 'a' })).toBe(SHIPPO_CONNECTABLE_CARRIERS)
    await expect(
      provider.connectCarrierAccount!(
        { providerId: 'shippo', accountId: 'a' },
        { carrier: 'DhlExpressAccount', accountNumber: '1', contact: { name: 'a', email: 'b', phone: 'c' }, address: { country: 'US' } },
      ),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls).toHaveLength(0)
  })
})
