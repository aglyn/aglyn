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

import { listFilterOperatorLabel } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterOption } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type { ListQueryRefusal } from '@aglyn/shared-ui-jsx/const/list-query-plan'

/** A value the panel sent as an instant or a day, as the reader's day. */
const DAY = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/

/**
 * What a list's query did not take, as `ListQueryNotices` reads it: each
 * refused clause spelled the way its chip spells it ("Site access is
 * Author"), and the search as "Search" (AGL-3321).
 *
 * A route hands its refusals back as JSON in the same shape the plan made
 * them, so a browser list and a route list label them the same way.
 */
export function listQueryRefusalNotices(
  refused: readonly ListQueryRefusal[],
  headers: Readonly<Record<string, string>>,
  options: Readonly<Record<string, readonly ListFilterOption[]>> = {},
): Array<{ label: string; reason: string }> {
  return refused.map(({ clause, reason }) => {
    if (clause === 'search') return { label: 'Search', reason }
    const named = (value: string) => {
      const choice = options[clause.field]?.find((option) => option.value === value)
      if (choice) return choice.label
      return DAY.test(value) ? new Date(value).toLocaleDateString() : value
    }
    const value = (clause.value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(named)
      .join(', ')
    const header = headers[clause.field] ?? clause.field
    return {
      label: `${header} ${listFilterOperatorLabel(clause.op)}${value ? ` ${value}` : ''}`,
      reason,
    }
  })
}
