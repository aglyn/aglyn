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
'use client'

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type {
  ConsoleProductCopyValues,
  ConsoleProductSummary,
  ConsoleProductsHubZoneProps,
  ConsoleProposedDiscount,
  ConsoleProposedProduct,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { useFirestore, useHostResourceApi } from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  setDoc,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
import * as CommerceModel from '../../model'

/**
 * The products hub's zone (AGL-2916): the hub's catalog rows, and the writes a
 * widget there may ask the hub to make. A widget proposes; these are the
 * hub's writes, each through the door the hub's own controls use.
 *
 * - **Copy onto a saved product** is a transaction over the product as the
 *   store holds it now, never a row the table was seeded with: it changes
 *   only the fields the copy names, and renames options through
 *   `renameProductOptions`, so a sale or a colleague's edit since the table
 *   loaded is kept.
 * - **A proposed product** is created through the quota-enforcing resources
 *   API, as Add product and Import create one, after the hub's own allowance
 *   check for the batch. It is a draft with no price (`unpricedProductDraft`).
 * - **A category** is created as the catalog card creates one.
 * - **A discount** is created switched off (`switchedOffDiscount`), for a
 *   person to switch on from the discounts card.
 *
 * Each create passes over what the site already has — a product of the same
 * name among the hub's rows, a category of the same name, a discount with the
 * same code or, with no code, the same name — so a proposal applied twice, by
 * anyone, creates nothing twice. The category and discount checks are one
 * read each, made when a person applies, never while the hub is open.
 */

type ProductRow = CommerceModel.HostProduct & { $id: string }

/** The hub's allowance check for `count` more products: `null` while the plan loads. */
export type ProductsRoomCheck = (count: number) => { allowed: boolean; limit: number } | null

export interface ProductsHubZoneProps {
  hostId: string
  /** The catalog rows the hub holds. */
  products: readonly ProductRow[]
  roomFor: ProductsRoomCheck
  lastImport: ConsoleProductsHubZoneProps['lastImport']
  /** Called once a create has moved the catalog's count. */
  onCreated: () => void
}

export const PRODUCT_GONE_COPY = 'This product is no longer in the catalog.'
export const PLAN_LOADING_COPY = 'Your plan is still loading. Try again in a moment.'

/** How many of the site's categories the duplicate check reads. */
const CATEGORY_NAMES_READ = 250

/** How a name is compared for a duplicate: case and spacing aside. */
const nameKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase()

export function ProductsHubZone(props: ProductsHubZoneProps) {
  const { hostId, products, roomFor, lastImport, onCreated } = props
  const Slot = useConsoleWidgetSlot()
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()

  const summaries = useMemo<ConsoleProductSummary[]>(
    () =>
      products.map((product) => ({
        id: product.$id,
        name: product.name,
        status: product.status,
        priceMissing: CommerceModel.productPriceMissing(product),
        hasPhoto: Boolean(product.mediaUrls?.[0] ?? product.imageUrl),
      })),
    [products],
  )

  const applyProductCopy = useCallback(
    async (productId: string, values: ConsoleProductCopyValues) => {
      const ref = doc(firestore, 'hosts', hostId, 'products', productId)
      await runTransaction(firestore, async (transaction) => {
        const snapshot = await transaction.get(ref)
        const stored = snapshot.exists() ? (snapshot.data() as CommerceModel.HostProduct) : null
        if (!stored || stored.deletedAt) throw new Error(PRODUCT_GONE_COPY)
        const patch = CommerceModel.productCopyPatch(CommerceModel.liftLegacyProduct(stored), values)
        if (!Object.keys(patch).length) return
        transaction.update(ref, { ...patch, updatedAtMs: Date.now(), updatedAt: Timestamp.now() })
      })
    },
    [firestore, hostId],
  )

  const createProductDrafts = useCallback(
    async (proposals: readonly ConsoleProposedProduct[]) => {
      const held = new Set(products.map((product) => nameKey(product.name)))
      const fresh = proposals.filter((proposal) => {
        const key = nameKey(proposal.name)
        if (!key || held.has(key)) return false
        held.add(key)
        return true
      })
      if (!fresh.length) return []
      const room = roomFor(fresh.length)
      if (!room) throw new Error(PLAN_LOADING_COPY)
      if (!room.allowed) {
        throw new Error(
          `These products need ${fresh.length} product slots — your plan allows ` +
            `${room.limit}. See Billing to upgrade.`,
        )
      }
      const taken = new Set(products.map((product) => product.slug))
      const created: string[] = []
      try {
        for (const proposal of fresh) {
          const draft = CommerceModel.unpricedProductDraft(proposal, taken, Date.now())
          taken.add(draft.slug)
          const { id } = await createHostResource({ hostId, resource: 'product', data: draft })
          created.push(id)
        }
      } finally {
        if (created.length) onCreated()
      }
      return created
    },
    [products, roomFor, createHostResource, hostId, onCreated],
  )

  const createCategories = useCallback(
    async (names: readonly string[]) => {
      const existing = await getDocs(
        query(collection(firestore, 'hosts', hostId, 'productCategories'), limit(CATEGORY_NAMES_READ)),
      )
      const held = new Set(existing.docs.map((category) => nameKey(String(category.get('name') ?? ''))))
      let created = 0
      for (const raw of names) {
        const name = raw.trim().slice(0, 80)
        if (!name || held.has(nameKey(name))) continue
        held.add(nameKey(name))
        await setDoc(doc(firestore, 'hosts', hostId, 'productCategories', createResourceUid()), {
          name,
          slug: CommerceModel.commerceSlug(name),
          parentId: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
        created += 1
      }
      return created
    },
    [firestore, hostId],
  )

  const createDiscountDrafts = useCallback(
    async (discounts: readonly ConsoleProposedDiscount[]) => {
      const drafts = discounts
        .map((proposal) => CommerceModel.switchedOffDiscount(proposal))
        .filter((discount): discount is CommerceModel.StoredDiscount => discount !== null)
      if (!drafts.length) return 0
      const codes = [...new Set(drafts.map((discount) => discount.code).filter((code): code is string => Boolean(code)))]
      // A stored name is compared as typed, and the query matches it exactly.
      const names = [...new Set(drafts.filter((discount) => !discount.code).map((discount) => discount.name ?? ''))]
      const discountsRef = collection(firestore, 'hosts', hostId, 'discounts')
      const [byCode, byName] = await Promise.all([
        codes.length ? getDocs(query(discountsRef, where('code', 'in', codes.slice(0, 10)))) : null,
        names.length ? getDocs(query(discountsRef, where('name', 'in', names.slice(0, 10)))) : null,
      ])
      const heldCodes = new Set((byCode?.docs ?? []).map((existing) => String(existing.get('code'))))
      const heldNames = new Set((byName?.docs ?? []).map((existing) => nameKey(String(existing.get('name') ?? ''))))
      let created = 0
      for (const discount of drafts) {
        const name = nameKey(discount.name ?? '')
        if (discount.code ? heldCodes.has(discount.code) : heldNames.has(name)) continue
        if (discount.code) heldCodes.add(discount.code)
        else heldNames.add(name)
        await setDoc(doc(firestore, 'hosts', hostId, 'discounts', createResourceUid()), discount)
        created += 1
      }
      return created
    },
    [firestore, hostId],
  )

  if (!Slot) return null
  return (
    <Slot
      slot="productsHub"
      hostId={hostId}
      orgId={undefined}
      products={summaries}
      lastImport={lastImport}
      applyProductCopy={applyProductCopy}
      createProductDrafts={createProductDrafts}
      createCategories={createCategories}
      createDiscountDrafts={createDiscountDrafts}
    />
  )
}
ProductsHubZone.displayName = 'ProductsHubZone'

export default ProductsHubZone
