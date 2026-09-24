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
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * What a site's collaborator roster (`hosts/{hostId}/members`) filters by,
 * and how its query serves it (AGL-3321).
 *
 * The roster is read `orderBy('email')` a growing page at a time, and both
 * narrowings are served beneath that order, so every page the pager turns is
 * a page of the answer:
 *
 *   Site access   an equality (one role) or an `in` (several) on `role`,
 *                 which every roster write stores. Beneath the email order
 *                 that is the `members: role ASC, email ASC` composite in
 *                 `cloud/firebase-firestore.indexes.json`.
 *   Search        a PREFIX of the address, as a range on `email` itself: the
 *                 roster's one writer lower-cases the address before storing
 *                 it, so the stored value is its own search key, and a range
 *                 on the sort field needs no index of its own (alone), or the
 *                 same composite (beside a role).
 *
 * A roster document holds no name — its writer stores the address, the role
 * and the status — so the search reads the address, which is also what the
 * row shows. A mid-address match (`contains`) is not offered: no index holds
 * an address's parts.
 */
export const HOST_MEMBER_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'role', kind: 'exact', path: 'role', operators: ['equals', 'isAnyOf'] },
]

export const HOST_MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  role: 'Site access',
}

/** Firestore caps `in` at thirty values. */
const IN_LIMIT = 30

/** A very high private-use codepoint: the top of a prefix range. */
const HIGH = ''

/** One `where` the roster's query applies: a path, an operator, a value. */
export type HostMemberWhere = [path: 'role', op: '==' | 'in', value: string | string[]]

/**
 * The roster query's `where`s for the clauses in force. A clause on a field
 * the roster does not declare, or with no value, is ignored rather than
 * guessed at.
 */
export function hostMemberFilterWheres(
  clauses: readonly ListFilterClause[],
): HostMemberWhere[] {
  const wheres: HostMemberWhere[] = []
  for (const clause of clauses) {
    if (clause.field !== 'role') continue
    const values = clause.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (!values.length) continue
    if (clause.op === 'isAnyOf') {
      wheres.push(['role', 'in', values.slice(0, IN_LIMIT)])
    } else if (clause.op === 'equals') {
      wheres.push(['role', '==', values[0]])
    }
  }
  return wheres
}

/**
 * The address range a quick search asks for, or `null` for no search. The
 * words are joined as typed and lower-cased, the form the address is stored
 * in; an address holds no space, so two words match nothing, which is the
 * honest answer.
 */
export function hostMemberEmailRange(
  words: readonly string[],
): { start: string; end: string } | null {
  const prefix = words.join(' ').trim().toLowerCase()
  return prefix ? { start: prefix, end: `${prefix}${HIGH}` } : null
}
