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

import { CRM_COLLECTIONS, type CrmTask } from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  collection,
  limit,
  orderBy,
  query,
  type QueryConstraint,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  CRM_TASK_VIEW_LIMIT,
  type CrmTaskView,
  crmTaskViewPlan,
  orderTaskRows,
} from '../model/task-views'
import { crmVisibleToClause, useCrmScope } from './use-crm-scope'

/** A task as the console lists it: the document plus its id. */
export type CrmTaskRow = CrmTask & { $id: string }

/**
 * The reader's clock, refreshed once a minute (AGL-2599).
 *
 * "Overdue" and "today" are computed at read time against this value, so a
 * tab left open across midnight repaints yesterday's work red without a
 * reload. A minute is coarse enough that the re-render is invisible and fine
 * enough that a task due at 9:00 does not read as upcoming at 9:05.
 */
export function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return nowMs
}

export interface CrmTaskListResult {
  tasks: CrmTaskRow[]
  status: 'loading' | 'success' | 'error'
  /** The rows are unconfirmed by the server — what a guarded write reads. */
  fromCache: boolean
  /** The window filled up; there are tasks this view is not showing. */
  truncated: boolean
  scope: readonly [string, string] | null
  orgId: string | null | undefined
  /** The reader's tokens, or `null` at the organization level — no clause (AGL-2630). */
  readTokens: readonly string[] | null
}

/**
 * One view of the tasks section as a live, bounded listener.
 *
 * The plan comes from `crmTaskViewPlan`, so the hook holds no opinion about
 * what "today" means; it translates a plan into constraints in the order the
 * `crmTasks` indexes are declared and caps the window. "My tasks" opens no
 * listener at all until the reader's uid is known — a query for
 * `assigneeUid == ''` would be a real read that could only answer nothing.
 */
export function useCrmTaskList(options: {
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Record<string, unknown> | null
  view: CrmTaskView
  uid: string | null | undefined
  nowMs: number
}): CrmTaskListResult {
  const { hostId, org, view, uid, nowMs } = options
  const firestore = useFirestore()
  // The org root and the reader's tokens from the one scope hook (AGL-2614)
  // — the same expression the contacts list runs, so a task listed beside a
  // contact is scoped by exactly the predicate that admitted the contact.
  const { scope, orgId, visibleTo: readTokens } = useCrmScope({ hostId, org })
  const plan = useMemo(
    () => crmTaskViewPlan(view, { nowMs, uid }),
    [view, nowMs, uid],
  )
  const { data, status, fromCache } = useFirestoreCollection<CrmTaskRow>(
    () => {
      if (!scope) return null
      if (plan.assigneeUid !== undefined && !plan.assigneeUid) return null
      const constraints: QueryConstraint[] = [
        ...crmVisibleToClause(readTokens),
        where('status', '==', plan.status),
      ]
      if (plan.assigneeUid) {
        constraints.push(where('assigneeUid', '==', plan.assigneeUid))
      }
      if (plan.dueFrom !== undefined) {
        constraints.push(where('dueAtMs', '>=', plan.dueFrom))
      }
      if (plan.dueBefore !== undefined) {
        constraints.push(where('dueAtMs', '<', plan.dueBefore))
      }
      return query(
        collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks),
        ...constraints,
        orderBy('dueAtMs', plan.direction),
        limit(CRM_TASK_VIEW_LIMIT),
      )
    },
    [
      firestore,
      scope,
      readTokens,
      plan.status,
      plan.assigneeUid,
      plan.dueFrom,
      plan.dueBefore,
      plan.direction,
    ],
    { idField: '$id' },
  )
  const tasks = useMemo(() => orderTaskRows(data ?? []), [data])
  return {
    tasks,
    status,
    fromCache,
    truncated: (data?.length ?? 0) >= CRM_TASK_VIEW_LIMIT,
    scope,
    orgId,
    readTokens,
  }
}

/**
 * How many of one record's tasks a card reads. A person with more than fifty
 * open tasks about one contact has a different problem than a short list.
 */
export const CRM_RECORD_TASK_LIMIT = 50

/** Which record a task list is FOR — exactly one of the three. */
export interface CrmRecordRef {
  contactId?: string
  companyId?: string
  dealId?: string
}

/**
 * The tasks that hang off one contact, company or deal, open and done
 * together, soonest due first.
 *
 * Rides the per-record indexes — `(visibleTo, contactId, dueAtMs)` and its
 * two siblings — with no status clause, because the card shows the open ones
 * and counts the rest, and two listeners for one short list is one too many.
 */
export function useCrmRecordTasks(options: {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Record<string, unknown> | null
  record: CrmRecordRef
}): CrmTaskListResult {
  const { hostId, org, record } = options
  const firestore = useFirestore()
  const { scope, orgId, visibleTo: readTokens } = useCrmScope({ hostId, org })
  const field = record.contactId
    ? 'contactId'
    : record.companyId
      ? 'companyId'
      : record.dealId
        ? 'dealId'
        : null
  const id = field ? record[field] : undefined
  const { data, status, fromCache } = useFirestoreCollection<CrmTaskRow>(
    () => {
      if (!scope || !field || !id) return null
      return query(
        collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.tasks),
        ...crmVisibleToClause(readTokens),
        where(field, '==', id),
        orderBy('dueAtMs', 'asc'),
        limit(CRM_RECORD_TASK_LIMIT),
      )
    },
    [firestore, scope, readTokens, field, id],
    { idField: '$id' },
  )
  const tasks = useMemo(() => orderTaskRows(data ?? []), [data])
  return {
    tasks,
    status,
    fromCache,
    truncated: (data?.length ?? 0) >= CRM_RECORD_TASK_LIMIT,
    scope,
    orgId,
    readTokens,
  }
}
