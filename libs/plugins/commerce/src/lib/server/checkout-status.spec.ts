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
 * `commerce/checkout-status` (AGL-3606): what became of a session the shopper
 * was returned from. Stripe is mocked at `fetch` — no network, no keys.
 *
 * The properties pinned: it answers ONLY status and payment status, ONLY for a
 * session this host created, and refuses an id that is not a session id
 * before it is interpolated into a Stripe URL.
 */

import { checkoutStatusHandler } from './checkout-status'

const HOST_ID = 'host-1'
const SESSION_ID = 'cs_test_a1b2c3d4e5f6g7h8'

let stripeResponse: { ok: boolean; body: any }
const fetchMock = jest.fn(async (...args: unknown[]) => ({
  calledWith: args,
  ok: stripeResponse.ok,
  json: async () => stripeResponse.body,
}))

async function call(query: Record<string, string>, method = 'GET') {
  const captured: { status: number; body: any; headers: Record<string, string> } = {
    status: 0,
    body: undefined,
    headers: {},
  }
  const res: any = {
    status(code: number) {
      captured.status = code
      return res
    },
    json(body: any) {
      captured.body = body
      return res
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value
    },
  }
  await checkoutStatusHandler({ method, query } as any, res)
  return captured
}

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake'
  ;(global as any).fetch = fetchMock
  fetchMock.mockClear()
  stripeResponse = {
    ok: true,
    body: {
      id: SESSION_ID,
      status: 'open',
      payment_status: 'unpaid',
      metadata: { hostId: HOST_ID },
      customer_details: { email: 'secret@example.com' },
      client_secret: 'cs_test_secret',
      amount_total: 6212,
    },
  }
})

afterAll(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY
})

describe('checkout-status', () => {
  it('answers status and payment status, and nothing else', async () => {
    const result = await call({ hostId: HOST_ID, sessionId: SESSION_ID })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'open', paymentStatus: 'unpaid' })
    expect(result.headers['Cache-Control']).toBe('no-store')
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.stripe.com/v1/checkout/sessions/${SESSION_ID}`,
    )
  })

  it('reports a completed, still-processing payment', async () => {
    stripeResponse.body.status = 'complete'
    const result = await call({ hostId: HOST_ID, sessionId: SESSION_ID })
    expect(result.body).toEqual({ status: 'complete', paymentStatus: 'unpaid' })
  })

  it('404s a session another host created — the same answer as a missing one', async () => {
    stripeResponse.body.metadata = { hostId: 'someone-else' }
    const result = await call({ hostId: HOST_ID, sessionId: SESSION_ID })
    expect(result.status).toBe(404)
    expect(JSON.stringify(result.body)).not.toContain('open')
  })

  it('404s what Stripe does not have', async () => {
    stripeResponse = { ok: false, body: { error: { message: 'No such' } } }
    expect((await call({ hostId: HOST_ID, sessionId: SESSION_ID })).status).toBe(404)
  })

  it('refuses an id that is not a Checkout Session id before calling Stripe', async () => {
    for (const sessionId of ['../accounts', 'pi_123456789', 'cs_test_abc/../x', '']) {
      const result = await call({ hostId: HOST_ID, sessionId })
      expect(result.status).toBe(400)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 501 when payments are not configured', async () => {
    delete process.env.STRIPE_SECRET_KEY
    expect((await call({ hostId: HOST_ID, sessionId: SESSION_ID })).status).toBe(501)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is read-only: anything but GET is refused', async () => {
    const result = await call({ hostId: HOST_ID, sessionId: SESSION_ID }, 'POST')
    expect(result.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('502s a network failure rather than throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await call({ hostId: HOST_ID, sessionId: SESSION_ID })).status).toBe(502)
    spy.mockRestore()
  })
})
