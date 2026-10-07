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

import type { ProviderFetch } from './http'
import { createShippoProvider, SHIPPO_API_BASE } from './shippo'
import { ShippingProviderError } from './types'

/**
 * The Shippo adapter's request shapes, held to the API reference
 * (docs.goshippo.com): every call the platform token with the managed
 * account's header, metric units, `async: false`, and the answers read into
 * cents, keys and badges. `fetch` is a recording double; nothing leaves.
 */

interface Recorded {
  url: string
  method: string
  headers: Record<string, string>
  body: any
}

function recordingFetch(answers: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Recorded[] = []
  const fetchImpl: ProviderFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    const answer = answers.shift() ?? { body: {} }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: answer.headers ?? {},
    })
  }) as ProviderFetch
  return { calls, fetchImpl }
}

const ACCOUNT = { providerId: 'shippo' as const, accountId: 'acct_managed_1' }

describe('Shippo, through platform accounts', () => {
  it('opens a managed account with the platform token and no account header', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { object_id: 'acct_new' } }])
    const provider = createShippoProvider({ token: 'shippo_test_platform', fetchImpl })
    const account = await provider.createAccount({
      orgId: 'org-1',
      name: 'Rosa Diaz',
      email: 'rosa@example.com',
      company: 'Rosa’s Candles',
    })
    expect(account).toEqual({ providerId: 'shippo', accountId: 'acct_new' })
    expect(calls[0].url).toBe(`${SHIPPO_API_BASE}/shippo-accounts`)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers['Authorization']).toBe('ShippoToken shippo_test_platform')
    expect(calls[0].headers['SHIPPO-ACCOUNT-ID']).toBeUndefined()
    expect(calls[0].body).toEqual({
      email: 'rosa@example.com',
      first_name: 'Rosa',
      last_name: 'Diaz',
      company_name: 'Rosa’s Candles',
    })
  })

  it('rates a shipment as the managed account, metric, with badges and cents', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          object_id: 'shp_1',
          rates: [
            {
              object_id: 'rate_a',
              amount: '7.58',
              currency: 'USD',
              provider: 'USPS',
              servicelevel: { name: 'Priority Mail', token: 'usps_priority' },
              estimated_days: 2,
              attributes: ['CHEAPEST', 'FASTEST'],
              carrier_account: 'ca_usps',
            },
            { object_id: '', amount: '1', provider: 'X', servicelevel: { token: 't' } },
          ],
          messages: [{ source: 'UPS', text: 'UPS is not activated' }],
        },
      },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const quote = await provider.quoteRates(ACCOUNT, {
      from: { country: 'US', line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701', name: 'Shop' },
      to: { country: 'US', line1: '2 B St', city: 'Boston', state: 'MA', postalCode: '02108', name: 'Ann' },
      parcels: [{ weightGrams: 900.4, lengthCm: 30, widthCm: 20, heightCm: 10 }],
      currency: 'usd',
      valueCents: 4_000,
      insuranceCents: 4_000,
      signature: 'adult',
    })
    expect(calls[0].url).toBe(`${SHIPPO_API_BASE}/shipments/`)
    expect(calls[0].headers['SHIPPO-ACCOUNT-ID']).toBe('acct_managed_1')
    expect(calls[0].headers['SHIPPO-API-VERSION']).toBe('2018-02-08')
    expect(calls[0].body.async).toBe(false)
    expect(calls[0].body.parcels).toEqual([
      { length: '30', width: '20', height: '10', distance_unit: 'cm', weight: '900', mass_unit: 'g' },
    ])
    expect(calls[0].body.address_to).toMatchObject({ street1: '2 B St', zip: '02108', country: 'US' })
    expect(calls[0].body.extra).toEqual({
      signature_confirmation: 'ADULT',
      insurance: { amount: '40.00', currency: 'USD', content: 'Merchandise' },
    })
    expect(quote.shipmentId).toBe('shp_1')
    expect(quote.rates).toEqual([
      {
        rateId: 'rate_a',
        shipmentId: 'shp_1',
        serviceKey: 'usps:usps_priority',
        carrier: 'USPS',
        service: 'usps_priority',
        label: 'USPS Priority Mail',
        amountCents: 758,
        currency: 'usd',
        estimatedDays: 2,
        badges: ['cheapest', 'fastest'],
        carrierAccountId: 'ca_usps',
      },
    ])
    expect(quote.messages).toEqual(['UPS is not activated'])
  })

  it('declares customs across a border', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { object_id: 'shp_2', rates: [] } }])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    await provider.quoteRates(ACCOUNT, {
      from: { country: 'US' },
      to: { country: 'CA' },
      parcels: [{ weightGrams: 500 }],
      currency: 'usd',
      valueCents: 2_500,
      customs: {
        signer: 'Rosa Diaz',
        items: [{ description: 'Candle', quantity: 2, valueCents: 2_500, weightGrams: 400, hsCode: '3406.00', originCountry: 'US' }],
      },
    })
    expect(calls[0].body.customs_declaration).toEqual({
      contents_type: 'MERCHANDISE',
      non_delivery_option: 'RETURN',
      certify: true,
      certify_signer: 'Rosa Diaz',
      items: [
        {
          description: 'Candle',
          quantity: 2,
          net_weight: '400',
          mass_unit: 'g',
          value_amount: '25.00',
          value_currency: 'USD',
          origin_country: 'US',
          tariff_number: '3406.00',
        },
      ],
    })
  })

  it('buys a label by rate id in the chosen format, and refuses an ERROR transaction', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          object_id: 'txn_1',
          status: 'SUCCESS',
          tracking_number: '9400100000000000000000',
          tracking_url_provider: 'https://tools.usps.com/x',
          label_url: 'https://shippo-delivery.s3.amazonaws.com/label.pdf',
          rate: { object_id: 'rate_a', amount: '7.58', currency: 'USD', provider: 'USPS', servicelevel: { name: 'Priority Mail', token: 'usps_priority' } },
        },
      },
      { body: { object_id: 'txn_2', status: 'ERROR', messages: [{ text: 'Address invalid' }] } },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const label = await provider.buyLabel(ACCOUNT, {
      shipmentId: 'shp_1',
      rateId: 'rate_a',
      format: 'zpl',
      reference: 'host/order/lbl',
    })
    expect(calls[0].url).toBe(`${SHIPPO_API_BASE}/transactions`)
    expect(calls[0].body).toEqual({ rate: 'rate_a', label_file_type: 'ZPLII', metadata: 'host/order/lbl', async: false })
    expect(label).toMatchObject({
      providerLabelId: 'txn_1',
      trackingNumber: '9400100000000000000000',
      labelUrl: 'https://shippo-delivery.s3.amazonaws.com/label.pdf',
      amountCents: 758,
      serviceKey: 'usps:usps_priority',
    })
    await expect(
      provider.buyLabel(ACCOUNT, { shipmentId: 'shp_1', rateId: 'rate_b', format: 'pdf_4x6', reference: 'r' }),
    ).rejects.toMatchObject({ detail: 'Address invalid' })
  })

  it('voids through /refunds and reads its state', async () => {
    const { calls, fetchImpl } = recordingFetch([{ body: { status: 'QUEUED' } }, { body: { status: 'SUCCESS' } }, { body: { status: 'ERROR' } }])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    await expect(provider.voidLabel(ACCOUNT, { providerLabelId: 'txn_1', shipmentId: 'shp_1' })).resolves.toBe('pending')
    expect(calls[0].body).toEqual({ transaction: 'txn_1', async: false })
    await expect(provider.voidLabel(ACCOUNT, { providerLabelId: 'txn_1', shipmentId: 'shp_1' })).resolves.toBe('refunded')
    await expect(provider.voidLabel(ACCOUNT, { providerLabelId: 'txn_1', shipmentId: 'shp_1' })).resolves.toBe('rejected')
  })

  it('registers a tracker and validates an address with the v2 validator', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { body: {} },
      {
        body: {
          recommended_address: { address_line_1: '731 MARKET ST', city_locality: 'SAN FRANCISCO', state_province: 'CA', postal_code: '94103-2007', country_code: 'US' },
          analysis: { validation_result: { value: 'valid' }, address_type: 'commercial' },
        },
      },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    await provider.registerTracker(ACCOUNT, { carrier: 'usps', trackingNumber: '9400', reference: 'h/o' })
    expect(calls[0]).toMatchObject({ url: `${SHIPPO_API_BASE}/tracks/`, method: 'POST', body: { carrier: 'usps', tracking_number: '9400', metadata: 'h/o' } })
    const check = await provider.validateAddress(ACCOUNT, {
      country: 'US',
      line1: '731 Market Street',
      city: 'San Francisco',
      state: 'CA',
      postalCode: '94103',
    })
    expect(calls[1].url).toContain(`${SHIPPO_API_BASE}/v2/addresses/validate?`)
    expect(calls[1].url).toContain('address_line_1=731+Market+Street')
    expect(calls[1].url).toContain('country_code=US')
    expect(check.verdict).toBe('corrected')
    expect(check.suggested).toMatchObject({ line1: '731 MARKET ST', postalCode: '94103-2007', residential: false })
  })

  it('turns a refusal into an error carrying the provider’s words', async () => {
    const { fetchImpl } = recordingFetch([{ status: 400, body: { detail: 'Invalid zip' } }])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const failure = await provider
      .quoteRates(ACCOUNT, { from: { country: 'US' }, to: { country: 'US' }, parcels: [], currency: 'usd', valueCents: 0 })
      .catch((error) => error)
    expect(failure).toBeInstanceOf(ShippingProviderError)
    expect(failure).toMatchObject({ status: 400, detail: 'Invalid zip', providerId: 'shippo' })
  })

  it('connects a UPS account and hands back the carrier’s sign-in from the initiate redirect', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { body: { object_id: 'ca_ups', carrier: 'ups', carrier_name: 'UPS', active: true } },
      { status: 302, body: {}, headers: { location: 'https://www.ups.com/lasso/signin?x=1' } },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const connected = await provider.connectCarrierAccount?.(ACCOUNT, {
      carrier: 'ups',
      accountNumber: '94567e',
      contact: { name: 'Rosa Diaz', email: 'rosa@example.com', phone: '5125550100' },
      address: { country: 'US', line1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701' },
      redirectUri: 'https://app.example.com/back',
      state: 'host-1',
    })
    expect(calls[0].body).toMatchObject({ carrier: 'ups', account_id: '94567e', active: true, parameters: { ups_agreements: true, billing_address_zip: '78701' } })
    expect(calls[1].url).toBe(
      `${SHIPPO_API_BASE}/carrier_accounts/ca_ups/signin/initiate?redirect_uri=https%3A%2F%2Fapp.example.com%2Fback&state=host-1`,
    )
    expect(connected?.authorizeUrl).toBe('https://www.ups.com/lasso/signin?x=1')
    expect(connected?.carrierAccount).toMatchObject({ platformOwned: false, authorization: 'pending' })
  })

  it('reads a parcel’s tracking as the managed account, out for delivery by substatus', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          tracking_status: {
            status: 'TRANSIT',
            substatus: { code: 'out_for_delivery' },
            status_details: 'Out for delivery today',
            status_date: '2026-10-06T14:00:00Z',
          },
          tracking_url_provider: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400',
        },
      },
      { body: { tracking_status: { status: 'UNKNOWN' } } },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const tracking = await provider.getTracking(ACCOUNT, { carrier: 'usps', trackingNumber: '9400 1' })
    expect(calls[0]).toMatchObject({ url: `${SHIPPO_API_BASE}/tracks/usps/9400%201`, method: 'GET' })
    expect(calls[0].headers['SHIPPO-ACCOUNT-ID']).toBe('acct_managed_1')
    expect(tracking).toEqual({
      status: 'out_for_delivery',
      detail: 'Out for delivery today',
      atMs: Date.parse('2026-10-06T14:00:00Z'),
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400',
    })
    // A status the adapter cannot read is never guessed forward.
    await expect(provider.getTracking(ACCOUNT, { carrier: 'usps', trackingNumber: '9400' })).resolves.toMatchObject({
      status: 'pre_transit',
    })
  })

  it('lists carrier accounts, telling Shippo’s own from the merchant’s, and switches one off', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        body: {
          results: [
            { object_id: 'ca_usps', carrier: 'usps', carrier_name: 'USPS', account_id: 'shippo-usps', active: true, is_shippo_account: true },
            {
              object_id: 'ca_ups',
              carrier: 'ups',
              carrier_name: 'UPS ',
              account_id: '94567e',
              active: false,
              is_shippo_account: false,
              object_info: { authentication: { status: 'authorization_pending' } },
            },
            { carrier: 'fedex' },
          ],
        },
      },
      { body: {} },
    ])
    const provider = createShippoProvider({ token: 'tok', fetchImpl })
    const accounts = await provider.listCarrierAccounts(ACCOUNT)
    expect(calls[0].url).toBe(`${SHIPPO_API_BASE}/carrier_accounts?results=100`)
    expect(accounts).toEqual([
      { id: 'ca_usps', carrier: 'usps', carrierName: 'USPS', active: true, platformOwned: true, authorization: 'connected' },
      {
        id: 'ca_ups',
        carrier: 'ups',
        carrierName: 'UPS',
        accountNumber: '94567e',
        active: false,
        platformOwned: false,
        authorization: 'pending',
      },
    ])
    await provider.setCarrierAccountActive?.(ACCOUNT, 'ca_ups', true)
    expect(calls[1]).toMatchObject({ url: `${SHIPPO_API_BASE}/carrier_accounts/ca_ups`, method: 'PUT', body: { active: true } })
  })
})
