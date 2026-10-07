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

import type { ListFilterField } from './list-filter'
import type { ListFilterClause, ListFilterOption } from './list-filter-codecs'

/*
 * How a list's filter clauses read as words, for the chips over a list and
 * the notices that say a clause was not applied (AGL-3321).
 *
 * ⛔ No `@mui/x-data-grid` here, and no runtime import of `list-filter` or
 * `list-grid-filter`, which build the data grid's operators. The storefront's
 * product grid shows these notices on customers' published pages, and
 * reaching the grid's operators from here would ship the grid's filter
 * inputs with every storefront page.
 */

/**
 * How an operator reads on a chip or in a sentence — "Owner is Dana",
 * "Created on or after 1 Jan". One map so every list that shows its
 * clauses back spells them the same way; an operator nothing here names
 * is shown as itself rather than hidden.
 */
export function listFilterOperatorLabel(op: string): string {
  switch (op) {
    case 'contains':
      return 'contains'
    case 'doesNotContain':
      return 'does not contain'
    case 'equals':
    case 'is':
    case '=':
      return 'is'
    case 'doesNotEqual':
    case '!=':
      return 'is not'
    case 'startsWith':
      return 'starts with'
    case 'endsWith':
      return 'ends with'
    case 'isAnyOf':
      return 'is any of'
    case 'isEmpty':
      return 'is empty'
    case 'isNotEmpty':
      return 'is set'
    case 'after':
      return 'after'
    case 'onOrAfter':
      return 'on or after'
    case 'before':
      return 'before'
    case 'onOrBefore':
      return 'on or before'
    case '>':
      return 'over'
    case '>=':
      return 'at least'
    case '<':
      return 'under'
    case '<=':
      return 'at most'
    default:
      return op
  }
}

/** Operators that carry no value. */
const VALUELESS_OPERATORS = new Set(['isEmpty', 'isNotEmpty'])
/** Operators that take several values, comma-joined the way the grammar splits them. */
const MULTI_OPERATORS = new Set(['isAnyOf'])

/**
 * The calendar day a date clause names, as a LOCAL date.
 *
 * The panel's date input holds a day, not an instant, and hands it over as
 * `YYYY-MM-DD` — which `new Date` reads as UTC midnight, the previous
 * evening anywhere west of UTC. Travelled through `toISOString`, the same
 * day arrives as `YYYY-MM-DDT00:00:00.000Z`. Either spelling is read by its
 * date parts, so "on or after Sep 17" starts on Sep 17 wherever the reader
 * is. Any other value is an instant and is read as one. The query
 * translators read a date clause through it too, so the day a query asks for
 * is the day the rows are matched by.
 */
const DAY_ONLY = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/
export const listFilterDay = (raw: string): Date => {
  const day = DAY_ONLY.exec(raw)
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(raw)
}

/** A date clause's value as the day it names, read the way the query reads it. */
const dayLabel = (raw: string): string => {
  const at = listFilterDay(raw)
  return Number.isNaN(at.getTime()) ? raw : at.toLocaleDateString()
}

/**
 * How a clause reads as a sentence — "Owner is Dana", "Created on or after
 * 1 Jan", "Reason is any of Bounced, Complained": its header, its operator,
 * and its value by the label of the option it names.
 *
 * ONE wording, used by the chips over a list and by the notices that say a
 * clause was not applied (`listQueryRefusals`), so the two cannot describe
 * the same clause differently.
 */
export function listFilterClauseSentence(
  clause: ListFilterClause,
  context: {
    fields: readonly ListFilterField[]
    headers?: Readonly<Record<string, string>>
    options?: Readonly<Record<string, readonly ListFilterOption[]>>
  },
): string {
  const field = context.fields.find((entry) => entry.column === clause.field)
  const header = context.headers?.[clause.field] ?? clause.field
  const choices = context.options?.[clause.field]
  const named = (value: string) =>
    choices?.find((option) => option.value === value)?.label ?? value
  const value = VALUELESS_OPERATORS.has(clause.op)
    ? ''
    : MULTI_OPERATORS.has(clause.op)
      ? clause.value
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map(named)
          .join(', ')
      : clause.label ?? (field?.kind === 'date' ? dayLabel(clause.value) : named(clause.value))
  return `${header} ${listFilterOperatorLabel(clause.op)}${value ? ` ${value}` : ''}`
}
