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
  TAX_FINDING_FILTER_FIELDS,
  TAX_FINDING_SEARCH_PATHS,
  type TaxFindingListRow,
} from '../tax-findings-list'
import { answerStaffCompleteList, type StaffCompleteListPage } from './staff-complete-list'
import type { StaffListQueryRequest } from './staff-list-query'

/** Why nothing is applied over a period the read cap cut short. */
const INCOMPLETE =
  'the period holds more rows than one read can take, so a match would ' +
  'answer over part of it — narrow the period'

/**
 * One page of the findings that answer every clause and the search, over the
 * period's COMPLETE rows (`answerStaffCompleteList`) — or, when the read was
 * not complete, the rows unfiltered with every clause and the search refused
 * by name, because a match over part of a period would answer "no such row"
 * for a row the read never reached. The cursor is the invoice id of the last
 * row of the previous page. See `utils/tax-findings-list.ts`.
 */
export function serveTaxFindings(
  rows: readonly TaxFindingListRow[],
  request: StaffListQueryRequest,
  complete: boolean,
): StaffCompleteListPage<TaxFindingListRow> {
  const answer = (asked: StaffListQueryRequest) =>
    answerStaffCompleteList({
      rows,
      fields: TAX_FINDING_FILTER_FIELDS,
      searchPaths: TAX_FINDING_SEARCH_PATHS,
      request: asked,
      cursorOf: (row) => row.$id,
    })
  if (complete) return answer(request)
  const page = answer({ ...request, clauses: [], search: [] })
  return {
    ...page,
    refused: [
      ...request.clauses.map((clause) => ({ clause, reason: INCOMPLETE })),
      ...(request.search.some((word) => word.trim()) ? [{ clause: 'search' as const, reason: INCOMPLETE }] : []),
    ],
  }
}
