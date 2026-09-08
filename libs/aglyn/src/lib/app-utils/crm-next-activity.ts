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

/**
 * NEXT ACTIVITY (AGL-2661): when the earliest open task against a record
 * is due, denormalized onto the record as `nextTaskAtMs`.
 *
 * The question a sales manager asks of a LIST — "which deals have nothing
 * scheduled?" — cannot be answered by a task query per row, so every
 * contact, company and deal carries the answer. This module is the pure
 * half: what the value IS given a record's open tasks, how a stored one is
 * read back, the view clause a list filters on, and the report figure. The
 * admin library's `recomputeCrmNextTaskAt` is the writer; the console's
 * route is its door for client-direct task writes.
 */

import type { CrmDeal, CrmTask, CrmViewFilterClause } from './crm'

/** The field on a contact, a company and a deal — the one name every list reads. */
export const CRM_NEXT_ACTIVITY_FIELD = 'nextTaskAtMs'

/**
 * The records one task can be filed against — the ids a recompute reads
 * off a task, and the three collections it writes to.
 */
export interface CrmNextActivityLink {
  contactId?: string
  companyId?: string
  dealId?: string
}

/** How the collections are keyed on a task, in the order a recompute walks them. */
export const CRM_NEXT_ACTIVITY_LINK_FIELDS = ['contactId', 'companyId', 'dealId'] as const

export type CrmNextActivityLinkField = (typeof CRM_NEXT_ACTIVITY_LINK_FIELDS)[number]

/**
 * When the earliest OPEN task in the list is due, or `null`.
 *
 * Only an open task with a finite due time counts: a done task is history,
 * and an open one with no date is a to-do with no "next" about it — the
 * record's next activity is unknown rather than immediate, and `null`
 * says so. A pre-change writer never produced a time outside the finite
 * range, but a stored `dueAtMs` is trusted no further than that.
 */
export function nextTaskAtMsOf(
  tasks: readonly Pick<CrmTask, 'status' | 'dueAtMs'>[],
): number | null {
  let earliest: number | null = null
  for (const task of tasks) {
    if (task.status !== 'open') continue
    const due = task.dueAtMs
    if (typeof due !== 'number' || !Number.isFinite(due)) continue
    if (earliest === null || due < earliest) earliest = due
  }
  return earliest
}

/**
 * A stored `nextTaskAtMs`, read back: a finite positive number, else
 * `null`. Absent — a record written before the field existed — reads as
 * `null` too, because to every reader "not yet computed" and "nothing
 * scheduled" draw the same dash; the Fields section's recompute is what
 * closes the gap for a filter that asks the store rather than the row.
 */
export function readNextTaskAtMs(
  record: { nextTaskAtMs?: unknown } | null | undefined,
): number | null {
  const value = record?.nextTaskAtMs
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Whether nothing is scheduled against the record — the "stuck" test. */
export function hasNoNextActivity(
  record: { nextTaskAtMs?: unknown } | null | undefined,
): boolean {
  return readNextTaskAtMs(record) === null
}

/** The links one task carries, with the blanks left out. */
export function nextActivityLinksOfTask(
  task: Partial<Pick<CrmTask, CrmNextActivityLinkField>> | null | undefined,
): CrmNextActivityLink {
  const link: CrmNextActivityLink = {}
  for (const field of CRM_NEXT_ACTIVITY_LINK_FIELDS) {
    const id = String(task?.[field] ?? '').trim()
    if (id) link[field] = id
  }
  return link
}

/**
 * Several links as one per record, so a bulk action over forty tasks on
 * one deal recomputes that deal once. Order is first-seen.
 */
export function mergeNextActivityLinks(
  links: readonly (CrmNextActivityLink | null | undefined)[],
): Array<{ field: CrmNextActivityLinkField; id: string }> {
  const seen = new Set<string>()
  const merged: Array<{ field: CrmNextActivityLinkField; id: string }> = []
  for (const link of links) {
    for (const field of CRM_NEXT_ACTIVITY_LINK_FIELDS) {
      const id = String(link?.[field] ?? '').trim()
      if (!id) continue
      const key = `${field}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ field, id })
    }
  }
  return merged
}

/**
 * The saved-view clause "No next activity" is stored as — one clause,
 * spelled once, so the toggle a list draws and the matcher it runs agree
 * on the name. `isEmpty` is honest here: a recompute writes `null` for a
 * record with nothing scheduled, and a record never written reads blank
 * too (see `readNextTaskAtMs`).
 */
export const CRM_NO_NEXT_ACTIVITY_CLAUSE: Readonly<CrmViewFilterClause> = Object.freeze({
  field: CRM_NEXT_ACTIVITY_FIELD,
  op: 'isEmpty',
  value: '',
})

export function isNoNextActivityClause(clause: Pick<CrmViewFilterClause, 'field' | 'op'>): boolean {
  return clause.field === CRM_NEXT_ACTIVITY_FIELD && clause.op === 'isEmpty'
}

/** A view's filters with the clause switched on or off, the rest untouched. */
export function withNoNextActivity(
  filters: readonly CrmViewFilterClause[],
  on: boolean,
): CrmViewFilterClause[] {
  const rest = filters.filter((clause) => !isNoNextActivityClause(clause))
  return on ? [...rest, { ...CRM_NO_NEXT_ACTIVITY_CLAUSE }] : rest
}

/**
 * The rows a "No next activity" clause keeps: every one when the view does
 * not carry it, else those with nothing scheduled. What a list that
 * filters through a query — companies, deals — runs over the page it
 * loaded, the way the contacts list runs its window-only clauses.
 */
export function filterByNextActivity<T extends { nextTaskAtMs?: unknown }>(
  rows: readonly T[],
  filters: readonly CrmViewFilterClause[],
): T[] {
  return filters.some(isNoNextActivityClause) ? rows.filter(hasNoNextActivity) : [...rows]
}

/**
 * The report figure: how many OPEN deals have nothing scheduled, and which
 * (AGL-2661). A won deal needs no next step and a lost one has none, so
 * only open deals are stuck; the caller hands in the window it already
 * reads for the pipeline card, so this costs no read of its own.
 */
export function stuckDeals<T extends Pick<CrmDeal, 'status' | 'nextTaskAtMs'>>(
  deals: readonly T[],
): { count: number; deals: T[] } {
  const stuck = deals.filter((deal) => deal.status === 'open' && hasNoNextActivity(deal))
  return { count: stuck.length, deals: stuck }
}
