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
import {
  buildMatchLookup,
  type BuildTransferPlanInput,
  type MatchKeySpec,
  type MatchLookupRequest,
  type TransferChunk,
  type TransferPlan,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoSnapshot,
} from '@aglyn/aglyn/data-transfer'
import type { PicklistValue } from '@aglyn/aglyn/app-utils/picklists'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
  TransferPicklistList,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin, getOrgForHost, logHostActivity } from '@aglyn/tenant-data-admin'
import { PRODUCT_LIST_QUERY } from '../constants/product-list-query'
import {
  commerceSlug,
  liftLegacyProduct,
  productCollectionIds,
  productSearchFields,
  productStockFields,
  validateProduct,
  type HostProduct,
  type SmartCollectionRules,
} from '../model/commerce'
import {
  PRODUCT_CATEGORY_PICKLIST,
  PRODUCT_FIELD,
  PRODUCT_FIXED_PICKLISTS,
  PRODUCT_LEVEL_FIELDS,
  PRODUCT_VARIANT_ORDER,
  applyProductRow,
  createProductDocument,
  planProductTransfer,
  productExportRowCount,
  productExportRows,
  productPlanHandles,
  productRecord,
  productRowChanges,
  productVariantKey,
  type ProductPlannedRow,
} from './product-transfer'
import {
  NOTHING,
  ROW_BUDGET_MS,
  eachSourceDoc,
  firestoreOf,
  hostRefOf,
  readSourcePage,
  readerSeesHost,
  revertEntries,
  withoutUndefined,
  type CommerceListSource,
  type Firestore,
} from './server-common'

/*
 * PRODUCTS: THE SERVER HALF (AGL-3531). The pure half — the fields, the
 * Shopify layout, the plan that folds rows into products — is
 * `product-transfer.ts`; this is where it meets the store.
 *
 * Writes keep the product write path's rules: a create is counted against
 * the plan's product allowance in the same transaction that creates it (the
 * `api/hosts/resources` rule, AGL-2231), is born live (`deletedAt: null`)
 * with its creator and stamps, and every write carries the search, stock
 * and smart-collection keys every writer derives (AGL-3321) and leaves an
 * entry in the site's activity. A stock count a file changes is logged as a
 * correction, the same log a manual adjustment writes.
 */

type ProductDoc = Partial<HostProduct> & Record<string, unknown>

const ID_IN_MAX = 30

function productsOf(firestore: Firestore, ctx: TransferResourceContext) {
  return hostRefOf(firestore, ctx).collection('products')
}

function productSource(firestore: Firestore, ctx: TransferResourceContext): CommerceListSource {
  return {
    collection: productsOf(firestore, ctx),
    declaration: PRODUCT_LIST_QUERY,
    base: [{ path: 'deletedAt', op: '==', value: null }],
  }
}

const isLive = (data: FirebaseFirestore.DocumentData | undefined): boolean =>
  Boolean(data) && (data?.['deletedAt'] === null || data?.['deletedAt'] === undefined)

/** The site's categories, id → name. */
async function readCategoryNames(firestore: Firestore, ctx: TransferResourceContext): Promise<Map<string, string>> {
  const snapshot = await hostRefOf(firestore, ctx).collection('productCategories').limit(2000).get()
  return new Map(snapshot.docs.map((doc) => [doc.id, String(doc.get('name') ?? doc.id)]))
}

/** Names → ids by the site's categories, in any case; a name it lacks is left out. */
function categoryIdsBy(names: ReadonlyMap<string, string>) {
  const byName = new Map([...names].map(([id, name]) => [name.trim().toLowerCase(), id]))
  return (wanted: readonly string[]) => {
    const ids: string[] = []
    for (const name of wanted) {
      const id = byName.get(name.trim().toLowerCase()) ?? (names.has(name) ? name : undefined)
      if (id && !ids.includes(id)) ids.push(id)
    }
    return ids
  }
}

/** The smart collections a product's write answers (AGL-3321). */
export async function readSmartCollections(firestore: Firestore, ctx: TransferResourceContext): Promise<SmartCollectionRules[]> {
  const snapshot = await hostRefOf(firestore, ctx)
    .collection('collections')
    .where('kind', '==', 'catalog')
    .where('mode', '==', 'smart')
    .get()
  return snapshot.docs.map((doc) => ({ id: doc.id, rules: doc.get('rules') ?? [], matchAll: doc.get('matchAll') }))
}

/** The keys every product write derives, from the product as it will stand. */
export function derivedKeys(product: HostProduct, smart: readonly SmartCollectionRules[]): Record<string, unknown> {
  return {
    ...productSearchFields(product),
    ...productStockFields(product),
    collectionIds: productCollectionIds(product, smart),
    priceUsd: product.variants[0]?.priceUsd ?? 0,
    imageUrl: product.mediaUrls?.[0] ?? null,
  }
}

/** The document fields a product write may set, the product resource's allow-list. */
const PRODUCT_DOC_KEYS = [
  'name',
  'description',
  'type',
  'status',
  'tags',
  'categoryIds',
  'mediaUrls',
  'options',
  'variants',
  'seo',
  'taxExempt',
  'oversellPolicy',
  'lowStockThreshold',
] as const

/** The record keys an undo entry keeps: the product's writable fields and its variants. */
function undoKeys(record: Readonly<Record<string, unknown>>, only?: readonly string[]): Record<string, unknown> {
  const keys =
    only ??
    [
      ...PRODUCT_LEVEL_FIELDS.filter((fieldId) => fieldId !== PRODUCT_FIELD.published),
      ...((record[PRODUCT_VARIANT_ORDER] as string[] | undefined) ?? []).map(productVariantKey),
    ]
  return Object.fromEntries(keys.map((key) => [key, record[key] ?? null]))
}

/*------------------------------------------
 * Export
 *-----------------------------------------*/

/** The rows of one page of products. A product is as many rows as it has variants (or images). */
export async function readProductsPage(
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options?: TransferReadOptions,
  firestore: Firestore = firestoreOf(),
): Promise<TransferReadPage> {
  if (!readerSeesHost(ctx, options)) return NOTHING
  const pageSize = Math.max(1, Math.min(200, options?.pageSize ?? 200))
  const page = await readSourcePage(firestore, productSource(firestore, ctx), cursor, options, pageSize)
  const names = fieldIds.includes(PRODUCT_FIELD.categories) ? await readCategoryNames(firestore, ctx) : new Map()
  const rows = page.docs
    .filter((doc) => isLive(doc.data()))
    .flatMap((doc) => productExportRows(doc.id, liftLegacyProduct(doc.data() as ProductDoc), fieldIds, names))
  return { rows, next: page.next }
}

/** How many rows the export writes: every live product's variant (or image) rows. */
export async function countProductRows(
  ctx: TransferResourceContext,
  options: TransferReadOptions,
  firestore: Firestore = firestoreOf(),
): Promise<number> {
  if (!readerSeesHost(ctx, options)) return 0
  let rows = 0
  await eachSourceDoc(firestore, productSource(firestore, ctx), options, (doc) => {
    const data = doc.data() as ProductDoc | undefined
    if (isLive(data)) rows += productExportRowCount(liftLegacyProduct(data as ProductDoc))
  })
  return rows
}

/*------------------------------------------
 * Matching
 *-----------------------------------------*/

/** The values a product is found by: its handle, every SKU it carries, its id. */
function matchValues(id: string, data: ProductDoc): Record<string, unknown> {
  const product = liftLegacyProduct(data)
  return {
    [PRODUCT_FIELD.handle]: product.slug,
    [PRODUCT_FIELD.sku]: product.variants.map((variant) => variant.sku).filter(Boolean),
    id,
  }
}

/** The live products holding each requested handle, SKU or id, and each one's record. */
export async function lookupProducts(
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
  firestore: Firestore = firestoreOf(),
): Promise<TransferLookupResult> {
  const products = productsOf(firestore, ctx)
  const found = new Map<string, ProductDoc>()
  const keys: MatchKeySpec[] = []
  for (const request of requests) {
    keys.push({ fieldId: request.fieldId, normalizer: request.normalizer })
    for (let at = 0; at < request.values.length; at += ID_IN_MAX) {
      const slice = request.values.slice(at, at + ID_IN_MAX)
      if (request.fieldId === 'id') {
        const snapshots = await firestore.getAll(...slice.map((id) => products.doc(id)))
        for (const doc of snapshots) if (doc.exists && isLive(doc.data())) found.set(doc.id, doc.data() as ProductDoc)
        continue
      }
      const query =
        request.fieldId === PRODUCT_FIELD.handle
          ? products.where('slug', 'in', slice)
          : request.fieldId === PRODUCT_FIELD.sku
            ? products.where('skus', 'array-contains-any', slice)
            : null
      if (!query) continue
      for (const doc of (await query.get()).docs) if (isLive(doc.data())) found.set(doc.id, doc.data() as ProductDoc)
    }
  }
  const names = found.size ? await readCategoryNames(firestore, ctx) : new Map<string, string>()
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const [id, data] of found) records.set(id, productRecord(liftLegacyProduct(data), names))
  const lookup = buildMatchLookup(
    [...found].map(([id, data]) => ({ id, values: matchValues(id, data) })),
    keys,
  )
  return { lookup, records }
}

/*------------------------------------------
 * Lists
 *-----------------------------------------*/

/** The fixed lists, and the site's categories as a list a file may add to. */
export async function productPicklists(
  ctx: TransferResourceContext,
  picklistIds: readonly string[],
  firestore: Firestore = firestoreOf(),
): Promise<Record<string, TransferPicklistList>> {
  const out: Record<string, TransferPicklistList> = {}
  for (const picklistId of picklistIds) {
    const fixed = PRODUCT_FIXED_PICKLISTS[picklistId]
    if (fixed) {
      out[picklistId] = {
        spec: fixed,
        set: {
          values: fixed.standardValues.map((value) => ({ id: value.id, label: value.label, active: true })),
          defaultValueId: fixed.defaultValueId ?? null,
        },
      }
    } else if (picklistId === PRODUCT_CATEGORY_PICKLIST) {
      const names = await readCategoryNames(firestore, ctx)
      out[picklistId] = {
        spec: { restricted: false, standardValues: [] },
        set: {
          values: [...names].map(([id, label]) => ({ id, label, active: true })),
          defaultValueId: null,
        },
      }
    }
  }
  return out
}

/**
 * The categories the person chose to add, created before the first product
 * names them — each under the id the wizard minted, so a retry finds it.
 */
export async function addProductCategories(
  ctx: TransferResourceContext,
  picklistId: string,
  values: readonly PicklistValue[],
  firestore: Firestore = firestoreOf(),
): Promise<void> {
  if (picklistId !== PRODUCT_CATEGORY_PICKLIST) return
  const categories = hostRefOf(firestore, ctx).collection('productCategories')
  const names = await readCategoryNames(firestore, ctx)
  const held = new Set([...names.values()].map((name) => name.trim().toLowerCase()))
  for (const value of values) {
    const name = value.label.trim()
    if (!name || held.has(name.toLowerCase())) continue
    held.add(name.toLowerCase())
    await categories.doc(value.id).set({ name, slug: commerceSlug(name) || value.id, parentId: null }, { merge: true })
  }
}

/*------------------------------------------
 * Plan
 *-----------------------------------------*/

const newId = () => Aglyn.createResourceUid()
const newVariantId = () => `v${Aglyn.createResourceUid().slice(0, 10)}`

/**
 * The dry run: the slugs a new product would collide with (a deleted
 * product's included, which still holds its address) and the plan's room
 * for new products, then the fold of `planProductTransfer`.
 */
export async function planProducts(
  ctx: TransferResourceContext,
  input: BuildTransferPlanInput,
  firestore: Firestore = firestoreOf(),
): Promise<TransferPlan> {
  const products = productsOf(firestore, ctx)
  const taken = new Set<string>()
  const candidates = productPlanHandles(input.rows).flatMap((base) => [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)])
  for (let at = 0; at < candidates.length; at += ID_IN_MAX) {
    const slice = candidates.slice(at, at + ID_IN_MAX)
    for (const doc of (await products.where('slug', 'in', slice).get()).docs) taken.add(String(doc.get('slug')))
  }
  const owner = await getOrgForHost(ctx.hostId as string)
  const org = owner?.org ?? null
  const used = Number((await products.count().get()).data().count) || 0
  const maxCreates = Aglyn.checkEntitlement(org as never, 'commerce')
    ? Aglyn.checkQuota(org as never, 'productsPerHost', used).remaining
    : 0
  return planProductTransfer(input, {
    newProductId: newId,
    newVariantId,
    slugTaken: (slug) => taken.has(slug),
    maxCreates,
  })
}

/*------------------------------------------
 * Apply
 *-----------------------------------------*/

/** A refusal the apply records for one row, rather than failing the chunk. */
class RowRefusal extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message)
  }
}

/** Writes one chunk of planned product rows through the product write path. */
export async function applyProducts(
  ctx: TransferResourceContext,
  chunk: TransferChunk<ProductPlannedRow>,
  writer: TransferApplyWriter,
  firestore: Firestore = firestoreOf(),
): Promise<TransferApplyResult> {
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []
  const products = productsOf(firestore, ctx)
  const hostId = ctx.hostId as string
  const { Timestamp, FieldValue } = firebaseAdmin.firestore
  const names = await readCategoryNames(firestore, ctx)
  const categoryIdsOf = categoryIdsBy(names)
  const smart = await readSmartCollections(firestore, ctx)
  const owner = await getOrgForHost(hostId)
  const org = owner?.org ?? null
  const actor = { uid: ctx.actorUid ?? 'import', email: null }
  const logged = new Set<string>()
  const adjustments: Array<{ productId: string; variantId: string; delta: number }> = []

  const done = async (result: TransferRowResult, entry?: TransferUndoEntry) => {
    results.push(result)
    if (entry) undo.push(entry)
    await writer.markApplied(result, entry)
  }

  for (const row of chunk.rows) {
    const earlier = await writer.alreadyApplied(row.index)
    if (earlier) {
      results.push(earlier)
      continue
    }
    if (writer.timeLeftMs() < ROW_BUDGET_MS) break
    const plan = row.commerce
    if (!plan) {
      await done({ row: row.index, outcome: 'failed', message: 'The dry run carried nothing to write for this row.' })
      continue
    }
    const ref = products.doc(plan.productId)
    try {
      if (plan.role === 'create') {
        const product = createProductDocument(plan.create as NonNullable<typeof plan.create>, categoryIdsOf)
        const now = Date.now()
        const doc = withoutUndefined({
          ...product,
          ...derivedKeys(product, smart),
          createdAtMs: now,
          updatedAtMs: now,
          deletedAt: null,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          createdBy: ctx.actorUid,
        })
        const created = await firestore.runTransaction(async (tx) => {
          const existing = await tx.get(ref)
          // A retry after the write landed and before its row was recorded.
          if (existing.exists) return false
          const used = (await tx.get(products.count())).data().count
          const quota = Aglyn.checkQuota(org as never, 'productsPerHost', Number(used) || 0)
          if (!quota.allowed) {
            throw new RowRefusal('planLimit', `Your plan includes ${quota.limit} products — upgrade in Billing for more.`)
          }
          tx.create(ref, doc)
          return true
        })
        if (created && !logged.has(plan.productId)) {
          logged.add(plan.productId)
          await logHostActivity(hostId, actor, 'Imported product', { type: 'content', id: plan.productId, name: product.name })
        }
        await done(
          { row: row.index, outcome: 'created', recordId: plan.productId },
          {
            row: row.index,
            recordId: plan.productId,
            action: 'created',
            written: undoKeys(productRecord(product, names)),
          },
        )
        continue
      }

      if (plan.role === 'part') {
        // Written with its product by the product's first row.
        const snapshot = await ref.get()
        if (!snapshot.exists) {
          await done({
            row: row.index,
            outcome: 'failed',
            reason: 'matchedRecordMissing',
            message: `The product on row ${plan.leader + 1} was not created, so this row's variant was not either.`,
          })
        } else {
          await done({ row: row.index, outcome: 'created', recordId: plan.productId })
        }
        continue
      }

      // An existing product: this row's changes, read and written in one transaction.
      const changes = productRowChanges(row)
      const outcome = await firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        const data = snapshot.data() as ProductDoc | undefined
        if (!snapshot.exists || !isLive(data)) {
          throw new RowRefusal('matchedRecordMissing', 'The product was deleted after the dry run.')
        }
        const current = liftLegacyProduct(data as ProductDoc)
        const next = applyProductRow(current, changes, categoryIdsOf)
        const invalid = validateProduct(next)
        if (invalid) throw new RowRefusal('refusedValue', invalid)
        const patch: Record<string, unknown> = {}
        for (const key of PRODUCT_DOC_KEYS) {
          const value = (next as unknown as Record<string, unknown>)[key]
          const was = (current as unknown as Record<string, unknown>)[key]
          if (JSON.stringify(value) === JSON.stringify(was)) continue
          patch[key] = value === undefined ? FieldValue.delete() : withoutUndefined(value)
        }
        Object.assign(patch, withoutUndefined(derivedKeys(next, smart)), {
          updatedAtMs: Date.now(),
          updatedAt: Timestamp.now(),
        })
        tx.update(ref, patch)
        return { current, next }
      })
      const before = productRecord(outcome.current, names)
      const afterRecord = productRecord(outcome.next, names)
      const touched = [
        ...Object.keys(changes.product).filter((fieldId) => fieldId !== PRODUCT_FIELD.published),
        ...(changes.variant ? [productVariantKey(changes.variant.id)] : []),
      ]
      if (changes.variant) {
        const was = outcome.current.variants.find((variant) => variant.id === changes.variant?.id)
        const now = outcome.next.variants.find((variant) => variant.id === changes.variant?.id)
        if (typeof was?.inventory === 'number' && typeof now?.inventory === 'number' && was.inventory !== now.inventory) {
          adjustments.push({ productId: plan.productId, variantId: now.id, delta: now.inventory - was.inventory })
        }
      }
      if (!logged.has(plan.productId)) {
        logged.add(plan.productId)
        await logHostActivity(hostId, actor, 'Updated product from an import', {
          type: 'content',
          id: plan.productId,
          name: outcome.next.name,
        })
      }
      await done(
        { row: row.index, outcome: 'updated', recordId: plan.productId },
        {
          row: row.index,
          recordId: plan.productId,
          action: 'updated',
          previous: undoKeys(before, touched),
          written: undoKeys(afterRecord, touched),
        },
      )
    } catch (error) {
      if (!(error instanceof RowRefusal)) throw error
      await done({ row: row.index, outcome: 'failed', reason: error.reason, message: error.message })
    }
  }

  // The stock history: what the import moved, as a correction (AGL-281).
  const log = hostRefOf(firestore, ctx).collection('inventoryAdjustments')
  for (const adjustment of adjustments) {
    await log.doc(Aglyn.createResourceUid()).set({ ...adjustment, reason: 'correction', source: 'import', atMs: Date.now() })
  }
  return { results, undo }
}

/*------------------------------------------
 * Undo
 *-----------------------------------------*/

/** Reverses one chunk: a created product deleted, an updated one's fields and variants put back. */
export async function revertProducts(
  ctx: TransferResourceContext,
  snapshot: TransferUndoSnapshot,
  decisions?: TransferRevertDecisions,
  firestore: Firestore = firestoreOf(),
): Promise<TransferRevertResult> {
  const products = productsOf(firestore, ctx)
  const names = await readCategoryNames(firestore, ctx)
  const categoryIdsOf = categoryIdsBy(names)
  const smart = await readSmartCollections(firestore, ctx)
  const { Timestamp, FieldValue } = firebaseAdmin.firestore
  return revertEntries(snapshot, decisions, {
    async current(entry) {
      const doc = await products.doc(entry.recordId).get()
      return doc.exists && isLive(doc.data()) ? productRecord(liftLegacyProduct(doc.data() as ProductDoc), names) : null
    },
    async remove(entry) {
      await products.doc(entry.recordId).delete()
    },
    async restore(entry, values) {
      const ref = products.doc(entry.recordId)
      await firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref)
        if (!doc.exists) return
        let next = liftLegacyProduct(doc.data() as ProductDoc)
        const productValues: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(values)) {
          if (!key.startsWith('$variant:')) {
            productValues[key] = value
            continue
          }
          const variantId = key.slice('$variant:'.length)
          if (value === null) next = { ...next, variants: next.variants.filter((variant) => variant.id !== variantId) }
          else next = applyProductRow(next, { variant: { id: variantId, isNew: false, values: value as Record<string, unknown> } }, categoryIdsOf)
        }
        next = applyProductRow(next, { product: productValues }, categoryIdsOf)
        const patch: Record<string, unknown> = {}
        for (const key of PRODUCT_DOC_KEYS) {
          const value = (next as unknown as Record<string, unknown>)[key]
          patch[key] = value === undefined ? FieldValue.delete() : withoutUndefined(value)
        }
        tx.update(ref, {
          ...patch,
          ...withoutUndefined(derivedKeys(next, smart)),
          updatedAtMs: Date.now(),
          updatedAt: Timestamp.now(),
        })
      })
    },
  })
}
