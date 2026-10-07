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

import { allocateParcel, keptReasonLabel, planLines, retryDelayMs, routingHolds } from './routing'

describe('which lines go to a network (AGL-3634)', () => {
  const line = (lineIndex: number, sku: string | undefined, quantityUnshipped: number) => ({
    lineIndex,
    name: `Line ${lineIndex}`,
    ...(sku ? { sku } : {}),
    quantityUnshipped,
    unitValueCents: 100,
  })

  it('sends a whole line the network can fill, and keeps the rest with a reason', () => {
    const plan = planLines({
      lines: [line(0, 'A', 2), line(1, undefined, 1), line(2, 'B', 1), line(3, 'C', 5), line(4, 'D', 0)],
      held: new Map(),
      stock: new Map([
        ['A', 10],
        ['C', 4],
      ]),
    })
    expect(plan.send.map((entry) => [entry.lineIndex, entry.quantity])).toEqual([[0, 2]])
    expect(plan.keep.map((entry) => [entry.lineIndex, entry.reason])).toEqual([
      [1, 'no_sku'],
      [2, 'not_stocked'],
      [3, 'short'],
    ])
  })

  it('counts the units it already sends of a SKU against the stock', () => {
    const plan = planLines({ lines: [line(0, 'A', 3), line(1, 'A', 2)], held: new Map(), stock: new Map([['A', 4]]) })
    expect(plan.send.map((entry) => entry.lineIndex)).toEqual([0])
    expect(plan.keep).toEqual([expect.objectContaining({ lineIndex: 1, reason: 'short' })])
  })

  it('leaves units someone else holds, and a line wholly held is kept as held', () => {
    const plan = planLines({
      lines: [line(0, 'A', 3), line(1, 'B', 1)],
      held: new Map([
        [0, 1],
        [1, 1],
      ]),
      stock: new Map([
        ['A', 9],
        ['B', 9],
      ]),
    })
    expect(plan.send).toEqual([expect.objectContaining({ lineIndex: 0, quantity: 2 })])
    expect(plan.keep).toEqual([expect.objectContaining({ lineIndex: 1, reason: 'held' })])
    expect(keptReasonLabel('held', 'ShipBob')).toMatch(/elsewhere/)
  })
})

describe('which lines a parcel holds (AGL-3634)', () => {
  const lines = [
    { lineIndex: 0, sku: 'A', name: 'A', quantity: 2, shippedQuantity: 0 },
    { lineIndex: 3, sku: 'A', name: 'A again', quantity: 1, shippedQuantity: 0 },
    { lineIndex: 4, sku: 'B', name: 'B', quantity: 1, shippedQuantity: 1 },
  ]

  it('fills a SKU’s lines in order, never past what each has left', () => {
    expect(allocateParcel(lines, [{ sku: 'A', quantity: 3 }])).toEqual([
      { lineIndex: 0, quantity: 2 },
      { lineIndex: 3, quantity: 1 },
    ])
    expect(allocateParcel(lines, [{ sku: 'A', quantity: 9 }, { sku: 'B', quantity: 1 }])).toEqual([
      { lineIndex: 0, quantity: 2 },
      { lineIndex: 3, quantity: 1 },
    ])
  })

  it('puts an item that names its line on that line first', () => {
    expect(allocateParcel(lines, [{ sku: 'A', quantity: 1, lineIndex: 3 }])).toEqual([{ lineIndex: 3, quantity: 1 }])
  })
})

describe('what a hand-off holds (AGL-3634)', () => {
  const lines = [
    { lineIndex: 0, sku: 'A', name: 'A', quantity: 2, shippedQuantity: 1 },
    { lineIndex: 1, sku: 'B', name: 'B', quantity: 1, shippedQuantity: 1 },
  ]

  it('holds the unshipped units while queued or with the network', () => {
    expect(routingHolds({ status: 'queued', lines })).toEqual([{ lineIndex: 0, quantity: 1, state: 'pending' }])
    expect(routingHolds({ status: 'partially_shipped', lines })).toEqual([{ lineIndex: 0, quantity: 1, state: 'accepted' }])
  })

  it('holds nothing once it ended', () => {
    for (const status of ['shipped', 'canceled', 'failed', 'skipped'] as const) {
      expect(routingHolds({ status, lines })).toEqual([])
    }
  })

  it('backs off from five minutes to six hours', () => {
    expect(retryDelayMs(1, 300_000, 21_600_000)).toBe(300_000)
    expect(retryDelayMs(3, 300_000, 21_600_000)).toBe(1_200_000)
    expect(retryDelayMs(20, 300_000, 21_600_000)).toBe(21_600_000)
  })
})
