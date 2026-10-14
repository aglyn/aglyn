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

import type { AdminAuditKind } from '@aglyn/aglyn/app-utils/admin-audit-index'
import type { ListQueryFilter } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { auditAfterSummary, resolveAuditNames } from './audit-names'
import { ADMIN_AUDIT_COLLECTION } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  USER_AUDIT_LIST_QUERY,
  type UserAuditRow,
  userAuditKindBase,
} from '../admin-audit-list-query'
// From the leaf: `./list-filter` re-exports it beside a barrel import that
// reaches the render cache, which a spec of this module would then load.
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import {
  planStaffListQuery,
  type StaffListQueryPage,
  type StaffListQueryRequest,
} from './staff-list-query'

/*
 * WHAT WAS DONE BY OR TO ONE ACCOUNT, ONE PAGE AT A TIME (AGL-3321).
 *
 * An entry is about an account four different ways, and each is its own
 * field, so each is its own query ("half"):
 *
 *   actorUid == uid                 the account did it
 *   target == users/{uid}           it was done to the account's record
 *   subjectUid == uid               it was about the account (a read of its
 *                                   mail targets the message, not the user)
 *   subjectAddressKey in [keys]     it was about an address the account
 *                                   holds, when no single uid could be named
 *
 * Every half carries `kind` (the two tables, changes and reads, page apart so
 * a burst of reads cannot push an impersonation off the first page) and the
 * same plan: every clause and the search word on each half's query, so a half
 * contributes only rows that match. The halves are merged by `at`, newest
 * first, an entry two halves both answer counted once, and the page's cursor
 * is the path of the last entry shown — a document every half can resume
 * after, since a snapshot cursor carries its `at` whichever half it came
 * from.
 *
 * Each half reads one past the page, so the union holds every entry the page
 * could need and "is there more" is an observation.
 */

/** Firestore's cap on `in` values; the address half is read in chunks of it. */
const IN_LIMIT = 30

/** The bases of the halves, for one account and one kind. */
export function userAuditHalves(options: {
  uid: string
  addressKeys: readonly string[]
  kind: AdminAuditKind
}): ListQueryFilter[][] {
  const { uid, addressKeys, kind } = options
  const kindBase = userAuditKindBase(kind)
  const halves: ListQueryFilter[][] = [
    [{ path: 'actorUid', op: '==', value: uid }, kindBase],
    [{ path: 'target', op: '==', value: `users/${uid}` }, kindBase],
    [{ path: 'subjectUid', op: '==', value: uid }, kindBase],
  ]
  for (let at = 0; at < addressKeys.length; at += IN_LIMIT) {
    halves.push([
      { path: 'subjectAddressKey', op: 'in', value: addressKeys.slice(at, at + IN_LIMIT) },
      kindBase,
    ])
  }
  return halves
}

const iso = (value: unknown): string | null =>
  (value as { toDate?: () => Date } | null)?.toDate?.()?.toISOString() ?? null

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** One stored entry as the account page's tables read it. */
export function userAuditRow(doc: FirebaseFirestore.QueryDocumentSnapshot): UserAuditRow {
  return {
    id: doc.id,
    actorUid: text(doc.get('actorUid')),
    action: text(doc.get('action')),
    actionGroup: text(doc.get('actionGroup')),
    target: text(doc.get('target')),
    subjectUid: text(doc.get('subjectUid')),
    // WHY (AGL-1652). An `org.override` performed BY this account is in the
    // actor half, so dropping the reason here would hide it on one of the
    // three surfaces the act is read from.
    reason: text(doc.get('reason')),
    note: text(doc.get('note')),
    at: iso(doc.get('at')),
    /*
     * How many times one act was recorded, and when it last happened. A
     * repeat COLLAPSES onto its row rather than adding one, so without these
     * the table would under-report the access it merged. Absent on rows
     * written before the writer carried them, which read as one occurrence.
     */
    repeatCount: Number(doc.get('repeatCount')) || 1,
    lastAt: iso(doc.get('lastAt')),
    kind: doc.get('kind') === 'access' ? 'access' : 'change',
    after: auditAfterSummary(doc.get('after')),
  }
}

/** Each row with the names of what it mentions, for the shared describer. */
export async function withAuditNames<Row extends UserAuditRow>(
  firestore: FirebaseFirestore.Firestore,
  rows: Row[],
): Promise<Row[]> {
  const names = await resolveAuditNames(firestore, rows)
  const pick = (table: Record<string, unknown> | undefined, ids: Array<string | null | undefined>) =>
    Object.fromEntries(
      ids.flatMap((id) => (id && table?.[id] ? [[id, table[id] as string]] : [])),
    )
  return rows.map((row) => {
    const segments = String(row.target ?? '').split('/')
    const after = (collection: string) => {
      const at = segments.indexOf(collection)
      return at >= 0 ? segments[at + 1] : undefined
    }
    return {
      ...row,
      names: {
        orgs: pick(names.orgs as Record<string, unknown>, [after('orgs')]),
        hosts: pick(names.hosts as Record<string, unknown>, [after('hosts'), row.after?.hostId]),
        users: pick(names.users as Record<string, unknown>, [after('users'), row.subjectUid, row.actorUid]),
      },
    }
  })
}

/** Newest first, and among equal instants the order Firestore keeps: id, descending. */
const newestFirst = (
  a: FirebaseFirestore.QueryDocumentSnapshot,
  b: FirebaseFirestore.QueryDocumentSnapshot,
): number => {
  const at = (doc: FirebaseFirestore.QueryDocumentSnapshot) =>
    (doc.get('at') as { toMillis?: () => number } | null)?.toMillis?.() ?? 0
  const byTime = at(b) - at(a)
  if (byTime !== 0) return byTime
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** One page of one account's changes or reads, every clause on every half. */
export async function readUserAuditPage(options: {
  firestore: FirebaseFirestore.Firestore
  uid: string
  addressKeys: readonly string[]
  kind: AdminAuditKind
  request: StaffListQueryRequest
}): Promise<StaffListQueryPage<UserAuditRow>> {
  const { firestore, request } = options
  const halves = userAuditHalves(options)
  const plans = halves.map((base) => planStaffListQuery(USER_AUDIT_LIST_QUERY, request, base))
  const after = request.cursor ? await firestore.doc(request.cursor).get() : null
  const pages = await Promise.all(
    plans.map(async (plan) => {
      let query = applyListQuery(firestore.collection(ADMIN_AUDIT_COLLECTION), plan)
      if (after?.exists) query = query.startAfter(after)
      return (await query.limit(request.pageSize + 1).get()).docs
    }),
  )
  const seen = new Set<string>()
  const merged = pages
    .flat()
    .sort(newestFirst)
    .filter((doc) => {
      if (seen.has(doc.id)) return false
      seen.add(doc.id)
      return true
    })
  const shown = merged.slice(0, request.pageSize)
  const hasMore = merged.length > request.pageSize
  // Every half is planned from the same clauses over bases of one shape, so
  // they refuse the same things; the first says it for all of them.
  const [first] = plans
  return {
    rows: await withAuditNames(firestore, shown.map(userAuditRow)),
    nextCursor: hasMore ? (shown[shown.length - 1]?.ref.path ?? null) : null,
    hasMore,
    refused: first?.refused ?? [],
    notices: first?.notices ?? [],
  }
}
