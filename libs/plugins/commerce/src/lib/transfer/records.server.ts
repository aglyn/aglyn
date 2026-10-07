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
  type PlannedTransferRow,
  type TransferChunk,
  type TransferPlan,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoSnapshot,
} from '@aglyn/aglyn/data-transfer'
import type {
  PluginTransferResource,
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { ORDER_LIST_QUERY } from '../constants/orders-list-query'
import type { ProductWeights } from '../model/order-shipping-export'
import {
  CATEGORY_MATCH_KEYS,
  COUPON_MATCH_KEYS,
  DISCOUNT_KIND_PICKLIST,
  DISCOUNT_KIND_SPEC,
  DISCOUNT_MATCH_KEYS,
  categoryRecord,
  categoryWrite,
  couponRecord,
  couponWrite,
  discountRecord,
  discountWrite,
  orderRecord,
  planWithCreateRequired,
  promotionCode,
  rowChanges,
  type CategoryIndex,
  type StoredCategory,
  type StoredCoupon,
  type StoredOrder,
} from './records-transfer'
import {
  NOTHING,
  ROW_BUDGET_MS,
  countSource,
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
 * THE SERVER HALVES OF ORDERS, DISCOUNTS, COUPONS AND CATEGORIES
 * (AGL-3531), and the reads gift cards share (`gift-cards.server.ts`,
 * AGL-3551). Their records are plain documents under the site,
 * so one shape serves each: an export reads the list's query (orders) or the
 * whole collection page by page; a lookup finds documents by the resource's
 * keys; an import writes the same document the console's card writes, and
 * undo puts back what it held or deletes what the import made.
 *
 * Orders declare `records` too — the kind a file of rows is — but refuse
 * every row they are handed: their fields are all read-only
 * and the invariant below fails a row that would write, so a dry run says
 * why rather than an apply discovering it.
 */

export type Doc = Record<string, unknown>
type Collection = FirebaseFirestore.CollectionReference

const IN_MAX = 30

export interface RecordsSpec {
  collection(firestore: Firestore, ctx: TransferResourceContext): Collection
  /** The list's query an export may carry a filter of. */
  source?: Omit<CommerceListSource, 'collection'>
  /** A document as a file names it. */
  record(id: string, data: Doc, extra: RecordsExtra): Record<string, unknown>
  /** The values a document is found by, per match key. */
  matchValues(id: string, data: Doc): Record<string, unknown>
  /**
   * What a lookup or export reads once per call, besides the documents. An
   * export names the fields it writes, so a read only some fields need is
   * skipped when none of them is asked for.
   */
  extra?(
    firestore: Firestore,
    ctx: TransferResourceContext,
    docs: readonly FirebaseFirestore.DocumentSnapshot[],
    fieldIds?: readonly string[],
  ): Promise<RecordsExtra>
  /** Finds documents by a key's values (at most 30); the id key is read directly. */
  find?: Record<string, (collection: Collection, values: string[]) => FirebaseFirestore.Query>
}

export type RecordsExtra = {
  productNames?: Record<string, string>
  /** Each product's variant weights in grams, for the shipping columns (AGL-3613). */
  weights?: ProductWeights
  categories?: CategoryIndex
}

const noExtra = async (): Promise<RecordsExtra> => ({})

function sourceFor(spec: RecordsSpec, firestore: Firestore, ctx: TransferResourceContext): CommerceListSource {
  return {
    collection: spec.collection(firestore, ctx),
    declaration: spec.source?.declaration ?? { fields: [], sorts: [] },
    ...(spec.source?.order ? { order: spec.source.order } : {}),
  }
}

function refuseFilterWithout(spec: RecordsSpec, options?: TransferReadOptions): void {
  if (options?.filter && !spec.source) throw new Error('This list exports everything, or the records you select.')
}

async function readPage(
  spec: RecordsSpec,
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options: TransferReadOptions | undefined,
  firestore: Firestore,
): Promise<TransferReadPage> {
  if (!readerSeesHost(ctx, options)) return NOTHING
  refuseFilterWithout(spec, options)
  const pageSize = Math.max(1, Math.min(500, options?.pageSize ?? 500))
  const page = await readSourcePage(firestore, sourceFor(spec, firestore, ctx), cursor, options, pageSize)
  const extra = await (spec.extra ?? noExtra)(firestore, ctx, page.docs, fieldIds)
  const rows = page.docs.map((doc) => {
    const record = spec.record(doc.id, (doc.data() ?? {}) as Doc, extra)
    return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, record[fieldId] ?? null]))
  })
  return { rows, next: page.next }
}

async function count(
  spec: RecordsSpec,
  ctx: TransferResourceContext,
  options: TransferReadOptions,
  firestore: Firestore,
): Promise<number> {
  if (!readerSeesHost(ctx, options)) return 0
  refuseFilterWithout(spec, options)
  return countSource(firestore, sourceFor(spec, firestore, ctx), options)
}

async function lookup(
  spec: RecordsSpec,
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
  firestore: Firestore,
): Promise<TransferLookupResult> {
  const collection = spec.collection(firestore, ctx)
  const found = new Map<string, FirebaseFirestore.DocumentSnapshot>()
  const keys: MatchKeySpec[] = []
  for (const request of requests) {
    keys.push({ fieldId: request.fieldId, normalizer: request.normalizer })
    for (let at = 0; at < request.values.length; at += IN_MAX) {
      const slice = request.values.slice(at, at + IN_MAX)
      if (request.fieldId === 'id') {
        for (const doc of await firestore.getAll(...slice.map((id) => collection.doc(id)))) {
          if (doc.exists) found.set(doc.id, doc)
        }
        continue
      }
      const query = spec.find?.[request.fieldId]
      if (!query) continue
      for (const doc of (await query(collection, slice).get()).docs) found.set(doc.id, doc)
    }
  }
  const docs = [...found.values()]
  const extra = docs.length ? await (spec.extra ?? noExtra)(firestore, ctx, docs) : {}
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const doc of docs) records.set(doc.id, spec.record(doc.id, (doc.data() ?? {}) as Doc, extra))
  const lookupMap = buildMatchLookup(
    docs.map((doc) => ({ id: doc.id, values: spec.matchValues(doc.id, (doc.data() ?? {}) as Doc) })),
    keys,
  )
  return { lookup: lookupMap, records }
}

/** The reading hooks every records resource shares: count, a page of an export, and the lookup. */
export function readableRecords(spec: RecordsSpec): Pick<PluginTransferResource, 'count' | 'readPage' | 'lookup'> {
  return {
    count: (ctx, options) => count(spec, ctx, options, firestoreOf()),
    readPage: (ctx, cursor, fieldIds, options) => readPage(spec, ctx, cursor, fieldIds, options, firestoreOf()),
    lookup: (ctx, requests) => lookup(spec, ctx, requests, firestoreOf()),
  }
}

/** The hooks an export-only resource answers with: read, find by id, and refuse every write. */
function exportOnly(spec: RecordsSpec, noun: string, why: string): PluginTransferResource {
  return {
    matchKeys: [{ fieldId: 'id', normalizer: 'aglynId' }],
    ...readableRecords(spec),
    invariants: [{ id: `${noun}-export-only`, label: why, check: () => why }],
    async apply(_ctx, chunk) {
      const results: TransferRowResult[] = chunk.rows.map((row) => ({
        row: row.index,
        outcome: 'failed',
        reason: 'refusedValue',
        message: why,
      }))
      return { results, undo: [] }
    },
    async revert() {
      return { done: [], conflicts: [] }
    },
  }
}

/*==========================================
 * ORDERS — exported only
 *=========================================*/

/**
 * The orders list's query, with the one predicate the list itself never
 * shows: `requiresShipping`, which the orders card's Export for shipping
 * asks (AGL-3613) and every creator stamps.
 */
const ORDER_EXPORT_QUERY: ListQueryDeclaration = {
  ...ORDER_LIST_QUERY,
  fields: [
    ...ORDER_LIST_QUERY.fields,
    { column: 'requiresShipping', kind: 'exact', path: 'requiresShipping', operators: ['equals'] },
  ],
}

const ORDERS: RecordsSpec = {
  collection: (firestore, ctx) => hostRefOf(firestore, ctx).collection('orders'),
  source: { declaration: ORDER_EXPORT_QUERY, order: { path: 'createdAtMs', direction: 'desc' } },
  record: (id, data, extra) => orderRecord(id, data as StoredOrder, extra.productNames, extra.weights),
  matchValues: (id) => ({ id }),
  /** A legacy flat row is named by its product, read for that page alone. */
  async extra(firestore, ctx, docs, fieldIds) {
    const ids = [
      ...new Set(
        docs
          .filter((doc) => !(doc.get('lineItems') as unknown[] | undefined)?.length && doc.get('productId'))
          .map((doc) => String(doc.get('productId'))),
      ),
    ]
    const productNames: Record<string, string> = {}
    const products = hostRefOf(firestore, ctx).collection('products')
    for (let at = 0; at < ids.length; at += 100) {
      for (const doc of await firestore.getAll(...ids.slice(at, at + 100).map((id) => products.doc(id)))) {
        if (doc.exists && doc.get('name')) productNames[doc.id] = String(doc.get('name'))
      }
    }
    // The page's products are read for their weights only when a weight
    // column is written (AGL-3613) — never for an ordinary orders export.
    const wantsWeight = (fieldIds ?? []).some((fieldId) => fieldId === 'weightOz' || fieldId === 'weightLb' || fieldId === 'weightUnit')
    return { productNames, ...(wantsWeight ? { weights: await productWeightsFor(firestore, ctx, docs) } : {}) }
  },
}

/**
 * The products a page of orders names, by variant weight in grams. One
 * `getAll` per hundred products.
 */
async function productWeightsFor(
  firestore: Firestore,
  ctx: TransferResourceContext,
  docs: readonly FirebaseFirestore.DocumentSnapshot[],
): Promise<ProductWeights> {
  const ids = [
    ...new Set(
      docs.flatMap((doc) =>
        ((doc.get('lineItems') as Array<{ productId?: unknown }> | undefined) ?? [])
          .map((line) => (typeof line?.productId === 'string' ? line.productId : ''))
          .filter((id) => id && !id.includes('/')),
      ),
    ),
  ]
  const weights: Record<string, Record<string, number>> = {}
  const products = hostRefOf(firestore, ctx).collection('products')
  for (let at = 0; at < ids.length; at += 100) {
    for (const doc of await firestore.getAll(...ids.slice(at, at + 100).map((id) => products.doc(id)))) {
      if (!doc.exists) continue
      const variants = (doc.get('variants') as Array<{ id?: string; weightGrams?: unknown }> | undefined) ?? []
      const byVariant: Record<string, number> = {}
      for (const [index, variant] of variants.entries()) {
        const grams = Number(variant?.weightGrams)
        if (!Number.isFinite(grams) || grams <= 0) continue
        if (variant?.id) byVariant[variant.id] = grams
        if (index === 0) byVariant[''] = grams
      }
      if (Object.keys(byVariant).length) weights[doc.id] = byVariant
    }
  }
  return weights
}

export const ordersTransfer: PluginTransferResource = exportOnly(
  ORDERS,
  'orders',
  'Orders are exported, never imported: an order is the record of a sale, written by checkout, the register or a paid draft.',
)


/*==========================================
 * IMPORTABLE RECORDS
 *=========================================*/

/** A row the apply refuses, with the sentence the results show. */
class RowRefusal extends Error {}

interface WritableSpec extends RecordsSpec {
  /** The fields a new record cannot be made without. */
  requiredToCreate: readonly string[]
  /** A new record's id: a fresh one, or what the row names (a coupon's code). */
  newId(row: PlannedTransferRow, changes: Readonly<Record<string, unknown>>): string
  /** The document a row's changes make, or the refusal. */
  write(
    id: string,
    current: Doc | null,
    changes: Readonly<Record<string, unknown>>,
    extra: RecordsExtra,
  ): { doc: Record<string, unknown> } | { problem: string }
  /** Stamps a create carries beyond its fields. */
  createStamps?(): Record<string, unknown>
  /** Values normalized before matching and planning (a code's case). */
  normalize?(values: Record<string, unknown>): Record<string, unknown>
  /** Called after a record is written, with what the next rows resolve against. */
  afterWrite?(id: string, doc: Doc, extra: RecordsExtra): void
}

function writable(spec: WritableSpec, matchKeys: readonly MatchKeySpec[]): PluginTransferResource {
  return {
    matchKeys,
    count: (ctx, options) => count(spec, ctx, options, firestoreOf()),
    readPage: (ctx, cursor, fieldIds, options) => readPage(spec, ctx, cursor, fieldIds, options, firestoreOf()),
    lookup: (ctx, requests) => lookup(spec, ctx, requests, firestoreOf()),
    plan(_ctx, input: BuildTransferPlanInput): TransferPlan {
      const rows = spec.normalize
        ? input.rows.map((row) => ({ ...row, values: spec.normalize?.({ ...row.values }) ?? row.values }))
        : input.rows
      return planWithCreateRequired({ ...input, rows }, spec.requiredToCreate)
    },
    apply: (ctx, chunk, writer) => applyRecords(spec, ctx, chunk, writer, firestoreOf()),
    revert: (ctx, snapshot, decisions) => revertRecords(spec, ctx, snapshot, decisions, firestoreOf()),
  }
}

/** Writes one chunk of planned rows: each a create or an update of one document. */
export async function applyRecords(
  spec: WritableSpec,
  ctx: TransferResourceContext,
  chunk: TransferChunk<PlannedTransferRow>,
  writer: TransferApplyWriter,
  firestore: Firestore,
): Promise<TransferApplyResult> {
  const collection = spec.collection(firestore, ctx)
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []
  const extra = await (spec.extra ?? noExtra)(firestore, ctx, [])
  for (const row of chunk.rows) {
    const earlier = await writer.alreadyApplied(row.index)
    if (earlier) {
      results.push(earlier)
      continue
    }
    if (writer.timeLeftMs() < ROW_BUDGET_MS) break
    const changes = rowChanges(row)
    const creating = row.verdict === 'create'
    const id = creating ? spec.newId(row, changes) : (row.recordId as string)
    const ref = collection.doc(id)
    try {
      const outcome = await firestore.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (creating && snapshot.exists) throw new RowRefusal(`"${id}" already exists; match it to update it instead.`)
        if (!creating && !snapshot.exists) throw new RowRefusal('The record was deleted after the dry run.')
        const current = snapshot.exists ? ((snapshot.data() ?? {}) as Doc) : null
        const made = spec.write(id, current, changes, extra)
        if ('problem' in made) throw new RowRefusal(made.problem)
        const doc = withoutUndefined({ ...made.doc, ...(creating ? (spec.createStamps?.() ?? {}) : {}) })
        if (creating) tx.create(ref, doc)
        else tx.set(ref, doc)
        return { current, doc }
      })
      spec.afterWrite?.(id, outcome.doc, extra)
      const after = spec.record(id, outcome.doc, extra)
      const before = outcome.current ? spec.record(id, outcome.current, extra) : null
      const touched = Object.keys(changes)
      const result: TransferRowResult = { row: row.index, outcome: creating ? 'created' : 'updated', recordId: id }
      const entry: TransferUndoEntry = creating
        ? { row: row.index, recordId: id, action: 'created', written: pickKeys(after, touched) }
        : {
            row: row.index,
            recordId: id,
            action: 'updated',
            previous: pickKeys(before ?? {}, touched),
            written: pickKeys(after, touched),
          }
      results.push(result)
      undo.push(entry)
      await writer.markApplied(result, entry)
    } catch (error) {
      if (!(error instanceof RowRefusal)) throw error
      const result: TransferRowResult = { row: row.index, outcome: 'failed', reason: 'refusedValue', message: error.message }
      results.push(result)
      await writer.markApplied(result)
    }
  }
  return { results, undo }
}

const pickKeys = (record: Readonly<Record<string, unknown>>, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, record[key] ?? null]))

/** Reverses one chunk: a created record deleted, an updated one's fields put back. */
export async function revertRecords(
  spec: WritableSpec,
  ctx: TransferResourceContext,
  snapshot: TransferUndoSnapshot,
  decisions: TransferRevertDecisions | undefined,
  firestore: Firestore,
): Promise<TransferRevertResult> {
  const collection = spec.collection(firestore, ctx)
  const extra = await (spec.extra ?? noExtra)(firestore, ctx, [])
  return revertEntries(snapshot, decisions, {
    async current(entry) {
      const doc = await collection.doc(entry.recordId).get()
      return doc.exists ? spec.record(doc.id, (doc.data() ?? {}) as Doc, extra) : null
    },
    async remove(entry) {
      await collection.doc(entry.recordId).delete()
    },
    async restore(entry, values) {
      const ref = collection.doc(entry.recordId)
      const doc = await ref.get()
      if (!doc.exists) return
      const made = spec.write(entry.recordId, (doc.data() ?? {}) as Doc, values, extra)
      // A value the record held before the import is put back as it was, even one a file could not set.
      if ('problem' in made) throw new Error(`Undo could not restore ${entry.recordId}: ${made.problem}`)
      await ref.set(withoutUndefined(made.doc))
    },
  })
}

/*------------------------------------------
 * Discounts
 *-----------------------------------------*/

const DISCOUNTS: WritableSpec = {
  collection: (firestore, ctx) => hostRefOf(firestore, ctx).collection('discounts'),
  record: (id, data) => discountRecord(id, data),
  matchValues: (id, data) => ({ id, code: data['code'] ?? null, name: data['name'] ?? null }),
  find: {
    code: (collection, values) => collection.where('code', 'in', values.map((value) => promotionCode(value))),
    name: (collection, values) => collection.where('name', 'in', values),
  },
  requiredToCreate: ['kind'],
  newId: () => Aglyn.createResourceUid(),
  write: (_id, current, changes) => discountWrite(current, changes),
  normalize(values) {
    if ('code' in values) values['code'] = promotionCode(values['code']) || null
    return values
  },
}

export const discountsTransfer: PluginTransferResource = {
  ...writable(DISCOUNTS, DISCOUNT_MATCH_KEYS),
  async picklists(_ctx, picklistIds) {
    return picklistIds.includes(DISCOUNT_KIND_PICKLIST)
      ? {
          [DISCOUNT_KIND_PICKLIST]: {
            spec: DISCOUNT_KIND_SPEC,
            set: {
              values: DISCOUNT_KIND_SPEC.standardValues.map((value) => ({ id: value.id, label: value.label, active: true })),
              defaultValueId: 'percent',
            },
          },
        }
      : {}
  },
}

/*------------------------------------------
 * Coupons
 *-----------------------------------------*/

const COUPONS: WritableSpec = {
  collection: (firestore, ctx) => hostRefOf(firestore, ctx).collection('coupons'),
  record: (id, data) => couponRecord(id, data as StoredCoupon),
  matchValues: (id) => ({ id, code: id }),
  // A coupon's code is its document id: a code is looked up by id.
  find: {
    code: (collection, values) =>
      collection.where(
        firebaseAdmin.firestore.FieldPath.documentId(),
        'in',
        values.map((value) => promotionCode(value)).filter(Boolean),
      ),
  },
  requiredToCreate: ['code', 'percentOff'],
  newId: (_row, changes) => {
    const code = promotionCode(changes['code'])
    if (!code) throw new RowRefusal('A coupon needs a code.')
    return code
  },
  write: (_id, current, changes) => couponWrite(current as StoredCoupon | null, changes),
  createStamps: () => ({ createdAt: firebaseAdmin.firestore.Timestamp.now() }),
  normalize(values) {
    if ('code' in values) values['code'] = promotionCode(values['code']) || null
    return values
  },
}

export const couponsTransfer: PluginTransferResource = writable(COUPONS, COUPON_MATCH_KEYS)

/*------------------------------------------
 * Categories
 *-----------------------------------------*/

/** Every category of the site, for parents and for naming them. */
async function readCategories(firestore: Firestore, ctx: TransferResourceContext): Promise<CategoryIndex> {
  const snapshot = await hostRefOf(firestore, ctx).collection('productCategories').limit(2000).get()
  return new Map(snapshot.docs.map((doc) => [doc.id, (doc.data() ?? {}) as StoredCategory]))
}

const CATEGORIES: WritableSpec = {
  collection: (firestore, ctx) => hostRefOf(firestore, ctx).collection('productCategories'),
  record(id, data, extra) {
    const slugs = new Map([...(extra.categories ?? new Map())].map(([key, category]) => [key, String(category.slug ?? key)]))
    return categoryRecord(id, data as StoredCategory, slugs)
  },
  matchValues: (id, data) => ({ id, slug: data['slug'] ?? null, name: data['name'] ?? null }),
  find: {
    slug: (collection, values) => collection.where('slug', 'in', values),
    name: (collection, values) => collection.where('name', 'in', values),
  },
  extra: async (firestore, ctx) => ({ categories: await readCategories(firestore, ctx) }),
  requiredToCreate: ['name'],
  newId: () => Aglyn.createResourceUid(),
  write: (id, current, changes, extra) =>
    categoryWrite(id, current as StoredCategory | null, changes, extra.categories ?? new Map()),
  // A category written earlier in the file is a parent a later row can name.
  afterWrite(id, doc, extra) {
    extra.categories?.set(id, doc as StoredCategory)
  },
}

export const categoriesTransfer: PluginTransferResource = writable(CATEGORIES, CATEGORY_MATCH_KEYS)
