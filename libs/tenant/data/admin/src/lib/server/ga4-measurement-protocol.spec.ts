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

/**
 * AGL-1589 — the server-side `site_published` sender.
 *
 * Two properties are worth pinning. The first is that ABSENT CONFIG IS NOT AN
 * ERROR: `GA4_MEASUREMENT_ID` / `GA4_API_SECRET` exist only in the console's
 * environment today, and this code runs in the tenant app — so the normal
 * state, right now and on every self-hosted deployment, is a clean no-op. The
 * second is that one host is one synthetic GA user, however many of its
 * screens go live on a timer; a random client id per publish would inflate
 * the activation metric, which is the exact failure the event is meant to
 * measure away from.
 */

import {
  sendGa4Purchase,
  sendGa4SitePublished,
  synthesizeClientId,
} from './ga4-measurement-protocol'

const originalEnv = { ...process.env }
const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }) as never)

beforeEach(() => {
  fetchMock.mockClear()
  global.fetch = fetchMock as never
  delete process.env.GA4_MEASUREMENT_ID
  delete process.env.GA4_API_SECRET
})

afterAll(() => {
  process.env = { ...originalEnv }
})

describe('sendGa4SitePublished with no Measurement Protocol config', () => {
  it('no-ops cleanly rather than throwing or logging', async () => {
    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result).toEqual({
      sent: false,
      synthesizedClientId: false,
      reason: 'not-configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sendGa4SitePublished when configured', () => {
  beforeEach(() => {
    process.env.GA4_MEASUREMENT_ID = 'G-TEST'
    process.env.GA4_API_SECRET = 'secret'
  })

  it('sends site_published with a client id derived from the host', async () => {
    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result.sent).toBe(true)
    expect(result.synthesizedClientId).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ]
    expect(url).toContain('measurement_id=G-TEST')
    const body = JSON.parse(init.body)
    expect(body.events).toEqual([{ name: 'site_published', params: {} }])
    expect(body.client_id).toBe(synthesizeClientId('host-1'))
    // AGL-1538 posture, asserted per hit rather than trusted to the property.
    expect(body.non_personalized_ads).toBe(true)
  })

  it('carries first_publish so the server hit fills the same dimension as the browser', async () => {
    // AGL-1588. Registered in GA and sent by nobody until now; a scheduled
    // first publish is one of the cases it exists to count, since no browser
    // is present at 3am to fire the client-side event.
    await sendGa4SitePublished({ hostId: 'host-1', firstPublish: true })
    await sendGa4SitePublished({ hostId: 'host-1', firstPublish: false })

    const params = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse((call as unknown as [string, { body: string }])[1].body)
          .events[0].params,
    )
    expect(params[0]).toEqual({ first_publish: true })
    // `false` is a VALUE, not an absence: it is what makes the dimension a
    // breakdown rather than a flag, and the sanitizer must not drop it the
    // way it drops undefined.
    expect(params[1]).toEqual({ first_publish: false })
  })

  it('omits first_publish rather than inventing one when the caller cannot say', async () => {
    await sendGa4SitePublished({ hostId: 'host-1' })

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    )
    expect(body.events[0].params).not.toHaveProperty('first_publish')
  })

  it('sends the host id ONLY as a hash — never as a param or a user id', async () => {
    await sendGa4SitePublished({ hostId: 'host-1' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ]
    expect(init.body).not.toContain('host-1')
    expect(JSON.parse(init.body).user_id).toBeUndefined()
  })

  it('maps one host to one GA user across repeated publishes', async () => {
    await sendGa4SitePublished({ hostId: 'host-1' })
    await sendGa4SitePublished({ hostId: 'host-1' })

    const clientIds = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, { body: string }])[1].body).client_id,
    )
    expect(clientIds[0]).toBe(clientIds[1])
    expect(clientIds[0]).not.toBe(synthesizeClientId('host-2'))
  })

  it('never throws when the network does', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline') as never)

    const result = await sendGa4SitePublished({ hostId: 'host-1' })

    expect(result).toEqual({
      sent: false,
      synthesizedClientId: true,
      reason: 'network',
    })
  })
})

/**
 * AGL-1640 closes at the wire, not at the caller: the guarantee the annual-mix
 * metric depends on is that an invoice whose cadence could not be read sends
 * NO `billing_interval` key — so the hit is excluded from the breakdown rather
 * than miscounted in it. A caller passing `undefined` must not become a
 * `'monthly'` here, and must not become a `billing_interval: undefined` that
 * JSON.stringify would drop by accident rather than by design.
 */
describe('purchase carries billing_interval only when it is known (AGL-1640)', () => {
  const purchase = {
    transactionId: 'in_test_1',
    value: 49,
    currency: 'usd',
    items: [
      {
        item_id: 'price_pro',
        item_name: 'Pro',
        item_category: 'subscription',
        price: 49,
        quantity: 1,
      },
    ],
    stripeCustomerId: 'cus_1',
  }

  const sentParams = () =>
    JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    ).events[0].params

  beforeEach(() => {
    process.env.GA4_MEASUREMENT_ID = 'G-TEST'
    process.env.GA4_API_SECRET = 'secret'
  })

  it('sends annual when the invoice said year', async () => {
    await sendGa4Purchase({ ...purchase, billingInterval: 'annual' })
    expect(sentParams().billing_interval).toBe('annual')
  })

  it('sends monthly when the invoice said month', async () => {
    await sendGa4Purchase({ ...purchase, billingInterval: 'monthly' })
    expect(sentParams().billing_interval).toBe('monthly')
  })

  it('omits the key entirely when the invoice did not say', async () => {
    await sendGa4Purchase({ ...purchase, billingInterval: undefined })
    const params = sentParams()
    expect(params.billing_interval).toBeUndefined()
    // Absent, not present-and-empty: GA counts a key it receives.
    expect(Object.hasOwn(params, 'billing_interval')).toBe(false)
    expect(params.value).toBe(49)
  })

  it('joins the browser session when a real client id was captured', async () => {
    // The AGL-1638 half, from the sender's side: a captured client id is used
    // verbatim and reported as NOT synthesized, which is what distinguishes an
    // attributable sale from one that merely has the money right.
    const result = await sendGa4Purchase({
      ...purchase,
      clientId: '555444333.1755100000',
    })
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    )
    expect(body.client_id).toBe('555444333.1755100000')
    expect(result.synthesizedClientId).toBe(false)
  })
})
