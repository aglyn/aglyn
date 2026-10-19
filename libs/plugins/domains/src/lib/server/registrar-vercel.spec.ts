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

import { VERCEL_REGISTRAR } from './registrar-vercel'

const fetchMock = jest.fn()

function respond(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.VERCEL_TOKEN = 'tok'
  process.env.VERCEL_TEAM_ID = 'team_1'
})

afterEach(() => {
  delete process.env.VERCEL_TOKEN
  delete process.env.VERCEL_TEAM_ID
})

describe("Vercel's registrar driver (AGL-3962)", () => {
  it('is not configured without a token', () => {
    delete process.env.VERCEL_TOKEN
    expect(VERCEL_REGISTRAR.configured()).toBe(false)
  })

  it('searches in the team and reads prices and premium', async () => {
    fetchMock.mockResolvedValue(
      respond(200, {
        results: [
          { domain: 'testbakery.com', available: true, years: 1, price: 11.25, renewalPrice: 11.25, premium: false },
          { domain: 'testbakery.net', available: false },
        ],
      }),
    )
    const result = await VERCEL_REGISTRAR.search(['testbakery.com', 'testbakery.net'])
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vercel.com/v1/registrar/domains/search?teamId=team_1')
    expect(result).toEqual({
      ok: 'yes',
      value: [
        { domain: 'testbakery.com', available: true, premium: false, years: 1, purchaseUsd: 11.25, renewalUsd: 11.25 },
        { domain: 'testbakery.net', available: false, premium: false, years: 1, purchaseUsd: 0, renewalUsd: 0 },
      ],
    })
  })

  it('sends the price guard and the contact on a purchase', async () => {
    fetchMock.mockResolvedValue(respond(200, { orderId: 'ord_1', _links: {} }))
    const result = await VERCEL_REGISTRAR.buy({
      domain: 'testbakery.com',
      years: 1,
      expectedPriceUsd: 11.25,
      autoRenew: true,
      contact: {
        firstName: 'Alex', lastName: 'Test', email: 'a@b.co', phone: '+1.5125550123',
        address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', country: 'US',
      },
    })
    expect(result).toEqual({ ok: 'yes', value: { orderId: 'ord_1' } })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body).toMatchObject({ autoRenew: true, years: 1, expectedPrice: 11.25 })
    expect(body.contactInformation).not.toHaveProperty('address2')
  })

  it('answers a refusal as its code, and a 5xx as retryable', async () => {
    fetchMock.mockResolvedValueOnce(respond(400, { error: { code: 'expected_price_mismatch', message: 'x' } }))
    expect(await VERCEL_REGISTRAR.renew({ domain: 'a.com', years: 1, expectedPriceUsd: 1 })).toEqual({ ok: 'no', code: 'expected_price_mismatch', retryable: false })
    fetchMock.mockResolvedValueOnce(respond(503, {}))
    expect(await VERCEL_REGISTRAR.renewalPrice('a.com')).toEqual({ ok: 'no', code: 'http_503', retryable: true })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    expect(await VERCEL_REGISTRAR.authCode('a.com')).toEqual({ ok: 'no', code: 'timeout', retryable: true })
  })

  it('reads an order as failed when its line was refunded', async () => {
    fetchMock.mockResolvedValue(
      respond(200, { orderId: 'o', status: 'completed', domains: [{ status: 'refunded', error: { code: 'price-change' } }] }),
    )
    expect(await VERCEL_REGISTRAR.order('o')).toEqual({
      ok: 'yes',
      value: { orderId: 'o', status: 'failed', failure: 'price-change' },
    })
  })

  it('owns only a name the team bought, and treats a missing one as not owned', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { domain: { boughtAt: 1, expiresAt: 2, renew: true } }))
    expect(await VERCEL_REGISTRAR.info('a.com')).toEqual({
      ok: 'yes',
      value: { owned: true, registeredAtMs: 1, expiresAtMs: 2, autoRenew: true },
    })
    fetchMock.mockResolvedValueOnce(respond(200, { domain: { boughtAt: null, expiresAt: null, renew: false } }))
    expect((await VERCEL_REGISTRAR.info('b.com')).ok === 'yes').toBe(true)
    fetchMock.mockResolvedValueOnce(respond(404, {}))
    expect(await VERCEL_REGISTRAR.info('c.com')).toEqual({
      ok: 'yes',
      value: { owned: false, registeredAtMs: null, expiresAtMs: null, autoRenew: null },
    })
  })

  it('treats an empty contact schema as the standard contact', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, {}))
    expect(await VERCEL_REGISTRAR.standardContact('a.com')).toEqual({ ok: 'yes', value: true })
    fetchMock.mockResolvedValueOnce(respond(200, { app_purpose: { required: true } }))
    expect(await VERCEL_REGISTRAR.standardContact('a.us')).toEqual({ ok: 'yes', value: false })
  })
})
