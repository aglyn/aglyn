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

import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/**
 * THE TWO ENROLLMENT FILTERS A LINK CAN CARRY (AGL-3332): "who clicked" and
 * "who followed this destination".
 *
 * The Results card's "Clicked" figure and each "Links followed" row lead to
 * the Enrollments tab narrowed by the table's own filter — no second page
 * — and they do it through the URL, so the narrowed list is a link a rep can
 * keep, and so the browser's back button, from a person opened out of it,
 * lands on the same narrowed list rather than on everyone.
 *
 * Only these two live in the URL. The other clauses the grid's panel sets
 * stay the page's own, as they always were.
 */

/** The enrollments table's "Clicked" filter answer for the people who did. */
export const OUTREACH_CLICKED_FILTER_VALUE = 'yes'

export const OUTREACH_CLICKED_PARAM = 'clicked'
export const OUTREACH_LINK_PARAM = 'link'

/** The enrollment fields whose clause the URL holds. */
export const OUTREACH_URL_FILTER_FIELDS: ReadonlySet<string> = new Set(['clicked', 'link'])

/** What a URL's query narrows the enrollments by. */
export function outreachEnrollmentUrlClauses(
  params: Pick<URLSearchParams, 'get'> | null | undefined,
): ListFilterClause[] {
  const clauses: ListFilterClause[] = []
  if (params?.get(OUTREACH_CLICKED_PARAM) === OUTREACH_CLICKED_FILTER_VALUE) {
    clauses.push({ field: 'clicked', op: 'equals', value: OUTREACH_CLICKED_FILTER_VALUE })
  }
  const link = params?.get(OUTREACH_LINK_PARAM)?.trim()
  if (link) clauses.push({ field: 'link', op: 'equals', value: link })
  return clauses
}

/**
 * The query string for a set of clauses, keeping every parameter it does
 * not own. A clause the URL cannot hold — `link` with any operator but
 * `equals` — stays the page's own.
 */
export function outreachEnrollmentFilterSearch(
  clauses: readonly ListFilterClause[],
  current: string,
): string {
  const params = new URLSearchParams(current)
  params.delete(OUTREACH_CLICKED_PARAM)
  params.delete(OUTREACH_LINK_PARAM)
  for (const clause of clauses) {
    if (clause.field === 'clicked' && clause.op === 'equals' && clause.value === OUTREACH_CLICKED_FILTER_VALUE) {
      params.set(OUTREACH_CLICKED_PARAM, OUTREACH_CLICKED_FILTER_VALUE)
    }
    if (clause.field === 'link' && clause.op === 'equals' && clause.value) {
      params.set(OUTREACH_LINK_PARAM, clause.value)
    }
  }
  return params.toString()
}

/** Whether the URL can hold this clause, or it stays the page's own. */
export function outreachClauseLivesInUrl(clause: ListFilterClause): boolean {
  return OUTREACH_URL_FILTER_FIELDS.has(clause.field) && clause.op === 'equals'
}

/** The Enrollments tab narrowed to the people who clicked, or who followed one destination. */
export function outreachEnrollmentsFilterHref(
  enrollmentsPath: string,
  filter: { clicked: true } | { link: string },
): string {
  const params = new URLSearchParams(
    'link' in filter
      ? { [OUTREACH_LINK_PARAM]: filter.link }
      : { [OUTREACH_CLICKED_PARAM]: OUTREACH_CLICKED_FILTER_VALUE },
  )
  return `${enrollmentsPath}?${params.toString()}`
}
