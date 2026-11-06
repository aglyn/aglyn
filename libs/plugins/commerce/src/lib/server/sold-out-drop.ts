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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
// By path: the barrel pulls `next/cache` in through the render cache.
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import * as CommerceModel from '../model'

/**
 * A SALE OR A RESTOCK THAT FLIPS "SOLD OUT" (AGL-4121).
 *
 * The storefront bakes stock into the cached page as booleans only: each
 * variant's `soldOut` on the product page (the chip, the disabled add-to-cart,
 * the JSON-LD availability) and each product's `soldOut` in every product grid,
 * which can sit on any page, the home page included. No count reaches the HTML.
 *
 * Product edits and stock adjustments from the console and the app already drop
 * the site. The checkout, the register, returns, cancellations, channel orders
 * and inventory sync did not, so a product that sold out kept offering itself
 * for as long as the page was cached — up to the week-long backstop once that
 * moved. Those writers call this with the product before and after their write.
 *
 * Only a FLIP drops anything: a sale that takes 7 units to 6 changes nothing a
 * visitor can see, and dropping on every unit would regenerate a busy store's
 * pages on every order. A flip is rare, so the drop is the whole site — a grid
 * on an arbitrary page shows the verdict and nothing maps a product to the
 * pages that place a grid.
 */

type StockShape = Pick<CommerceModel.HostProduct, 'variants' | 'oversellPolicy'>

/** Every sold-out verdict the storefront renders for a product, as one key. */
export function soldOutSignature(product: StockShape | null | undefined): string {
  if (!product) return ''
  const backorder = product.oversellPolicy === 'backorder'
  const variants = (product.variants ?? []).map((variant) =>
    variant.inventory != null && Number(variant.inventory) <= 0 && !backorder ? 1 : 0,
  )
  return `${CommerceModel.productStockFields(product).soldOut ? 1 : 0}:${variants.join('')}`
}

/** Whether a write moved any sold-out verdict a visitor sees. */
export function soldOutMoved(
  before: StockShape | null | undefined,
  after: StockShape | null | undefined,
): boolean {
  if (!before || !after) return false
  return soldOutSignature(before) !== soldOutSignature(after)
}

export interface SoldOutDropDeps {
  firestore?: () => FirebaseFirestore.Firestore
  dropCache?: typeof dropPluginSiteCache
}

/**
 * Drops the site's cached pages after a sold-out flip: a publish outbox entry
 * first, so the console's drain retries a refused drop, then the drop, then
 * the entry released once it certainly landed. NEVER THROWS — it runs after a
 * paid order or a restock that must not fail on a cache.
 */
export async function dropStorefrontPages(
  options: { hostId: string; reason: string },
  deps: SoldOutDropDeps = {},
): Promise<void> {
  const { hostId, reason } = options
  if (!hostId) return
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore())
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  let entry: FirebaseFirestore.DocumentReference | null = null
  try {
    const ref = firestore().collection('publishOutbox').doc(createResourceUid())
    await ref.set({
      hostId,
      paths: ['/'],
      createdAt: FieldValue.serverTimestamp(),
      attempts: 0,
      entireHost: true,
      reason: reason.slice(0, 200),
    })
    entry = ref
  } catch (error) {
    console.error('[commerce] a sold-out flip could not be queued', hostId, error)
  }
  try {
    const dropped = await dropCache({ hostIds: [hostId], reason })
    if (dropped.complete && entry) await entry.delete().catch(() => undefined)
    if (!dropped.complete && !entry) {
      console.error(
        JSON.stringify({ tag: 'AGL-4121:sold-out-drop-lost', hostId, reason }),
      )
    }
  } catch (error) {
    console.error('[commerce] a sold-out flip did not reach the live site', hostId, error)
  }
}
