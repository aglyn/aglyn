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

import * as Aglyn from '@aglyn/aglyn/server'
import type {
  PluginProductWriter,
  SourcedProductWrite,
  SourcedProductWriteOutcome,
} from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import type { TransferResourceContext } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import {
  commerceSlug,
  liftLegacyProduct,
  validateProduct,
  type HostProduct,
  type ProductVariant,
} from '../model/commerce'
import { derivedKeys, readSmartCollections } from '../transfer/products.server'
import { withoutUndefined } from '../transfer/server-common'

/**
 * Products another plugin brings from a source of its own — a print-on-demand
 * service, a supplier — written through the store's own rules (AGL-3641),
 * behind core's `core.product-writer`.
 *
 * The same rules the console's product route and the file import keep: a
 * create is counted against the plan's product allowance in the transaction
 * that makes it, a new product takes an address no other product holds (a
 * deleted one's included), every write carries the search, stock and
 * smart-collection keys every writer derives, and the site's activity says
 * what happened.
 *
 * A configuration the source cannot make now is sold out (`inventory: 0`);
 * one it can is untracked (`inventory: null`), because a made-to-order item
 * has no count to run down.
 */

type ProductDoc = Partial<HostProduct> & Record<string, unknown>

/** The fields an update compares to tell a change from a repeat. */
const COMPARED_KEYS = ['name', 'description', 'mediaUrls', 'tags', 'options', 'variants'] as const

/** How many suffixed addresses a new product tries before it gives up. */
const SLUG_TRIES = 30
const SLUGS_PER_QUERY = 30

const newVariantId = () => `v${Aglyn.createResourceUid().slice(0, 10)}`

function priceUsd(minor: number): number {
  return Math.round(Math.max(0, Number(minor) || 0)) / 100
}

/** The variant a sourced configuration becomes, on top of the one it was. */
function variantFrom(
  source: SourcedProductWrite['product']['variants'][number],
  existing: ProductVariant | undefined,
  options: { prices: boolean; content: boolean },
): ProductVariant {
  const price = existing && !options.prices ? existing.priceUsd : priceUsd(source.priceMinor)
  const next: ProductVariant = {
    ...(existing ?? {}),
    id: existing?.id ?? newVariantId(),
    options: { ...source.options },
    priceUsd: price,
    inventory: source.available ? null : 0,
  }
  delete next.inventoryByLocation
  if (source.sku) next.sku = source.sku.slice(0, 120)
  else delete next.sku
  if (Number.isFinite(source.weightGrams) && Number(source.weightGrams) > 0) {
    next.weightGrams = Math.round(Number(source.weightGrams))
  }
  if (source.imageUrl && (options.content || !existing?.imageUrl)) next.imageUrl = source.imageUrl
  // A price brought below a compare-at that no longer exceeds it would be
  // refused: the strike-through goes, the price stays.
  if (next.compareAtPriceUsd != null && Number(next.compareAtPriceUsd) <= next.priceUsd) {
    delete next.compareAtPriceUsd
  }
  return next
}

async function freeSlug(products: FirebaseFirestore.CollectionReference, name: string): Promise<string | null> {
  const base = commerceSlug(name).slice(0, 80) || 'product'
  const candidates = [base, ...Array.from({ length: SLUG_TRIES - 1 }, (_, index) => `${base}-${index + 2}`)]
  const taken = new Set<string>()
  for (let at = 0; at < candidates.length; at += SLUGS_PER_QUERY) {
    const slice = candidates.slice(at, at + SLUGS_PER_QUERY)
    for (const doc of (await products.where('slug', 'in', slice).get()).docs) taken.add(String(doc.get('slug')))
  }
  return candidates.find((candidate) => !taken.has(candidate)) ?? null
}

class WriteRefusal extends Error {
  constructor(readonly outcome: Exclude<SourcedProductWriteOutcome, { productId: string }>) {
    super(outcome.outcome)
  }
}

export async function upsertSourcedProduct(
  write: SourcedProductWrite,
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<SourcedProductWriteOutcome> {
  const { hostId, product: source } = write
  if (!isDocumentId(hostId)) return { outcome: 'no_store' }
  const owner = await getOrgForHost(hostId)
  if (!owner || !Aglyn.checkEntitlement(owner.org as never, 'commerce')) return { outcome: 'no_store' }
  const org = owner.org
  const products = firestore.collection('hosts').doc(hostId).collection('products')
  const smart = await readSmartCollections(firestore, { hostId } as TransferResourceContext)
  const { Timestamp } = firebaseAdmin.firestore
  const actor = { uid: write.actorUid ?? 'import', email: null }
  const name = source.name.trim().slice(0, 200)
  const description = (source.description ?? '').trim().slice(0, 20_000)

  const mapping = (product: HostProduct) =>
    source.variants.map((variant, index) => ({ key: variant.key, variantId: product.variants[index].id }))

  try {
    // An update, when the product is still there.
    if (write.productId && isDocumentId(write.productId)) {
      const ref = products.doc(write.productId)
      const updated = await firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        const data = snapshot.data() as ProductDoc | undefined
        if (!snapshot.exists || (data?.['deletedAt'] !== null && data?.['deletedAt'] !== undefined)) return null
        const current = liftLegacyProduct(data as ProductDoc)
        const flags = { prices: write.prices === true, content: write.content === true }
        const byId = new Map(current.variants.map((variant) => [variant.id, variant]))
        const next: HostProduct = {
          ...current,
          options: source.options.map((option) => ({ name: option.name, values: [...option.values] })),
          variants: source.variants.map((variant) =>
            variantFrom(variant, variant.variantId ? byId.get(variant.variantId) : undefined, flags),
          ),
          ...(flags.content
            ? {
                name,
                description,
                mediaUrls: [...source.mediaUrls],
                ...(source.tags ? { tags: [...source.tags] } : {}),
              }
            : {}),
        }
        const invalid = validateProduct(next)
        if (invalid) throw new WriteRefusal({ outcome: 'invalid', message: invalid })
        const changed = COMPARED_KEYS.some(
          (key) =>
            JSON.stringify((next as unknown as Record<string, unknown>)[key] ?? null) !==
            JSON.stringify((current as unknown as Record<string, unknown>)[key] ?? null),
        )
        if (changed) {
          tx.update(
            ref,
            withoutUndefined({
              ...Object.fromEntries(COMPARED_KEYS.map((key) => [key, (next as unknown as Record<string, unknown>)[key]])),
              ...derivedKeys(next, smart),
              updatedAtMs: Date.now(),
              updatedAt: Timestamp.now(),
            }) as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>,
          )
        }
        return { next, changed }
      })
      if (updated) {
        if (updated.changed) {
          await logHostActivity(hostId, actor, 'Updated product from its source', {
            type: 'content',
            id: write.productId,
            name: updated.next.name,
          })
        }
        return {
          outcome: updated.changed ? 'updated' : 'unchanged',
          productId: write.productId,
          variants: mapping(updated.next),
        }
      }
    }

    if (write.productId && write.recreate === false) return { outcome: 'missing' }

    // A new product.
    const slug = await freeSlug(products, name)
    if (!slug) return { outcome: 'invalid', message: 'Every address for a product of this name is taken. Rename one first.' }
    const productId = Aglyn.createResourceUid()
    const product: HostProduct = {
      name,
      slug,
      description,
      type: 'physical',
      status: write.status === 'active' ? 'active' : 'draft',
      mediaUrls: [...source.mediaUrls],
      ...(source.tags?.length ? { tags: [...source.tags] } : {}),
      options: source.options.map((option) => ({ name: option.name, values: [...option.values] })),
      variants: source.variants.map((variant) => variantFrom(variant, undefined, { prices: true, content: true })),
      oversellPolicy: 'deny',
    }
    const invalid = validateProduct(product)
    if (invalid) return { outcome: 'invalid', message: invalid }
    const now = Date.now()
    const ref = products.doc(productId)
    await firestore.runTransaction(async (tx) => {
      const used = (await tx.get(products.count())).data().count
      const quota = Aglyn.checkQuota(org as never, 'productsPerHost', Number(used) || 0)
      if (!quota.allowed) throw new WriteRefusal({ outcome: 'plan_limit', limit: Number(quota.limit) || 0 })
      tx.create(
        ref,
        withoutUndefined({
          ...product,
          ...derivedKeys(product, smart),
          createdAtMs: now,
          updatedAtMs: now,
          deletedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: write.actorUid ?? null,
        }),
      )
    })
    await logHostActivity(hostId, actor, 'Imported product', { type: 'content', id: productId, name: product.name })
    return { outcome: 'created', productId, variants: mapping(product) }
  } catch (error) {
    if (error instanceof WriteRefusal) return error.outcome
    throw error
  }
}

export const commerceProductWriter: PluginProductWriter = {
  upsertSourced: (write) => upsertSourcedProduct(write),
}
