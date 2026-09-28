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
 * The one transfer-reversal seam a store order's and a booking's lost dispute
 * share (AGL-3363). A Stripe double answers; the key is a throwaway
 * test-mode string, and every URL is asserted to be Stripe's own API.
 */

import { reverseDestinationTransfer } from './stripe-transfer-reversal'

const KEY = 'sk_test_transfer_reversal_double'

function double(options: {
  charge?: Record<string, unknown>
  transfer?: Record<string, unknown>
  status?: number
}) {
  const posts: URLSearchParams[] = []
  const headers: Record<string, string>[] = []
  const fetchImpl = jest.fn(async (url: string, init?: any) => {
    expect(url.startsWith('https://api.stripe.com/v1/')).toBe(true)
    const reply = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response
    if (options.status) return reply({}, options.status)
    if (url.includes('/charges/')) {
      return reply({ amount: 10000, transfer: 'tr_1', ...options.charge })
    }
    if (url.endsWith('/reversals')) {
      posts.push(new URLSearchParams(String(init?.body)))
      headers.push(init?.headers ?? {})
      return reply({ id: 'trr_new', amount: Number(posts.at(-1)?.get('amount')) })
    }
    return reply({ amount: 9000, amount_reversed: 0, reversals: { data: [] }, ...options.transfer })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, posts, headers }
}

const cause = {
  kind: 'dispute' as const,
  id: 'dp_1',
  amountCents: 10000,
  chargeId: 'ch_1',
  metadata: { bookingId: 'b1' },
}

describe('reverseDestinationTransfer (AGL-3363)', () => {
  it('pulls back the proportional share, keyed and stamped by the cause', async () => {
    const { fetchImpl, posts, headers } = double({})
    await expect(reverseDestinationTransfer(cause, { stripeKey: KEY, fetchImpl })).resolves.toEqual({
      kind: 'reversed',
      cents: 9000,
      reversalId: 'trr_new',
      adopted: false,
    })
    expect(posts[0].get('metadata[disputeId]')).toBe('dp_1')
    expect(posts[0].get('metadata[bookingId]')).toBe('b1')
    expect(posts[0].has('refund_application_fee')).toBe(false)
    expect(headers[0]['Idempotency-Key']).toBe('dispute-reversal-dp_1')
  })

  it('never pulls back more than the transfer has left', async () => {
    const { fetchImpl, posts } = double({ transfer: { amount_reversed: 8000 } })
    await reverseDestinationTransfer(cause, { stripeKey: KEY, fetchImpl })
    expect(posts[0].get('amount')).toBe('1000')
  })

  it('adopts a reversal already on the transfer instead of making a second', async () => {
    const { fetchImpl, posts } = double({
      transfer: { reversals: { data: [{ id: 'trr_old', amount: 9000, metadata: { disputeId: 'dp_1' } }] } },
    })
    await expect(reverseDestinationTransfer(cause, { stripeKey: KEY, fetchImpl })).resolves.toEqual({
      kind: 'reversed',
      cents: 9000,
      reversalId: 'trr_old',
      adopted: true,
    })
    expect(posts).toHaveLength(0)
  })

  it('answers a final reason for a charge with no transfer', async () => {
    const { fetchImpl } = double({ charge: { transfer: null } })
    await expect(reverseDestinationTransfer(cause, { stripeKey: KEY, fetchImpl })).resolves.toEqual({
      kind: 'not-reversed',
      reason: 'no-transfer-on-charge',
    })
  })

  it('throws on a transient Stripe failure, so the webhook redelivery retries', async () => {
    const { fetchImpl } = double({ status: 503 })
    await expect(reverseDestinationTransfer(cause, { stripeKey: KEY, fetchImpl })).rejects.toThrow(/503/)
  })

  it('attempts nothing without a key', async () => {
    const { fetchImpl } = double({})
    await expect(
      reverseDestinationTransfer(cause, { stripeKey: '', fetchImpl }),
    ).resolves.toEqual({ kind: 'skipped', reason: 'no-stripe-key' })
  })
})
