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

import type { PluginApiHandler } from '@aglyn/aglyn/server'
import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Related products (AGL-325), best source first: the product's manual
 * list, then co-purchase pairs mined from recent orders ("frequently
 * bought together"), then tag/category neighbors. Returns catalog ids —
 * the block renders them through the ids-filtered catalog API.
 */
export const relatedHandler: PluginApiHandler = async (req, res) => {
  const hostId = String(req.query.hostId ?? '')
  const productId = String(req.query.productId ?? '')
  if (!hostId || !productId) {
    return res.status(400).json({ error: 'Missing hostId or productId' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const productSnapshot = await hostRef
      .collection('products')
      .doc(productId)
      .get()
    const product = Aglyn.liftLegacyProduct(
      (productSnapshot.data() as any) ?? {},
    )

    let ids = (product.relatedProductIds ?? []).slice(0, 8)

    if (ids.length === 0) {
      // Co-purchase pairs from recent multi-line orders.
      const orders = await hostRef.collection('orders').limit(100).get()
      const counts = new Map<string, number>()
      for (const docSnapshot of orders.docs) {
        const order = Aglyn.liftLegacyOrder(docSnapshot.data() as any)
        const lineIds = (order.lineItems ?? []).map((line) => line.productId)
        if (!lineIds.includes(productId)) continue
        for (const id of lineIds) {
          if (id === productId) continue
          counts.set(id, (counts.get(id) ?? 0) + 1)
        }
      }
      ids = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id]) => id)
    }

    if (ids.length === 0 && (product.tags?.length || product.categoryIds?.length)) {
      // Tag/category neighbors.
      const catalog = await hostRef.collection('products').limit(300).get()
      ids = catalog.docs
        .filter((docSnapshot) => {
          if (docSnapshot.id === productId) return false
          const candidate = docSnapshot.data() as any
          if (candidate.deletedAt || candidate.status !== 'active') return false
          const sharedTag = (candidate.tags ?? []).some((tag: string) =>
            (product.tags ?? []).includes(tag),
          )
          const sharedCategory = (candidate.categoryIds ?? []).some(
            (id: string) => (product.categoryIds ?? []).includes(id),
          )
          return sharedTag || sharedCategory
        })
        .slice(0, 8)
        .map((docSnapshot) => docSnapshot.id)
    }

    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600',
    )
    return res.status(200).json({ productIds: ids })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Related unavailable' })
  }
}
