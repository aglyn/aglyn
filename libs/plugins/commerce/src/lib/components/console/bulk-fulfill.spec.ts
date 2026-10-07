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

import { bulkFulfillOrders, describeBulkFulfill } from './bulk-fulfill'

/** Bulk "Mark as fulfilled" from the orders list (AGL-3611). */

const fetchMock = jest.fn()
const user = { getIdToken: async () => 'tok' }
const answer = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never

beforeEach(() => {
  fetchMock.mockReset()
  ;(global as { fetch: unknown }).fetch = fetchMock
})

it('asks the route once per fulfillable order, keyed by batch and order', async () => {
  fetchMock.mockResolvedValue(answer(200, { ok: true }))
  const result = await bulkFulfillOrders(
    user,
    'host-1',
    [
      { $id: 'a', status: 'paid' },
      { $id: 'b', status: 'partially_fulfilled' },
      { $id: 'c', status: 'refunded' },
    ],
    'batch-1',
  )
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.map(([, init]) => init.headers['Idempotency-Key'])).toEqual([
    'batch-1:a',
    'batch-1:b',
  ])
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ hostId: 'host-1', orderId: 'a', to: 'fulfilled' })
  expect(result).toEqual({
    fulfilled: 2,
    already: 0,
    refused: [{ orderId: 'c', error: 'Orders in "refunded" cannot be fulfilled' }],
    unknown: [],
  })
})

it('keeps going past a refusal and a lost answer, and says which is which', async () => {
  fetchMock
    .mockResolvedValueOnce(answer(409, { error: 'Orders in "cancelled" cannot be fulfilled' }))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(answer(200, { ok: true, already: true }))
  const result = await bulkFulfillOrders(
    user,
    'host-1',
    [
      { $id: 'a', status: 'paid' },
      { $id: 'b', status: 'paid' },
      { $id: 'c', status: 'paid' },
    ],
    'k',
  )
  expect(result.refused).toHaveLength(1)
  expect(result.unknown).toEqual(['b'])
  expect(result.already).toBe(1)
  expect(describeBulkFulfill(result)).toBe(
    '1 order fulfilled; 1 skipped (orders in "cancelled" cannot be fulfilled); 1 not confirmed — reopen it to check; running it again is safe',
  )
})
