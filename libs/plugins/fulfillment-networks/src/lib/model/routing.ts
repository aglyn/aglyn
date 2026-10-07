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

import type { NetworkOrderLine, NetworkOrderStatus } from './networks'

/**
 * The decisions a hand-off makes, as pure functions (AGL-3634): which lines
 * go to a network, which units of a parcel the network shipped belong to
 * which line, and what a hand-off holds that has not shipped.
 */

/** A line of the order, as the seller describes it to a shipper. */
export interface PlannableLine {
  lineIndex: number
  name: string
  sku?: string
  /** Units not yet on any shipment. */
  quantityUnshipped: number
  unitValueCents: number
}

export type KeptReason = 'no_sku' | 'not_stocked' | 'short' | 'held'

export interface LinePlan {
  /** What goes to the network. */
  send: Array<NetworkOrderLine & { unitValueCents: number }>
  /** What stays with the merchant, and why. */
  keep: Array<{ lineIndex: number; name: string; quantity: number; reason: KeptReason }>
}

/**
 * Which lines go to the network: a line goes WHOLE — every unit not yet
 * shipped and not held by anyone else — when the network stocks its SKU and
 * can ship that many now, counting the units of the same SKU it is already
 * sending on earlier lines. Anything else stays with the merchant, so a
 * network never takes an order it would hold back.
 */
export function planLines(input: {
  lines: readonly PlannableLine[]
  /** Units of each line someone else already holds. */
  held: ReadonlyMap<number, number>
  /** What the network can ship now, by SKU; a SKU it does not stock is absent. */
  stock: ReadonlyMap<string, number>
}): LinePlan {
  const plan: LinePlan = { send: [], keep: [] }
  const committed = new Map<string, number>()
  for (const line of input.lines) {
    const free = Math.max(0, line.quantityUnshipped - (input.held.get(line.lineIndex) ?? 0))
    if (line.quantityUnshipped > 0 && free === 0) {
      plan.keep.push({ lineIndex: line.lineIndex, name: line.name, quantity: line.quantityUnshipped, reason: 'held' })
      continue
    }
    if (free === 0) continue
    const sku = String(line.sku ?? '').trim()
    if (!sku) {
      plan.keep.push({ lineIndex: line.lineIndex, name: line.name, quantity: free, reason: 'no_sku' })
      continue
    }
    if (!input.stock.has(sku)) {
      plan.keep.push({ lineIndex: line.lineIndex, name: line.name, quantity: free, reason: 'not_stocked' })
      continue
    }
    const left = (input.stock.get(sku) ?? 0) - (committed.get(sku) ?? 0)
    if (left < free) {
      plan.keep.push({ lineIndex: line.lineIndex, name: line.name, quantity: free, reason: 'short' })
      continue
    }
    committed.set(sku, (committed.get(sku) ?? 0) + free)
    plan.send.push({
      lineIndex: line.lineIndex,
      sku,
      name: line.name,
      quantity: free,
      shippedQuantity: 0,
      unitValueCents: line.unitValueCents,
    })
  }
  return plan
}

/** What a merchant reads about a line that stayed with them. */
export function keptReasonLabel(reason: KeptReason, network: string): string {
  switch (reason) {
    case 'no_sku':
      return `it has no SKU for ${network} to match`
    case 'not_stocked':
      return `${network} does not stock its SKU`
    case 'short':
      return `${network} does not have enough of it in stock`
    case 'held':
      return 'it is already being fulfilled elsewhere'
  }
}

/**
 * Which order lines a parcel's units belong to. An item that names its line
 * goes to that line; one that names only a SKU fills the hand-off's lines of
 * that SKU in order. Never more than a line has left to ship.
 */
export function allocateParcel(
  lines: readonly NetworkOrderLine[],
  items: ReadonlyArray<{ sku: string; quantity: number; lineIndex?: number }>,
): Array<{ lineIndex: number; quantity: number }> {
  const left = new Map(lines.map((line) => [line.lineIndex, Math.max(0, line.quantity - line.shippedQuantity)]))
  const out = new Map<number, number>()
  const take = (lineIndex: number, wanted: number): number => {
    const room = left.get(lineIndex) ?? 0
    const taken = Math.min(room, wanted)
    if (taken <= 0) return 0
    left.set(lineIndex, room - taken)
    out.set(lineIndex, (out.get(lineIndex) ?? 0) + taken)
    return taken
  }
  for (const item of items) {
    let wanted = Math.max(0, Math.floor(item.quantity))
    if (item.lineIndex !== undefined && left.has(item.lineIndex)) wanted -= take(item.lineIndex, wanted)
    for (const line of lines) {
      if (wanted <= 0) break
      if (line.sku === item.sku) wanted -= take(line.lineIndex, wanted)
    }
  }
  return [...out].map(([lineIndex, quantity]) => ({ lineIndex, quantity }))
}

/** The statuses in which a hand-off still holds units that have not shipped. */
const HOLDING: ReadonlySet<NetworkOrderStatus> = new Set(['queued', 'accepted', 'partially_shipped'])

/** The units a hand-off holds, per line, and whether the network has accepted them yet. */
export function routingHolds(routing: {
  status: NetworkOrderStatus
  lines: readonly NetworkOrderLine[]
}): Array<{ lineIndex: number; quantity: number; state: 'pending' | 'accepted' }> {
  if (!HOLDING.has(routing.status)) return []
  return (routing.lines ?? [])
    .map((line) => ({
      lineIndex: line.lineIndex,
      quantity: Math.max(0, line.quantity - line.shippedQuantity),
      state: routing.status === 'queued' ? ('pending' as const) : ('accepted' as const),
    }))
    .filter((hold) => hold.quantity > 0)
}

/** The wait after the `failures`th consecutive failure: five minutes, doubling, at most six hours. */
export function retryDelayMs(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, failures - 1))
}
