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
 * The account page's subscriptions (AGL-4191): what a subscriber needs to plan
 * around — the price, whether it renews or ends, and their paid invoices with
 * Stripe's receipt link — read from the records the billing webhook keeps.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'

type Fields = Record<string, unknown>
const mockSubscriptions: Array<{ id: string; fields: Fields }> = []
const mockInvoices: Record<string, Array<{ id: string; fields: Fields }>> = {}
const mockProducts: Record<string, Fields> = {}
let mockInvoicesThrow = false

jest.mock('./membership', () => ({
  requireActiveMember: async () => ({
    memberId: 'member-1',
    member: { get: (field: string) => (field === 'email' ? 'sam@example.com' : undefined) },
  }),
}))
jest.mock('./download', () => ({ mintDownloadToken: () => 'token' }))

jest.mock('@aglyn/tenant-data-admin', () => {
  const snapshot = (doc: { id: string; fields: Fields } | null, id = doc?.id ?? 'x') => ({
    id,
    exists: Boolean(doc),
    get: (field: string) =>
      field.split('.').reduce<any>((value, key) => value?.[key], doc?.fields ?? {}),
    data: () => doc?.fields,
  })
  const listOf = (docs: Array<{ id: string; fields: Fields }>) => {
    const chain: any = {
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      get: async () => ({ docs: docs.map((doc) => snapshot(doc)) }),
    }
    return chain
  }
  const host = {
    collection: (name: string) => {
      if (name === 'subscriptions') {
        return {
          ...listOf(mockSubscriptions),
          doc: (id: string) => ({
            collection: () => {
              if (mockInvoicesThrow) throw new Error('unavailable')
              return listOf(mockInvoices[id] ?? [])
            },
          }),
        }
      }
      if (name === 'products') {
        return {
          ...listOf([]),
          doc: (id: string) => ({
            get: async () => snapshot(mockProducts[id] ? { id, fields: mockProducts[id] } : null, id),
          }),
        }
      }
      return { ...listOf([]), doc: () => ({ set: async () => undefined }) }
    },
  }
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection: () => ({ doc: () => host }) }) }),
    },
  }
})

import { membershipAccountHandler } from './membership-account'

async function account(): Promise<any> {
  let body: any = null
  let status = 0
  const res = {
    status: (code: number) => {
      status = code
      return res
    },
    json: (payload: unknown) => {
      body = payload
      return res
    },
  } as unknown as PluginApiResponse
  await membershipAccountHandler(
    { method: 'GET', query: { hostId: 'host-1' }, body: {} } as unknown as PluginApiRequest,
    res,
  )
  expect(status).toBe(200)
  return body
}

const DEC_4 = Date.UTC(2026, 11, 4)

beforeEach(() => {
  mockSubscriptions.length = 0
  for (const key of Object.keys(mockInvoices)) delete mockInvoices[key]
  for (const key of Object.keys(mockProducts)) delete mockProducts[key]
  mockInvoicesThrow = false
})

describe('membership account subscriptions (AGL-4191)', () => {
  it('returns the price, the period end and the cancellation flag', async () => {
    mockSubscriptions.push({
      id: 'sub_1',
      fields: {
        status: 'active',
        productId: 'p1',
        lineItems: [{ name: 'Pro — monthly' }],
        totals: { totalCents: 9900 },
        interval: 'month',
        currentPeriodEndMs: DEC_4,
        cancelAtPeriodEnd: true,
      },
    })
    const { subscriptions } = await account()
    expect(subscriptions).toEqual([
      expect.objectContaining({
        id: 'sub_1',
        productName: 'Pro — monthly',
        status: 'active',
        currentPeriodEndMs: DEC_4,
        cancelAtPeriodEnd: true,
        priceCents: 9900,
        interval: 'month',
      }),
    ])
  })

  it('lists paid invoices with Stripe’s link, and leaves out a trial’s $0 opening one', async () => {
    mockSubscriptions.push({
      id: 'sub_1',
      fields: { status: 'active', lineItems: [{ name: 'Starter' }], totals: { totalCents: 2900 } },
    })
    mockInvoices['sub_1'] = [
      {
        id: 'in_2',
        fields: {
          paidAtMs: 2000,
          paidCents: 2900,
          currency: 'usd',
          number: 'A-0002',
          hostedInvoiceUrl: 'https://invoice.stripe.com/i/2',
        },
      },
      { id: 'in_1', fields: { paidAtMs: 1000, paidCents: 0, currency: 'usd' } },
    ]
    const { subscriptions } = await account()
    expect(subscriptions[0].invoices).toEqual([
      {
        id: 'in_2',
        paidAtMs: 2000,
        paidCents: 2900,
        currency: 'usd',
        number: 'A-0002',
        url: 'https://invoice.stripe.com/i/2',
      },
    ])
  })

  it('names a subscription sold before lines were stored from its product', async () => {
    mockProducts['p9'] = { name: 'Legacy plan' }
    mockSubscriptions.push({ id: 'sub_9', fields: { status: 'active', productId: 'p9' } })
    const { subscriptions } = await account()
    expect(subscriptions[0].productName).toBe('Legacy plan')
    expect(subscriptions[0].priceCents).toBeUndefined()
  })

  it('a failed invoice read leaves the history empty and the page up', async () => {
    mockInvoicesThrow = true
    mockSubscriptions.push({
      id: 'sub_1',
      fields: { status: 'active', lineItems: [{ name: 'Starter' }] },
    })
    const { subscriptions } = await account()
    expect(subscriptions[0].invoices).toEqual([])
  })
})
