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
import { createMockHttp } from '../testing/mock-http'
import { createDoordashDriveProvider, doordashAddress, doordashDriveJwt, readDoordashWebhook } from './doordash'
import { ProviderError } from './http'
import type { CourierDropRequest, CourierKeys } from './provider'

/**
 * DoorDash Drive, with mocked HTTP (AGL-3695): every call the adapter makes —
 * its JWT, its paths, the drop it sends — and every answer it reads back.
 */

const SECRET = Buffer.from('a-signing-secret-of-enough-length').toString('base64url')
const KEYS: CourierKeys = { developerId: 'dev-123', keyId: 'key-456', signingSecret: SECRET }
const NOW = Date.UTC(2026, 9, 8, 15, 0, 0)

const drop: CourierDropRequest = {
  deliveryRef: 'aglyn-order-1-1',
  displayRef: '#1042',
  pickup: {
    name: 'Northwind Bakery — Main Street',
    address: { line1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' },
    phone: '+12175550100',
    instructions: 'Ask at the counter',
  },
  dropoff: {
    name: 'Ada Lovelace',
    address: { line1: '9 Elm St', line2: 'Apt 2', city: 'Springfield', state: 'IL', postalCode: '62704', country: 'US' },
    phone: '+12175550199',
  },
  valueCents: 1000,
  currency: 'usd',
  itemCount: 2,
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

describe('DoorDash Drive JWT', () => {
  it('signs DD-JWT-V1 claims with the decoded secret, for five minutes', () => {
    const token = doordashDriveJwt(KEYS, NOW)
    const [header, payload, signature] = token.split('.')
    expect(decode(header)).toEqual({ alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' })
    expect(decode(payload)).toEqual({ aud: 'doordash', iss: 'dev-123', kid: 'key-456', iat: NOW / 1000, exp: NOW / 1000 + 300 })
    const expected = createHmac('sha256', Buffer.from(SECRET, 'base64url')).update(`${header}.${payload}`).digest('base64url')
    expect(signature).toBe(expected)
  })
})

describe('DoorDash Drive adapter', () => {
  it('prices a drop under our reference, with both ends and the value', async () => {
    const { http, calls } = createMockHttp(() => ({
      status: 200,
      body: {
        external_delivery_id: 'aglyn-order-1-1',
        delivery_status: 'quote',
        fee: 975,
        currency: 'USD',
        pickup_time_estimated: '2026-10-08T15:20:00Z',
        dropoff_time_estimated: '2026-10-08T15:45:00Z',
      },
    }))
    const quote = await createDoordashDriveProvider({ http, now: () => NOW }).quote(KEYS, drop)
    expect(quote).toEqual({
      deliveryRef: 'aglyn-order-1-1',
      feeCents: 975,
      currency: 'usd',
      pickupEtaMs: Date.parse('2026-10-08T15:20:00Z'),
      dropoffEtaMs: Date.parse('2026-10-08T15:45:00Z'),
      expiresAtMs: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://openapi.doordash.com/drive/v2/quotes')
    expect(calls[0].headers['Authorization']).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    expect(calls[0].body).toEqual({
      external_delivery_id: 'aglyn-order-1-1',
      pickup_address: '1 Main St, Springfield, IL 62701, US',
      pickup_business_name: 'Northwind Bakery — Main Street',
      pickup_phone_number: '+12175550100',
      pickup_instructions: 'Ask at the counter',
      pickup_reference_tag: 'Order #1042',
      dropoff_address: '9 Elm St Apt 2, Springfield, IL 62704, US',
      dropoff_contact_given_name: 'Ada Lovelace',
      dropoff_phone_number: '+12175550199',
      order_value: 1000,
      currency: 'USD',
    })
  })

  it('refuses a quote with no price', async () => {
    const { http } = createMockHttp(() => ({ status: 200, body: { external_delivery_id: 'x' } }))
    await expect(createDoordashDriveProvider({ http }).quote(KEYS, drop)).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('books the quote once, never retrying in the call', async () => {
    const { http, calls } = createMockHttp(() => ({ status: 503, body: { message: 'busy' } }))
    await expect(createDoordashDriveProvider({ http }).accept(KEYS, 'aglyn-order-1-1')).rejects.toMatchObject({
      kind: 'transient',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://openapi.doordash.com/drive/v2/quotes/aglyn-order-1-1/accept')
  })

  it('reads a booked run', async () => {
    const { http } = createMockHttp(() => ({
      status: 200,
      body: {
        external_delivery_id: 'aglyn-order-1-1',
        delivery_status: 'created',
        tracking_url: 'https://doordash.com/drive/portal/track/abc',
        fee: 975,
        dropoff_time_estimated: '2026-10-08T15:45:00Z',
      },
    }))
    const run = await createDoordashDriveProvider({ http }).accept(KEYS, 'aglyn-order-1-1')
    expect(run).toMatchObject({
      deliveryRef: 'aglyn-order-1-1',
      state: 'requested',
      trackingUrl: 'https://doordash.com/drive/portal/track/abc',
      feeCents: 975,
      etaMs: Date.parse('2026-10-08T15:45:00Z'),
    })
  })

  it('maps every delivery status DoorDash reports', async () => {
    const statuses: Array<[string, string | null]> = [
      ['quote', null],
      ['created', 'requested'],
      ['confirmed', 'assigned'],
      ['enroute_to_pickup', 'assigned'],
      ['arrived_at_pickup', 'at_pickup'],
      ['picked_up', 'picked_up'],
      ['enroute_to_dropoff', 'picked_up'],
      ['arrived_at_dropoff', 'at_dropoff'],
      ['delivered', 'delivered'],
      ['enroute_to_return', 'returning'],
      ['returned', 'returned'],
      ['cancelled', 'cancelled'],
    ]
    for (const [status, state] of statuses) {
      const { http } = createMockHttp(() => ({ status: 200, body: { external_delivery_id: 'r', delivery_status: status } }))
      const run = await createDoordashDriveProvider({ http }).get(KEYS, 'r')
      expect(`${status}: ${run.state}`).toBe(`${status}: ${state}`)
    }
  })

  it('cancels with PUT and reads the reason', async () => {
    const { http, calls } = createMockHttp(() => ({
      status: 200,
      body: { external_delivery_id: 'r', delivery_status: 'cancelled', cancellation_reason: 'cancelled_by_creator' },
    }))
    const run = await createDoordashDriveProvider({ http }).cancel(KEYS, 'r')
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://openapi.doordash.com/drive/v2/deliveries/r/cancel' })
    expect(run).toMatchObject({ state: 'cancelled', reason: 'cancelled by creator' })
  })

  it('passes good keys: a lookup of a run that cannot exist answers 404', async () => {
    const { http, calls } = createMockHttp(() => ({ status: 404, body: { message: 'not found' } }))
    await expect(createDoordashDriveProvider({ http }).test(KEYS)).resolves.toBeUndefined()
    expect(calls[0].url).toBe('https://openapi.doordash.com/drive/v2/deliveries/aglyn-key-check')
  })

  it('refuses bad keys', async () => {
    const { http } = createMockHttp(() => ({ status: 401, body: { message: 'invalid token' } }))
    const failure = await createDoordashDriveProvider({ http }).test(KEYS).catch((error) => error)
    expect(failure).toBeInstanceOf(ProviderError)
    expect(failure.kind).toBe('auth')
  })

  it('keeps an address to one line', () => {
    expect(doordashAddress({ name: 'x', address: { line1: '1 A St', postalCode: '1000', country: 'AU' } })).toBe(
      '1 A St, 1000, AU',
    )
  })
})

describe('DoorDash Drive webhooks', () => {
  it('reads the run and the step an event names', () => {
    expect(
      readDoordashWebhook({
        event_name: 'DASHER_PICKED_UP',
        created_at: '2026-10-08T15:30:00Z',
        external_delivery_id: 'aglyn-order-1-1',
        tracking_url: 'https://doordash.com/drive/portal/track/abc',
        dropoff_time_estimated: '2026-10-08T15:45:00Z',
      }),
    ).toEqual({
      deliveryRef: 'aglyn-order-1-1',
      state: 'picked_up',
      trackingUrl: 'https://doordash.com/drive/portal/track/abc',
      etaMs: Date.parse('2026-10-08T15:45:00Z'),
      pickupEtaMs: null,
      feeCents: null,
      currency: null,
      reason: null,
      eventKey: 'DASHER_PICKED_UP|2026-10-08T15:30:00Z|aglyn-order-1-1',
    })
  })

  it('reads a cancellation and its reason', () => {
    expect(
      readDoordashWebhook({
        event_name: 'DELIVERY_CANCELLED',
        external_delivery_id: 'r',
        cancellation_reason: 'too_late',
        cancellation_reason_message: 'No Dasher could take it',
      }),
    ).toMatchObject({ state: 'cancelled', reason: 'No Dasher could take it' })
  })

  it('moves nothing on an event it does not know, and reads no run from a body without one', () => {
    expect(readDoordashWebhook({ event_name: 'DELIVERY_BATCHED', external_delivery_id: 'r' })?.state).toBeNull()
    expect(readDoordashWebhook({ event_name: 'DASHER_PICKED_UP' })).toBeNull()
    expect(readDoordashWebhook('nonsense')).toBeNull()
  })

  it('never takes a tracking link that is not https', () => {
    expect(
      readDoordashWebhook({ event_name: 'DASHER_CONFIRMED', external_delivery_id: 'r', tracking_url: 'javascript:alert(1)' })
        ?.trackingUrl,
    ).toBeNull()
  })
})
