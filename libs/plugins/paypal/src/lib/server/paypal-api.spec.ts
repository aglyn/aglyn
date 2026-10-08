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

import { createFakePayPal, type FakePayPal } from '../testing/fake-paypal'
import { PAYPAL_TEST_ENV, clearPayPalTestEnv, setPayPalTestEnv } from '../testing/paypal-env'
import { readPayPalConfig, type PayPalConfig } from './config'
import { payPalAuthAssertion, payPalIssue, payPalRequest, setPayPalFetchForTests } from './paypal-api'

/**
 * The REST client (AGL-3630): the platform's token fetched once and reused,
 * fetched again once when PayPal says it is spent; the BN code on every
 * call; the idempotency key and the seller's assertion where asked.
 */

let paypal: FakePayPal
let config: PayPalConfig

beforeEach(() => {
  setPayPalTestEnv()
  paypal = createFakePayPal({ clientId: PAYPAL_TEST_ENV['PAYPAL_CLIENT_ID'], partnerMerchantId: PAYPAL_TEST_ENV['PAYPAL_PARTNER_MERCHANT_ID'] })
  setPayPalFetchForTests(paypal.fetch)
  const read = readPayPalConfig()
  if (!read.configured) throw new Error('test env incomplete')
  config = read.config
})

afterEach(() => {
  setPayPalFetchForTests(null)
  clearPayPalTestEnv()
})

describe('the PayPal REST client', () => {
  it('fetches the platform token once with the app credentials, then reuses it', async () => {
    await payPalRequest(config, { method: 'GET', path: '/v2/checkout/orders/NOPE' })
    await payPalRequest(config, { method: 'GET', path: '/v2/checkout/orders/NOPE' })
    expect(paypal.tokenCalls).toBe(1)
    const [token] = paypal.callsTo('POST', '/v1/oauth2/token')
    expect(token.headers['authorization']).toBe(
      `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    )
    expect(token.body).toBe('grant_type=client_credentials')
  })

  it('sends the BN code, the idempotency key and the bearer token', async () => {
    await payPalRequest(config, { method: 'POST', path: '/v2/checkout/orders', body: {}, requestId: 'req-1', representation: true })
    const [call] = paypal.callsTo('POST', '/v2/checkout/orders')
    expect(call.headers).toMatchObject({
      authorization: 'Bearer A21AA1',
      'paypal-partner-attribution-id': 'Aglyn_SP_PPCP',
      'paypal-request-id': 'req-1',
      prefer: 'return=representation',
    })
  })

  it('acts for a seller with an unsigned assertion naming the platform app and the seller', async () => {
    await payPalRequest(config, { method: 'GET', path: '/x', sellerMerchantId: 'SELLER1' })
    const [call] = paypal.callsTo('GET', '/x')
    const [header, payload, signature] = call.headers['paypal-auth-assertion'].split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'none' })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({ iss: config.clientId, payer_id: 'SELLER1' })
    expect(signature).toBe('')
    expect(payPalAuthAssertion('a', 'b')).toMatch(/\.$/)
  })

  it('fetches a fresh token once when PayPal answers 401', async () => {
    let first = true
    setPayPalFetchForTests(async (url, init) => {
      if (url.endsWith('/v2/checkout/orders/X') && first) {
        first = false
        return new Response('{}', { status: 401 })
      }
      return paypal.fetch(url, init)
    })
    const response = await payPalRequest(config, { method: 'GET', path: '/v2/checkout/orders/X' })
    expect(response.status).toBe(404)
    expect(paypal.tokenCalls).toBe(2)
  })

  it('names the issue PayPal refused with', () => {
    expect(payPalIssue({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] })).toBe('INSTRUMENT_DECLINED')
    expect(payPalIssue({ name: 'INTERNAL_SERVER_ERROR' })).toBe('INTERNAL_SERVER_ERROR')
  })
})
