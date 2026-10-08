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

import { badgeRates, combineParcels, createEasypostProvider, EASYPOST_API_BASE } from './easypost'
import type { ProviderFetch } from './http'

/**
 * The EasyPost adapter's request shapes, held to its API reference: a child
 * user opened with the platform key, every later call the child's own key
 * by basic auth, inches and ounces, one parcel per shipment.
 */

function recordingFetch(answers: unknown[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = []
  const fetchImpl: ProviderFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      method: String(init.method ?? 'GET'),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify(answers.shift() ?? {}), { status: 200 })
  }) as ProviderFetch
  return { calls, fetchImpl }
}

const basic = (key: string) => `Basic ${Buffer.from(`${key}:`).toString('base64')}`
const CHILD = { providerId: 'easypost' as const, accountId: 'user_child', apiKey: 'EZTKchild' }

describe('EasyPost, through child users', () => {
  it('opens a child user with the platform key and keeps the key of the same mode', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        id: 'user_child',
        api_keys: [
          { mode: 'test', key: 'EZTKchild', active: true },
          { mode: 'production', key: 'EZAKchild', active: true },
        ],
      },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const account = await provider.createAccount({ orgId: 'o', name: 'Rosa', email: 'r@example.com', company: 'Candles' })
    expect(calls[0]).toMatchObject({ url: `${EASYPOST_API_BASE}/users`, method: 'POST', body: { user: { name: 'Candles' } } })
    expect(calls[0].headers['Authorization']).toBe(basic('EZTKplatform'))
    expect(account).toEqual({ providerId: 'easypost', accountId: 'user_child', apiKey: 'EZTKchild' })
  })

  it('rates as the child, in inches and ounces, and works out the badges', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        id: 'shp_ep',
        rates: [
          { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '8.10', currency: 'USD', delivery_days: 2 },
          { id: 'rate_2', carrier: 'USPS', service: 'GroundAdvantage', rate: '5.20', currency: 'USD', delivery_days: 5 },
        ],
      },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const quote = await provider.quoteRates(CHILD, {
      from: { country: 'US' },
      to: { country: 'US' },
      parcels: [{ weightGrams: 453.59237, lengthCm: 25.4, widthCm: 12.7, heightCm: 2.54 }],
      currency: 'usd',
      valueCents: 0,
      signature: 'standard',
    })
    expect(calls[0].headers['Authorization']).toBe(basic('EZTKchild'))
    expect(calls[0].body.shipment.parcel).toEqual({ length: 10, width: 5, height: 1, weight: 16 })
    expect(calls[0].body.shipment.options).toEqual({ delivery_confirmation: 'SIGNATURE' })
    expect(quote.rates.map((rate) => [rate.serviceKey, rate.amountCents, rate.badges])).toEqual([
      ['usps:priority', 810, ['fastest']],
      ['usps:groundadvantage', 520, ['cheapest']],
    ])
  })

  it('buys by shipment and rate, then fetches the label in the chosen format', async () => {
    const { calls, fetchImpl } = recordingFetch([
      {
        id: 'shp_ep',
        tracking_code: 'EZ1000',
        tracker: { public_url: 'https://track.easypost.com/x' },
        postage_label: { label_url: 'https://easypost-files.s3.amazonaws.com/label.png' },
        selected_rate: { id: 'rate_1', carrier: 'USPS', service: 'Priority', rate: '8.10', currency: 'USD' },
      },
      { postage_label: { label_url: 'https://e/l.png', label_zpl_url: 'https://easypost-files.s3.amazonaws.com/label.zpl' } },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const label = await provider.buyLabel(CHILD, {
      shipmentId: 'shp_ep',
      rateId: 'rate_1',
      format: 'zpl',
      insuranceCents: 5_000,
      reference: 'r',
    })
    expect(calls[0]).toMatchObject({
      url: `${EASYPOST_API_BASE}/shipments/shp_ep/buy`,
      body: { rate: { id: 'rate_1' }, insurance: '50.00' },
    })
    expect(calls[1].url).toBe(`${EASYPOST_API_BASE}/shipments/shp_ep/label?file_format=ZPL`)
    expect(label).toMatchObject({
      providerLabelId: 'shp_ep',
      trackingNumber: 'EZ1000',
      labelUrl: 'https://easypost-files.s3.amazonaws.com/label.zpl',
      amountCents: 810,
    })
  })

  it('refunds a shipment and reads the refund state', async () => {
    const { calls, fetchImpl } = recordingFetch([{ refund_status: 'submitted' }, { refund_status: 'rejected' }])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    await expect(provider.voidLabel(CHILD, { providerLabelId: 'shp_ep', shipmentId: 'shp_ep' })).resolves.toBe('pending')
    expect(calls[0].url).toBe(`${EASYPOST_API_BASE}/shipments/shp_ep/refund`)
    await expect(provider.voidLabel(CHILD, { providerLabelId: 'shp_ep', shipmentId: 'shp_ep' })).resolves.toBe('rejected')
  })

  it('verifies delivery for an address and offers the correction', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { street1: '417 MONTGOMERY ST FL 5', city: 'SAN FRANCISCO', state: 'CA', zip: '94104-1129', country: 'US', verifications: { delivery: { success: true, errors: [] } } },
      { verifications: { delivery: { success: false, errors: [{ message: 'Address not found' }] } } },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const corrected = await provider.validateAddress(CHILD, { country: 'US', line1: '417 Montgomery St', city: 'SF', state: 'CA', postalCode: '94104' })
    expect(calls[0].body.verify).toEqual(['delivery'])
    expect(corrected.verdict).toBe('corrected')
    const invalid = await provider.validateAddress(CHILD, { country: 'US', line1: 'nowhere' })
    expect(invalid).toEqual({ verdict: 'invalid', messages: ['Address not found'] })
  })

  it('places a verified address on the map, for local delivery distance zones (AGL-3624)', async () => {
    const { fetchImpl } = recordingFetch([
      {
        street1: '417 MONTGOMERY ST',
        city: 'SAN FRANCISCO',
        state: 'CA',
        zip: '94104',
        country: 'US',
        verifications: { delivery: { success: true, errors: [], details: { latitude: 37.79342, longitude: -122.40288 } } },
      },
      { street1: '1 A St', verifications: { delivery: { success: true, errors: [], details: { latitude: null, longitude: null } } } },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const placed = await provider.validateAddress(CHILD, { country: 'US', line1: '417 MONTGOMERY ST', city: 'SAN FRANCISCO', state: 'CA', postalCode: '94104' })
    expect(placed).toEqual({ verdict: 'valid', messages: [], coordinates: { lat: 37.79342, lng: -122.40288 } })
    const unplaced = await provider.validateAddress(CHILD, { country: 'US', line1: '1 A St' })
    expect(unplaced.coordinates).toBeUndefined()
  })

  it('rates several parcels as one never lighter or smaller than the box', () => {
    expect(
      combineParcels([
        { weightGrams: 500, lengthCm: 20, widthCm: 10, heightCm: 5 },
        { weightGrams: 700, lengthCm: 15, widthCm: 30, heightCm: 2 },
      ]),
    ).toEqual({ weightGrams: 1200, lengthCm: 20, widthCm: 30, heightCm: 5 })
    expect(badgeRates([])).toEqual([])
  })

  it('follows a tracking number as the child and reads its status', async () => {
    const { calls, fetchImpl } = recordingFetch([
      { status: 'delivered', status_detail: 'arrived_at_destination', updated_at: '2026-10-06T15:00:00Z', public_url: 'https://track.easypost.com/x' },
      {},
      { status: 'something_new' },
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const tracking = await provider.getTracking(CHILD, { carrier: 'USPS', trackingNumber: '9400' })
    expect(calls[0]).toMatchObject({
      url: `${EASYPOST_API_BASE}/trackers`,
      method: 'POST',
      body: { tracker: { tracking_code: '9400', carrier: 'USPS' } },
    })
    expect(calls[0].headers['Authorization']).toBe(basic('EZTKchild'))
    expect(tracking).toEqual({
      status: 'delivered',
      detail: 'arrived_at_destination',
      atMs: Date.parse('2026-10-06T15:00:00Z'),
      trackingUrl: 'https://track.easypost.com/x',
    })
    await provider.registerTracker(CHILD, { carrier: 'USPS', trackingNumber: '9401', reference: 'h/o' })
    expect(calls[1]).toMatchObject({ url: `${EASYPOST_API_BASE}/trackers`, body: { tracker: { tracking_code: '9401', carrier: 'USPS' } } })
    // A status the adapter does not know is never guessed forward.
    await expect(provider.getTracking(CHILD, { carrier: 'USPS', trackingNumber: '9400' })).resolves.toMatchObject({ status: 'pre_transit' })
  })

  it('lists the child’s carrier accounts, EasyPost’s own and the merchant’s', async () => {
    const { calls, fetchImpl } = recordingFetch([
      [
        { id: 'ca_ep_usps', type: 'UspsAccount', readable: 'USPS', billing_type: 'easypost', description: 'USPS' },
        { id: 'ca_ep_ups', type: 'UpsAccount', readable: 'UPS', billing_type: 'carrier', description: 'My UPS' },
        { type: 'FedexAccount' },
      ],
    ])
    const provider = createEasypostProvider({ apiKey: 'EZTKplatform', fetchImpl })
    const accounts = await provider.listCarrierAccounts(CHILD)
    expect(calls[0]).toMatchObject({ url: `${EASYPOST_API_BASE}/carrier_accounts`, method: 'GET' })
    expect(accounts).toEqual([
      { id: 'ca_ep_usps', carrier: 'usps', carrierName: 'USPS', active: true, platformOwned: true, authorization: 'connected' },
      { id: 'ca_ep_ups', carrier: 'ups', carrierName: 'UPS', active: true, platformOwned: false, authorization: 'connected' },
    ])
  })
})
