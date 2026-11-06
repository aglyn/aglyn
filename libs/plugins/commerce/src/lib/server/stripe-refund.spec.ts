/**
 * @jest-environment node
 *
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
 * One Stripe refund for a destination sale and for a direct one: where it is
 * sent, and what it reverses.
 */

import { createStripeRefund } from './stripe-refund'

type Sent = { headers: Record<string, string>; params: URLSearchParams }

function stripe(answers: Array<{ status: number; body: unknown }>) {
  const sent: Sent[] = []
  const fetch = jest.fn(async (_url: unknown, init: any) => {
    sent.push({
      headers: init?.headers ?? {},
      params: new URLSearchParams(String(init?.body ?? '')),
    })
    const answer = answers.shift() ?? { status: 200, body: { id: 're_1' } }
    return {
      ok: answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    } as unknown as Response
  })
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch }
}

const base = {
  paymentIntentId: 'pi_1',
  amountCents: 1250,
  idempotencyKey: 'refund-key',
  secretKey: 'sk_test_x',
}

describe('createStripeRefund', () => {
  it('a destination sale reverses the transfer and the fee, on the platform', async () => {
    const { sent, fetch } = stripe([{ status: 200, body: { id: 're_1' } }])
    expect(await createStripeRefund({ ...base, fetch })).toEqual({ ok: true, refundId: 're_1' })
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Stripe-Account']).toBeUndefined()
    expect(sent[0].params.get('reverse_transfer')).toBe('true')
    expect(sent[0].params.get('refund_application_fee')).toBe('true')
    expect(sent[0].params.get('amount')).toBe('1250')
  })

  it('a direct sale is refunded on the seller’s account, fee back and no transfer reversal', async () => {
    const { sent, fetch } = stripe([{ status: 200, body: { id: 're_2' } }])
    const result = await createStripeRefund({ ...base, fetch, stripeAccount: 'acct_1Seller' })
    expect(result).toEqual({ ok: true, refundId: 're_2' })
    expect(sent).toHaveLength(1)
    expect(sent[0].headers['Stripe-Account']).toBe('acct_1Seller')
    expect(sent[0].headers['Idempotency-Key']).toBe('refund-key')
    expect(sent[0].params.has('reverse_transfer')).toBe(false)
    expect(sent[0].params.get('refund_application_fee')).toBe('true')
  })

  it('a payment the seller’s account does not know is refunded on the platform as a destination sale', async () => {
    const { sent, fetch } = stripe([
      {
        status: 400,
        body: { error: { code: 'resource_missing', param: 'payment_intent', message: 'No such payment_intent' } },
      },
      { status: 200, body: { id: 're_3' } },
    ])
    const result = await createStripeRefund({ ...base, fetch, stripeAccount: 'acct_1Seller' })
    expect(result).toEqual({ ok: true, refundId: 're_3' })
    expect(sent).toHaveLength(2)
    expect(sent[1].headers['Stripe-Account']).toBeUndefined()
    expect(sent[1].params.get('reverse_transfer')).toBe('true')
  })

  it('a disputed direct charge answers the dispute message, without a second try', async () => {
    const { sent, fetch } = stripe([
      { status: 400, body: { error: { code: 'charge_disputed', message: 'disputed' } } },
    ])
    const result = await createStripeRefund({ ...base, fetch, stripeAccount: 'acct_1Seller' })
    expect(result).toMatchObject({ ok: false, status: 409, code: 'charge_disputed' })
    expect(sent).toHaveLength(1)
  })
})
