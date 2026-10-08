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

import {
  EMAIL_DELIVERIES_COLLECTION,
  EMAIL_DELIVERY_MESSAGES_COLLECTION,
  type EmailDeliveryRecord,
  deliveryRecordFrom,
} from '@aglyn/tenant-data-admin/server/email-delivery-log'
import { emailSuppressionKey } from '@aglyn/tenant-data-admin/server/email-suppression'
// From the leaf: `./list-filter` re-exports it beside a barrel import that
// reaches the render cache, which a spec of this module would then load.
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { EMAIL_HISTORY_QUERY, type EmailHistoryCursor } from '../email-history-list-query'
import {
  planStaffListQuery,
  type StaffListQueryPage,
  type StaffListQueryRequest,
} from './staff-list-query'

/*
 * ONE PAGE OF WHAT WE SENT ONE PERSON (AGL-3321).
 *
 * The delivery log files each message under the address it went to
 * (`emailDeliveries/{sha256(address)}/messages`), and a person can hold
 * several addresses — a primary, a provider's, the ones they moved off. So
 * the table is one query per address, each carrying the same plan (every
 * clause and the search word), merged newest first.
 *
 * The cursor is one position per address — the id of the last message shown
 * from it — because a message's snapshot can only resume the collection it
 * lives in. Each address reads one past the page, so the union holds every
 * message the page could need, and "is there more" is an observation.
 */

/** One message as the account page's table reads it, keyed across addresses. */
export interface UserEmailHistoryRow extends EmailDeliveryRecord {
  /** `{addressKey}/{messageId}`: unique across the account's addresses. */
  $id: string
}

/** The cursor as the wire carries it, or an empty map for an unreadable one. */
export function readEmailHistoryCursor(raw: string | null): EmailHistoryCursor {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const cursor: EmailHistoryCursor = {}
    for (const [key, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === 'string' && id) cursor[key] = id
    }
    return cursor
  } catch {
    return {}
  }
}

/** Firestore's order across value types: null, booleans, numbers, then text. */
const typeRank = (value: unknown): number =>
  value === null || value === undefined
    ? 0
    : typeof value === 'boolean'
      ? 1
      : typeof value === 'number'
        ? 2
        : 3

/** Two stored values in Firestore's ascending order. */
function compareStored(a: unknown, b: unknown): number {
  const rank = typeRank(a) - typeRank(b)
  if (rank !== 0) return rank
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const left = String(a ?? '')
  const right = String(b ?? '')
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The merge's order: the plan's own (AGL-3680), so the addresses' pages
 * interleave exactly as one query over all of them would — by the ordered
 * field, then by document id in the same direction, which is each query's
 * own tie order.
 */
const inPlanOrder =
  (order: { path: string; direction: 'asc' | 'desc' }) =>
  (a: FirebaseFirestore.QueryDocumentSnapshot, b: FirebaseFirestore.QueryDocumentSnapshot): number => {
    const sign = order.direction === 'desc' ? -1 : 1
    return (
      sign * compareStored(a.get(order.path), b.get(order.path)) ||
      sign * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )
  }

export async function readUserEmailHistoryPage(options: {
  firestore: FirebaseFirestore.Firestore
  addresses: readonly string[]
  request: StaffListQueryRequest
}): Promise<StaffListQueryPage<UserEmailHistoryRow>> {
  const { firestore, request } = options
  const plan = planStaffListQuery(EMAIL_HISTORY_QUERY, request)
  const cursor = readEmailHistoryCursor(request.cursor)
  const keys = [
    ...new Set(
      options.addresses
        .map((address) => emailSuppressionKey(address))
        .filter((key): key is string => Boolean(key)),
    ),
  ]
  const pages = await Promise.all(
    keys.map(async (key) => {
      const messages = firestore
        .collection(EMAIL_DELIVERIES_COLLECTION)
        .doc(key)
        .collection(EMAIL_DELIVERY_MESSAGES_COLLECTION)
      let query = applyListQuery(messages, plan)
      if (cursor[key]) {
        const after = await messages.doc(cursor[key]).get()
        if (after.exists) query = query.startAfter(after)
      }
      const docs = (await query.limit(request.pageSize + 1).get()).docs
      return docs.map((doc) => ({ key, doc }))
    }),
  )
  const order = inPlanOrder(plan.orderBy)
  const merged = pages.flat().sort((a, b) => order(a.doc, b.doc))
  const shown = merged.slice(0, request.pageSize)
  const hasMore = merged.length > request.pageSize
  const next: EmailHistoryCursor = { ...cursor }
  for (const { key, doc } of shown) next[key] = doc.id
  return {
    rows: shown.map(({ key, doc }) => ({ ...deliveryRecordFrom(doc), $id: `${key}/${doc.id}` })),
    nextCursor: hasMore ? JSON.stringify(next) : null,
    hasMore,
    refused: plan.refused,
    notices: plan.notices,
  }
}
