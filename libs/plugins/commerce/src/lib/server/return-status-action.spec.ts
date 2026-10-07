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
 * The order-status page's "Request a return" button (AGL-3611) shows only on
 * an order a return can be opened against, in a store taking requests, while
 * the window is open and a unit can still come back, and carries the status
 * token so the return page can act for the buyer.
 */

let mockReturns: unknown = undefined
let mockExisting: unknown[] = []
let mockReadFails = false
const mockPaths: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (hosts: string) => ({
          doc: (hostId: string) => ({
            collection: (name: string) => ({
              doc: (store: string) => ({
                get: async () => {
                  mockPaths.push([hosts, hostId, name, store].join('/'))
                  if (mockReadFails) throw new Error('unavailable')
                  return { get: (field: string) => (field === 'returns' ? mockReturns : undefined) }
                },
              }),
              where: (field: string, op: string, value: string) => ({
                get: async () => {
                  mockPaths.push(`${[hosts, hostId, name].join('/')}?${field}${op}${value}`)
                  return { docs: mockExisting.map((entry) => ({ data: () => entry })) }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { returnRequestStatusAction } from './return-status-action'

const NOW = Date.now()

const order = (status: string, extra: Record<string, unknown> = {}) =>
  ({
    status,
    createdAtMs: NOW - 3 * 86_400_000,
    lineItems: [{ name: 'Mug', quantity: 2, unitAmountCents: 1200, productType: 'physical' }],
    fulfillments: [{ id: 'f1', lines: [{ lineItemId: 0, quantity: 2 }], atMs: NOW - 86_400_000 }],
    ...extra,
  }) as never

const input = (status: string, extra: Record<string, unknown> = {}) => ({
  hostId: 'host-1',
  orderId: 'order-9',
  order: order(status, extra),
  token: 'tok.en',
})

beforeEach(() => {
  mockReturns = undefined
  mockExisting = []
  mockReadFails = false
  mockPaths.length = 0
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('returnRequestStatusAction', () => {
  it.each(['paid', 'partially_fulfilled', 'fulfilled', 'delivered'])(
    'offers the return page on a %s order, with the status token',
    async (status) => {
      await expect(returnRequestStatusAction(input(status))).resolves.toEqual([
        { id: 'request-return', label: 'Request a return', url: '/order-return?o=order-9&t=tok.en' },
      ])
      expect(mockPaths.sort()).toEqual(['hosts/host-1/returns?orderId==order-9', 'hosts/host-1/settings/store'])
    },
  )

  it.each(['pending', 'cancelled', 'refunded', 'failed', ''])(
    'offers nothing on a %s order, without reading the store',
    async (status) => {
      await expect(returnRequestStatusAction(input(status))).resolves.toEqual([])
      expect(mockPaths).toEqual([])
    },
  )

  it('offers nothing when the store turned return requests off', async () => {
    mockReturns = { enabled: false, windowDays: 30 }
    await expect(returnRequestStatusAction(input('fulfilled'))).resolves.toEqual([])
  })

  it('reads an unset policy as the default, which takes requests', async () => {
    mockReturns = undefined
    await expect(returnRequestStatusAction(input('fulfilled'))).resolves.toHaveLength(1)
  })

  it('offers nothing once the window has closed', async () => {
    mockReturns = { enabled: true, windowDays: 30 }
    await expect(
      returnRequestStatusAction(input('fulfilled', { fulfillments: [{ id: 'f1', lines: [{ lineItemId: 0, quantity: 2 }], atMs: NOW - 31 * 86_400_000 }] })),
    ).resolves.toEqual([])
  })

  it('offers nothing when every unit is already in a return', async () => {
    mockExisting = [{ status: 'requested', lines: [{ lineItemId: 0, quantity: 2, reason: 'other' }] }]
    await expect(returnRequestStatusAction(input('fulfilled'))).resolves.toEqual([])
  })

  it('offers it again once the return holding the units was declined', async () => {
    mockExisting = [{ status: 'declined', lines: [{ lineItemId: 0, quantity: 2, reason: 'other' }] }]
    await expect(returnRequestStatusAction(input('fulfilled'))).resolves.toHaveLength(1)
  })

  it('offers nothing before anything shipped', async () => {
    await expect(returnRequestStatusAction(input('paid', { fulfillments: [] }))).resolves.toEqual([])
  })

  it('hides the button rather than failing the page when the read fails', async () => {
    mockReadFails = true
    await expect(returnRequestStatusAction(input('fulfilled'))).resolves.toEqual([])
  })
})
