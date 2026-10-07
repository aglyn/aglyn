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

import type {
  PluginStockLevelOutcome,
  PluginStockLevelResult,
  PluginStockLevels,
} from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import * as CommerceModel from '../model'
import { alertLowStockCrossing } from './low-stock'

/**
 * COUNTS FROM SOMEWHERE ELSE, APPLIED AS THIS PLUGIN APPLIES ANY COUNT
 * (AGL-3634): commerce's implementation of core's `core.stock-levels`.
 *
 * A fulfillment network's warehouse holds the goods, so its count is the
 * true one. Each count is applied the way a merchant's own stock-take is:
 *
 *  - inside a transaction on the product, so a sale landing at the same
 *    moment is decremented from the count this write set, never lost under
 *    it (the AGL-2320 reasoning);
 *  - with an `inventoryAdjustments` row in the same transaction, reason
 *    `sync` and the counter named as `source`, so the stock history says who
 *    moved the number and by how much;
 *  - with the product's roll-up and sold-out flag rewritten, its
 *    `updatedAtMs` moved so shopping-channel feeds pick the change up, and
 *    the low-stock alert raised on a crossing. Back-in-stock email needs
 *    nothing here: its cron reads the count.
 *
 * Matched by SKU across the store's products that are not deleted. A
 * variant that does not track stock is left alone (`untracked`), and so is
 * one that counts stock per location (`per_location`): one number written
 * over its buckets would erase the counts the merchant keeps by hand.
 */

const PRODUCTS_PER_PAGE = 300
/** The most products one call walks to find its SKUs. */
const MAX_PRODUCTS_SCANNED = 20_000
const SKU_MAX = 120

type Firestore = FirebaseFirestore.Firestore

interface Located {
  productId: string
  variantId: string
}

const normalizeSku = (value: unknown): string => String(value ?? '').trim().slice(0, SKU_MAX)

/** Every live variant of the store whose SKU is one of `wanted`, by SKU. */
async function locateSkus(firestore: Firestore, hostId: string, wanted: ReadonlySet<string>) {
  const found = new Map<string, Located[]>()
  const products = firestore.collection('hosts').doc(hostId).collection('products')
  let cursor: string | null = null
  let scanned = 0
  while (scanned < MAX_PRODUCTS_SCANNED) {
    let query = products.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(PRODUCTS_PER_PAGE)
    if (cursor) query = query.startAfter(cursor)
    const page = await query.get()
    for (const doc of page.docs) {
      const data = doc.data() ?? {}
      if (data['deletedAt']) continue
      const variants = Array.isArray(data['variants']) ? (data['variants'] as Array<Record<string, unknown>>) : []
      for (const variant of variants) {
        const sku = normalizeSku(variant['sku'])
        if (!sku || !wanted.has(sku) || !variant['id']) continue
        const list = found.get(sku) ?? []
        list.push({ productId: doc.id, variantId: String(variant['id']) })
        found.set(sku, list)
      }
    }
    scanned += page.size
    if (page.size < PRODUCTS_PER_PAGE) break
    cursor = page.docs[page.docs.length - 1]?.id ?? null
  }
  return found
}

/** Applies one product's counts in one transaction; answers each variant's outcome. */
async function applyToProduct(input: {
  firestore: Firestore
  hostId: string
  productId: string
  counts: ReadonlyMap<string, { sku: string; quantity: number }>
  source: string
  nowMs: number
}): Promise<Map<string, PluginStockLevelResult>> {
  const { firestore, hostId, productId, counts, source, nowMs } = input
  const productRef = firestore.collection('hosts').doc(hostId).collection('products').doc(productId)
  const host = firestore.collection('hosts').doc(hostId)
  const outcome = await firestore.runTransaction(async (transaction) => {
    const results = new Map<string, PluginStockLevelResult>()
    const snapshot = await transaction.get(productRef)
    if (!snapshot.exists || snapshot.get('deletedAt')) {
      for (const [variantId, count] of counts) results.set(variantId, { sku: count.sku, outcome: 'unknown_sku' })
      return { results, before: null, after: null }
    }
    const before = CommerceModel.liftLegacyProduct(snapshot.data() as never)
    const rows: CommerceModel.InventoryAdjustment[] = []
    const variants = before.variants.map((variant) => {
      const count = counts.get(variant.id)
      if (!count) return variant
      if (variant.inventory == null) {
        results.set(variant.id, { sku: count.sku, outcome: 'untracked' })
        return variant
      }
      const current = Number(variant.inventory)
      if (variant.inventoryByLocation && Object.keys(variant.inventoryByLocation).length > 0) {
        results.set(variant.id, { sku: count.sku, outcome: 'per_location', before: current })
        return variant
      }
      if (current === count.quantity) {
        results.set(variant.id, { sku: count.sku, outcome: 'unchanged', before: current, after: current })
        return variant
      }
      rows.push({
        productId,
        variantId: variant.id,
        delta: count.quantity - current,
        reason: 'sync',
        source,
        atMs: nowMs,
      })
      results.set(variant.id, { sku: count.sku, outcome: 'updated', before: current, after: count.quantity })
      return { ...variant, inventory: count.quantity }
    })
    for (const [variantId, count] of counts) {
      if (!results.has(variantId)) results.set(variantId, { sku: count.sku, outcome: 'unknown_sku' })
    }
    if (!rows.length) return { results, before: null, after: null }
    const after = { ...before, variants }
    transaction.set(
      productRef,
      { variants, ...CommerceModel.productStockFields(after), updatedAtMs: nowMs },
      { merge: true },
    )
    for (const row of rows) transaction.set(host.collection('inventoryAdjustments').doc(), row)
    return { results, before, after }
  })
  if (outcome.before && outcome.after) alertLowStockCrossing(hostId, outcome.before, outcome.after)
  return outcome.results
}

/** The strongest outcome across the variants one SKU names: a change beats no change. */
const RANK: Record<PluginStockLevelOutcome, number> = {
  updated: 7,
  unchanged: 6,
  per_location: 5,
  untracked: 4,
  failed: 3,
  invalid: 2,
  unknown_sku: 1,
}

export async function setAvailableStock(
  request: Parameters<PluginStockLevels['setAvailable']>[0],
  firestore: Firestore = firebaseAdmin.app().firestore(),
): Promise<PluginStockLevelResult[]> {
  const source = String(request.source ?? '').trim().slice(0, 60) || 'Sync'
  const asked = request.levels.map((level) => {
    const sku = normalizeSku(level?.sku)
    const quantity = Number(level?.quantity)
    const valid = Boolean(sku) && Number.isInteger(quantity) && quantity >= 0 && quantity <= 10_000_000
    return { sku, quantity, valid }
  })
  const latest = new Map<string, number>()
  for (const entry of asked) if (entry.valid) latest.set(entry.sku, entry.quantity)
  const bySku = new Map<string, PluginStockLevelResult>()
  if (latest.size) {
    const located = await locateSkus(firestore, request.hostId, new Set(latest.keys()))
    const byProduct = new Map<string, Map<string, { sku: string; quantity: number }>>()
    for (const [sku, places] of located) {
      for (const place of places) {
        const counts = byProduct.get(place.productId) ?? new Map()
        counts.set(place.variantId, { sku, quantity: latest.get(sku) ?? 0 })
        byProduct.set(place.productId, counts)
      }
    }
    const nowMs = Date.now()
    for (const [productId, counts] of byProduct) {
      let results: Map<string, PluginStockLevelResult>
      try {
        results = await applyToProduct({ firestore, hostId: request.hostId, productId, counts, source, nowMs })
      } catch (error) {
        console.error('[stock-levels] count not applied', request.hostId, productId, error)
        results = new Map([...counts].map(([variantId, count]) => [variantId, { sku: count.sku, outcome: 'failed' }]))
      }
      for (const result of results.values()) {
        const held = bySku.get(result.sku)
        if (!held || RANK[result.outcome] > RANK[held.outcome]) bySku.set(result.sku, result)
      }
    }
  }
  return asked.map((entry) => {
    if (!entry.valid) return { sku: entry.sku, outcome: 'invalid' as const }
    return bySku.get(entry.sku) ?? { sku: entry.sku, outcome: 'unknown_sku' as const }
  })
}

export const commerceStockLevels: PluginStockLevels = {
  setAvailable: (request) => setAvailableStock(request),
}
