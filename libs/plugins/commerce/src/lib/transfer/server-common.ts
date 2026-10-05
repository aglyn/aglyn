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

import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  planTransferUndo,
  type TransferUndoEntry,
  type TransferUndoSnapshot,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferReadOptions,
  TransferReadPage,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { readCommerceListFilter } from './list-filter'

/*
 * WHAT EVERY COMMERCE RESOURCE'S SERVER HALF SHARES (AGL-3531): the site a
 * job names, whether the reader reaches it, a list's query read page by page
 * from a cursor, and the undo loop.
 */

export type Firestore = FirebaseFirestore.Firestore
type Query = FirebaseFirestore.Query
type Snapshot = FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot

export const firestoreOf = (): Firestore => firebaseAdmin.app().firestore()

/** The site a host resource's job names; every commerce resource is a site's. */
export function hostRefOf(firestore: Firestore, ctx: TransferResourceContext): FirebaseFirestore.DocumentReference {
  if (!ctx.hostId) throw new Error(`${ctx.resource} is a site's records; name the site.`)
  return firestore.collection('hosts').doc(ctx.hostId)
}

/**
 * Whether the reader reaches the site. A collaborator scoped to some sites
 * reads only through their tokens (`scopeTokens`): a site's commerce records
 * carry no `visibleTo` of their own, so the site's token is the whole test.
 */
export function readerSeesHost(ctx: TransferResourceContext, options: TransferReadOptions | undefined): boolean {
  if (!options?.scopeTokens) return true
  return Boolean(ctx.hostId) && options.scopeTokens.includes(hostScopeToken(ctx.hostId as string))
}

/** Plain data for Firestore: `undefined` dropped at every depth. */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => withoutUndefined(item)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) out[key] = withoutUndefined(item)
    }
    return out as T
  }
  return value
}

/** A list's query, as one read of a page. */
export interface CommerceListSource {
  collection: FirebaseFirestore.CollectionReference
  declaration: ListQueryDeclaration
  /** Predicates every read applies — the list's scope (a product never deleted). */
  base?: Array<{ path: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }>
  /** The order an export of everything reads in; the document id when absent. */
  order?: { path: string; direction: 'asc' | 'desc' }
}

const idPath = () => firebaseAdmin.firestore.FieldPath.documentId()

const fieldOf = (path: string) => (path === '__name__' ? idPath() : path)

/** The query an export's options read: the list's filter, or everything in the list's scope. */
function sourceQuery(
  source: CommerceListSource,
  options: TransferReadOptions | undefined,
): { query: Query; order: { path: string; direction: 'asc' | 'desc' } } {
  let query: Query = source.collection
  const basePaths = (source.base ?? []).map((entry) => entry.path)
  let order = source.order ?? { path: '__name__', direction: 'asc' as const }
  if (options?.filter) {
    const filter = readCommerceListFilter(options.filter, source.declaration, basePaths)
    const filtered = new Set(filter.filters.map((entry) => entry.path))
    for (const entry of source.base ?? []) {
      if (!filtered.has(entry.path)) query = query.where(entry.path, entry.op, entry.value)
    }
    for (const entry of filter.filters) query = query.where(fieldOf(entry.path), entry.op, entry.value)
    order = filter.orderBy
  } else {
    for (const entry of source.base ?? []) query = query.where(entry.path, entry.op, entry.value)
  }
  query =
    order.path === '__name__'
      ? query.orderBy(idPath(), order.direction)
      : query.orderBy(order.path, order.direction).orderBy(idPath(), order.direction)
  return { query, order }
}

/**
 * One page of a list's documents for an export: the selection by id, the
 * list's filter, or everything, from `cursor`. The cursor is the last row's
 * order value and id, so the next page starts after it whatever the order.
 */
export async function readSourcePage(
  firestore: Firestore,
  source: CommerceListSource,
  cursor: string | null,
  options: TransferReadOptions | undefined,
  pageSize: number,
): Promise<{ docs: Snapshot[]; next: string | null }> {
  if (options?.ids) {
    const offset = cursor ? Number(cursor) : 0
    const ids = options.ids.slice(offset, offset + pageSize)
    if (!ids.length) return { docs: [], next: null }
    const refs = ids.map((id) => source.collection.doc(id))
    const snapshots = await firestore.getAll(...refs)
    const end = offset + ids.length
    return { docs: snapshots.filter((entry) => entry.exists), next: end < options.ids.length ? String(end) : null }
  }
  const { query, order } = sourceQuery(source, options)
  const after = cursor ? (JSON.parse(cursor) as unknown[]) : null
  const page = await (after ? query.startAfter(...after) : query).limit(pageSize).get()
  const last = page.docs[page.docs.length - 1]
  const next =
    last && page.docs.length === pageSize
      ? JSON.stringify(order.path === '__name__' ? [last.id] : [last.get(order.path) ?? null, last.id])
      : null
  return { docs: page.docs, next }
}

/** Every document an export's options read, page by page, handed to `each` — for a count. */
export async function eachSourceDoc(
  firestore: Firestore,
  source: CommerceListSource,
  options: TransferReadOptions | undefined,
  each: (doc: Snapshot) => void,
): Promise<void> {
  let cursor: string | null = null
  do {
    const page = await readSourcePage(firestore, source, cursor, options, 500)
    for (const doc of page.docs) each(doc)
    cursor = page.next
  } while (cursor)
}

/** How many documents an export's options read, by the store's own count where it can. */
export async function countSource(
  firestore: Firestore,
  source: CommerceListSource,
  options: TransferReadOptions | undefined,
  live: (doc: Snapshot) => boolean = () => true,
): Promise<number> {
  if (options?.ids) {
    let total = 0
    for (let offset = 0; offset < options.ids.length; offset += 500) {
      const refs = options.ids.slice(offset, offset + 500).map((id) => source.collection.doc(id))
      total += (await firestore.getAll(...refs)).filter((entry) => entry.exists && live(entry)).length
    }
    return total
  }
  const { query } = sourceQuery(source, options)
  return Number((await query.count().get()).data().count) || 0
}

/** An empty page, for a reader who does not reach the site. */
export const NOTHING: TransferReadPage = { rows: [], next: null }

/**
 * Reverses one chunk's writes, newest first: each entry planned against the
 * record as it is now (`planTransferUndo`); a record edited since is a
 * conflict, carried out only when the person's decision says `revert`.
 */
export async function revertEntries(
  snapshot: TransferUndoSnapshot,
  decisions: TransferRevertDecisions | undefined,
  hooks: {
    current(entry: TransferUndoEntry): Promise<Readonly<Record<string, unknown>> | null>
    restore(entry: TransferUndoEntry, values: Record<string, unknown>): Promise<void>
    remove(entry: TransferUndoEntry): Promise<void>
  },
): Promise<TransferRevertResult> {
  const done: TransferUndoStep[] = []
  const conflicts: TransferUndoStep[] = []
  for (const entry of [...snapshot.entries].reverse()) {
    const step = planTransferUndo(entry, await hooks.current(entry))
    if (step.action === 'conflict') {
      if (decisions?.[entry.recordId] !== 'revert') {
        conflicts.push(step)
        continue
      }
      if (entry.action === 'created') await hooks.remove(entry)
      else await hooks.restore(entry, step.values)
      done.push(step)
      continue
    }
    if (step.action === 'delete') await hooks.remove(entry)
    if (step.action === 'restore') await hooks.restore(entry, step.values)
    done.push(step)
  }
  return { done, conflicts }
}

/** Milliseconds a row's write is given; past this the chunk stops at a row boundary. */
export const ROW_BUDGET_MS = 1_500
