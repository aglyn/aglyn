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

import { validateProductForSave } from '../model/product-card-rules'
import * as Aglyn from '@aglyn/aglyn/server'
import { countLiveDocuments } from '@aglyn/aglyn/app-utils/live-document-count'
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
const COMPARED_KEYS = ['name', 'description', 'mediaUrls', 'tags', 'seo', 'options', 'variants'] as const

/** The source's search words, only where the product has none of its own. */
function seoFrom(
  source: SourcedProductWrite['product']['seo'],
  current: HostProduct['seo'] | undefined,
): HostProduct['seo'] | undefined {
  const title = current?.title?.trim() ? current.title : source?.title?.trim().slice(0, 60)
  const description = current?.description?.trim() ? current.description : source?.description?.trim().slice(0, 155)
  if (!title && !description && !current) return undefined
  return { ...(current ?? {}), ...(title ? { title } : {}), ...(description ? { description } : {}) }
}

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

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/**
 * Pairs each sourced configuration that names no variant id with one the
 * product already has (AGL-3641 linking): first by SKU, then by the same
 * choices whatever the options are called. This is what lets a merchant
 * link a product they made by hand, or copied from another store, to the
 * source without losing its variants, their ids or the orders that name
 * them. A current variant is claimed once.
 */
export function matchSourcedVariants(
  source: SourcedProductWrite['product']['variants'],
  current: readonly ProductVariant[],
): Array<string | undefined> {
  const known = new Set(current.map((variant) => variant.id))
  const claimed = new Set(source.map((variant) => variant.variantId).filter((id): id is string => Boolean(id && known.has(id))))
  const free = () => current.filter((variant) => !claimed.has(variant.id))
  const choices = (options: Record<string, string> | undefined) =>
    Object.values(options ?? {})
      .map(norm)
      .filter(Boolean)
      .sort()
      .join('|')
  const ids: Array<string | undefined> = source.map((variant) =>
    variant.variantId && known.has(variant.variantId) ? variant.variantId : undefined,
  )
  const claim = (index: number, found: ProductVariant | undefined) => {
    if (!found) return
    ids[index] = found.id
    claimed.add(found.id)
  }
  source.forEach((variant, index) => {
    if (ids[index] || !variant.sku) return
    claim(index, free().find((candidate) => candidate.sku && norm(candidate.sku) === norm(variant.sku)))
  })
  source.forEach((variant, index) => {
    if (ids[index]) return
    const wanted = choices(variant.options)
    claim(index, free().find((candidate) => choices(candidate.options) === wanted))
  })
  // A product with one configuration on both sides is the same one.
  if (source.length === 1 && current.length === 1 && !ids[0] && !claimed.has(current[0].id)) ids[0] = current[0].id
  return ids
}

/**
 * The merchant's own words for the options, kept across a re-sync (AGL-3641):
 * a variant the product already had says what each of the source's option
 * names and values is called here, so a store that renamed "Colors" to
 * "Color" or "Heather Grey" to "Grey" keeps its labels. A name or value with
 * no consistent counterpart keeps the source's word.
 */
export function keepMerchantLabels(
  source: SourcedProductWrite['product'],
  current: HostProduct,
  ids: ReadonlyArray<string | undefined>,
): { options: SourcedProductWrite['product']['options']; variants: Array<Record<string, string>> } {
  const byId = new Map(current.variants.map((variant) => [variant.id, variant]))
  const currentNames = current.options.map((option) => option.name)
  const sameShape = currentNames.length === source.options.length
  const nameFor = (index: number) => (sameShape && currentNames[index] ? currentNames[index] : source.options[index].name)
  // Per option position: source value -> merchant value, only where every pair agrees.
  const valueMaps = source.options.map(() => new Map<string, string | null>())
  if (sameShape) {
    source.variants.forEach((variant, at) => {
      const id = ids[at]
      const existing = id ? byId.get(id) : undefined
      if (!existing) return
      source.options.forEach((option, index) => {
        const from = variant.options[option.name]
        const to = existing.options?.[currentNames[index]]
        if (!from || !to) return
        const map = valueMaps[index]
        if (!map.has(from)) map.set(from, to)
        else if (map.get(from) !== to) map.set(from, null)
      })
    })
    // Two source values renamed to one label would merge choices: keep the source's words for those.
    valueMaps.forEach((map) => {
      const seen = new Map<string, number>()
      for (const to of map.values()) if (to) seen.set(to, (seen.get(to) ?? 0) + 1)
      for (const [from, to] of map) if (to && (seen.get(to) ?? 0) > 1) map.set(from, null)
    })
  }
  const label = (index: number, value: string) => valueMaps[index]?.get(value) || value
  return {
    options: source.options.map((option, index) => ({
      name: nameFor(index),
      values: [...new Set(option.values.map((value) => label(index, value)))],
    })),
    variants: source.variants.map((variant) => {
      if (source.options.length === 0) return { ...variant.options }
      const out: Record<string, string> = {}
      source.options.forEach((option, index) => {
        const value = variant.options[option.name]
        if (value) out[nameFor(index)] = label(index, value)
      })
      return out
    }),
  }
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
      let matched = 0
      const updated = await firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        const data = snapshot.data() as ProductDoc | undefined
        if (!snapshot.exists || (data?.['deletedAt'] !== null && data?.['deletedAt'] !== undefined)) return null
        const current = liftLegacyProduct(data as ProductDoc)
        const flags = { prices: write.prices === true, content: write.content === true }
        const byId = new Map(current.variants.map((variant) => [variant.id, variant]))
        // Pair by SKU and plain choices, learn the merchant's labels from those pairs,
        // then pair the rest by their choices in the merchant's words.
        const first = matchSourcedVariants(source.variants, current.variants)
        const learned = keepMerchantLabels(source, current, first)
        const ids = matchSourcedVariants(
          source.variants.map((variant, index) => ({
            ...variant,
            options: learned.variants[index],
            ...(first[index] ? { variantId: first[index] } : {}),
          })),
          current.variants,
        )
        matched = ids.filter(Boolean).length
        const labels = flags.content
          ? {
              options: source.options.map((option) => ({ name: option.name, values: [...option.values] })),
              variants: source.variants.map((variant) => ({ ...variant.options })),
            }
          : keepMerchantLabels(source, current, ids)
        const seo = seoFrom(source.seo, current.seo)
        const next: HostProduct = {
          ...current,
          ...(seo ? { seo } : {}),
          options: labels.options.map((option) => ({ name: option.name, values: [...option.values] })),
          variants: source.variants.map((variant, index) =>
            variantFrom({ ...variant, options: labels.variants[index] }, ids[index] ? byId.get(ids[index] as string) : undefined, flags),
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
        const invalid = validateProductForSave(next)
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
          matched,
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
      ...(seoFrom(source.seo, undefined) ? { seo: seoFrom(source.seo, undefined) } : {}),
      options: source.options.map((option) => ({ name: option.name, values: [...option.values] })),
      variants: source.variants.map((variant) => variantFrom(variant, undefined, { prices: true, content: true })),
      oversellPolicy: 'deny',
    }
    const invalid = validateProductForSave(product)
    if (invalid) return { outcome: 'invalid', message: invalid }
    const now = Date.now()
    const ref = products.doc(productId)
    await firestore.runTransaction(async (tx) => {
      // Live products only: a deleted one frees its slot, an archived one keeps it (AGL-3918).
      const used = await countLiveDocuments(products, (aggregate) => tx.get(aggregate))
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

/** A sourced product whose source dropped it, back to a draft (AGL-3641). */
export async function unlistSourcedProduct(
  input: { hostId: string; productId: string; actorUid?: string },
  firestore: FirebaseFirestore.Firestore = firebaseAdmin.app().firestore(),
): Promise<'unlisted' | 'unchanged' | 'missing'> {
  if (!isDocumentId(input.hostId) || !isDocumentId(input.productId)) return 'missing'
  const ref = firestore.collection('hosts').doc(input.hostId).collection('products').doc(input.productId)
  const outcome = await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const data = snapshot.data() as ProductDoc | undefined
    if (!snapshot.exists || (data?.['deletedAt'] !== null && data?.['deletedAt'] !== undefined)) return { result: 'missing' as const }
    if (data?.status !== 'active') return { result: 'unchanged' as const }
    tx.update(ref, { status: 'draft', updatedAtMs: Date.now(), updatedAt: firebaseAdmin.firestore.Timestamp.now() })
    return { result: 'unlisted' as const, name: String(data?.name ?? '') }
  })
  if (outcome.result === 'unlisted') {
    await logHostActivity(input.hostId, { uid: input.actorUid ?? 'import', email: null }, 'Took product off sale: its source no longer offers it', {
      type: 'content',
      id: input.productId,
      name: outcome.name,
    })
  }
  return outcome.result
}

export const commerceProductWriter: PluginProductWriter = {
  upsertSourced: (write) => upsertSourcedProduct(write),
  unlistSourced: (input) => unlistSourcedProduct(input),
}
