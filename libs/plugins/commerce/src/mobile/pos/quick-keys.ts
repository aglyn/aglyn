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

import { doc, type Firestore, getDoc } from 'firebase/firestore'
import { type PosItem, posItemFrom, posKeys, type PosVariant } from './catalog'

/*==========================================
 * QUICK KEYS (AGL-3618).
 *
 * The items a register sells all day, one tap each, above the grid: the
 * coffee, the bag, the gift wrap. Kept per device, per store and register,
 * the way Square's item grid is a device's own layout: the cashier pins and
 * unpins from the till without a trip to the console, and one register's
 * keys never rearrange another's.
 *
 * Each key names a product and variant. Its price and name are read fresh
 * from the catalog, so a price change reaches the key at once, and a product
 * that was archived or deleted drops off rather than ringing up.
 *=========================================*/

export const POS_QUICK_KEYS_MAX = 12

export interface PosQuickKey {
  productId: string
  variantId: string | null
}

export function quickKeysStorageKey(hostId: string, registerId: string | null): string {
  return `aglyn.pos.quick-keys.${hostId}.${registerId ?? 'none'}`
}

const same = (a: PosQuickKey, b: PosQuickKey) => a.productId === b.productId && a.variantId === b.variantId

export function hasQuickKey(keys: readonly PosQuickKey[], key: PosQuickKey): boolean {
  return keys.some((entry) => same(entry, key))
}

/** Pins a key at the end, or unpins it; a full set refuses another. */
export function toggleQuickKey(
  keys: readonly PosQuickKey[],
  key: PosQuickKey,
): { keys: PosQuickKey[]; problem: string | null } {
  if (hasQuickKey(keys, key)) return { keys: keys.filter((entry) => !same(entry, key)), problem: null }
  if (keys.length >= POS_QUICK_KEYS_MAX) {
    return { keys: [...keys], problem: `A register holds ${POS_QUICK_KEYS_MAX} quick keys. Unpin one first.` }
  }
  return { keys: [...keys, { productId: key.productId, variantId: key.variantId }], problem: null }
}

/** A stored set read back defensively. */
export function readStoredQuickKeys(raw: unknown): PosQuickKey[] {
  const keys: PosQuickKey[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    const record = (entry ?? {}) as Record<string, unknown>
    if (typeof record['productId'] !== 'string' || !record['productId']) continue
    const key = {
      productId: record['productId'],
      variantId: typeof record['variantId'] === 'string' && record['variantId'] ? record['variantId'] : null,
    }
    if (!hasQuickKey(keys, key)) keys.push(key)
    if (keys.length >= POS_QUICK_KEYS_MAX) break
  }
  return keys
}

/** One pinned product as read: a plain record, so the persisted query cache keeps it. */
export interface PosQuickKeyRead {
  item: PosItem
  active: boolean
}

export interface PosQuickKeyTile {
  key: PosQuickKey
  item: PosItem
  variant: PosVariant
}

/** The live tile for each key, in the cashier's order; gone or unsellable products drop off. */
export function quickKeyTiles(
  keys: readonly PosQuickKey[],
  items: Readonly<Record<string, PosQuickKeyRead | null>>,
): PosQuickKeyTile[] {
  const tiles: PosQuickKeyTile[] = []
  for (const key of keys) {
    const found = items[key.productId]
    if (!found || !found.active) continue
    const variant =
      found.item.variants.find((entry) => entry.id === (key.variantId ?? 'default')) ??
      (key.variantId ? null : found.item.variants[0])
    if (variant) tiles.push({ key, item: found.item, variant })
  }
  return tiles
}

/** Reads each pinned product (at most twelve documents) under the console's rules. */
export function quickKeyItemsQuery(firestore: Firestore, hostId: string, keys: readonly PosQuickKey[]) {
  const ids = [...new Set(keys.map((key) => key.productId))].sort()
  return {
    queryKey: posKeys.items(hostId, ids),
    queryFn: async (): Promise<Record<string, PosQuickKeyRead | null>> => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          const snapshot = await getDoc(doc(firestore, 'hosts', hostId, 'products', id))
          if (!snapshot.exists()) return [id, null] as const
          const data = snapshot.data()
          const active = data['status'] === 'active' && (data['deletedAt'] ?? null) === null
          return [id, { item: posItemFrom(id, data), active }] as const
        }),
      )
      return Object.fromEntries(entries)
    },
    enabled: ids.length > 0,
  }
}
