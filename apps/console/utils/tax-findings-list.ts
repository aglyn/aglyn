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

import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type StaffCompleteListColumns,
  staffCompleteListSorts,
} from './staff-complete-list-sort'
import {
  taxReturnFindingGroups,
  type TaxReturnFindingRow,
  type TaxReturnPayload,
} from './tx-return-webfile'

/*
 * THE TAX-RETURN FINDINGS LIST, FILTERED WHERE IT IS COMPUTED (AGL-3321).
 *
 * An EXCEPTION to "every clause on a Firestore query", and why: no document
 * holds a finding. A row's findings — billed without automatic tax, no
 * readable address, a net that contradicts gross minus tax — are computed
 * by `/api/admin/tax-return` from the period's `platformRevenue` rows and the
 * filer's registration, and so is the jurisdiction a row was bucketed under.
 * There is nothing to put a `where` on.
 *
 * What the route does have is the COMPLETE period: it reads every row the
 * period holds, to sum the return, and says when a period holds more than
 * one read can take (`truncated`). So the Filters panel and the search are
 * answered there, over that complete read (`serveTaxFindings` in
 * `utils/server/tax-findings-list.ts`), and the card
 * is handed one page of the answer — never the rows to narrow itself. When
 * the read is NOT complete, every clause and the search are refused by
 * name, because a match over part of a period would answer "no such row"
 * for a row the read never reached.
 */

/** One flagged invoice, once, with every finding that lists it. */
export type TaxFindingListRow = TaxReturnFindingRow & {
  $id: string
  /** The ids of the finding groups this row appears under. */
  groups: string[]
}

/** Every field the findings grid's Filters panel offers. */
export const TAX_FINDING_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'invoiceId',
    kind: 'text',
    path: 'invoiceId',
    operators: ['contains', 'doesNotContain', 'equals', 'startsWith', 'endsWith'],
  },
  {
    // An array of finding ids, matched member by member.
    column: 'groups',
    kind: 'exact',
    path: 'groups',
    tokensPath: 'groups',
    verbatimTokens: true,
    operators: ['equals', 'doesNotEqual', 'isAnyOf'],
  },
  {
    column: 'jurisdiction',
    kind: 'exact',
    path: 'jurisdiction',
    operators: ['equals', 'doesNotEqual', 'isAnyOf'],
  },
  { column: 'paidAt', kind: 'date', path: 'paidAt', presence: 'nullable' },
]

export const TAX_FINDING_FILTER_HEADERS: Readonly<Record<string, string>> = {
  invoiceId: 'Invoice',
  groups: 'Finding',
  jurisdiction: 'Bucketed as',
  paidAt: 'Paid',
}

/** The fields the panel shows as a select. */
export const TAX_FINDING_SELECT_FIELDS: readonly string[] = ['groups', 'jurisdiction']

/** What the search box matches: the invoice, its org and its bucket. */
export const TAX_FINDING_SEARCH_PATHS: readonly string[] = ['invoiceId', 'orgId', 'jurisdiction']

/*
 * THE HEADER SORTS (AGL-3680, strategy 4s): every column, ordered by the
 * route over the period's complete read and then paged
 * (`utils/staff-complete-list-sort.ts`). A period the read cap cut short is
 * not sorted — an order over part of it would put rows first that are not —
 * and says so (`serveTaxFindings`). With none asked, blocking findings first.
 */
export const TAX_FINDING_SORT_COLUMNS: StaffCompleteListColumns<TaxFindingListRow> = {
  invoiceId: { label: 'Invoice', value: (row) => row.invoiceId },
  jurisdiction: { label: 'Bucketed as', value: (row) => row.jurisdiction },
  grossDollars: { label: 'Gross', value: (row) => Number(row.grossDollars) },
  taxDollars: { label: 'Tax', value: (row) => Number(row.taxDollars) },
  paidAt: { label: 'Paid', value: (row) => (row.paidAt ? new Date(row.paidAt) : null) },
  // How many findings the row raises: the rows with the most to fix together.
  groups: { label: 'Findings', value: (row) => row.groups.length },
}

export const TAX_FINDING_COLUMN_SORTS = staffCompleteListSorts(TAX_FINDING_SORT_COLUMNS)

/**
 * Every flagged row of a period, once, in the order the findings are listed
 * (blocking first), each carrying every finding that names it.
 */
export function taxFindingListRows(payload: TaxReturnPayload | null): TaxFindingListRow[] {
  const byInvoice = new Map<string, TaxFindingListRow>()
  for (const group of taxReturnFindingGroups(payload)) {
    for (const row of group.rows) {
      const held = byInvoice.get(row.invoiceId)
      if (held) held.groups.push(group.id)
      else byInvoice.set(row.invoiceId, { ...row, $id: row.invoiceId, groups: [group.id] })
    }
  }
  return [...byInvoice.values()]
}
