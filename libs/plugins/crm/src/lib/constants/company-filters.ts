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

/*
 * Companies (`orgs/{orgId}/companies`, read scoped to a host).
 *
 * Every predicate here is appended to the listener's `visibleTo
 * array-contains-any`, which is the constraint that decides what a company
 * filter may be. Firestore carries ONE array clause per query, so the
 * word-prefix `contains` search the contact list declares through
 * `nameTokens` cannot run beside the scope predicate — a query with both is
 * refused outright, not served slowly. The name is therefore offered as a
 * PREFIX range and an exact match over `nameLower`, which the
 * `(visibleTo CONTAINS, nameLower ASC)` index serves with the scope in
 * place. No `tokensPath`, deliberately.
 *
 * `ownerUid` is declared so the translator can answer it; the column itself
 * renders a person's name from the roster and offers a single-select
 * operator in the panel, which the section maps onto this field's `equals`.
 * Served by `(visibleTo CONTAINS, ownerUid ASC)`.
 */
export const COMPANY_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    presence: 'always',
  },
  {
    column: 'ownerUid',
    kind: 'exact',
    path: 'ownerUid',
    operators: ['equals'],
  },
]
