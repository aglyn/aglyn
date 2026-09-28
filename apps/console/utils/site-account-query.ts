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

import type { ListQueryDeclaration } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { SITE_MEMBER_LIST_FILTER_FIELDS } from './list-filters'

/**
 * The Site users list's one query (AGL-3321): every clause the Filters panel
 * holds and the quick search's word, planned together by `planListQuery`
 * beneath the list's only order, newest first.
 *
 * The search reads `searchTokens`, the word-prefix array both writers stamp
 * (`memberSearchTokens`): the start of any word of the display name or of
 * the address, so a member who never gave a name is found by their address.
 * `Name contains` reads `displayNameTokens`, the name alone. The two are
 * each an array clause, and one query holds one, so they cannot stand
 * together and the plan refuses the second by name.
 *
 * Every equality is served beneath `createdAt DESC` by one
 * `(field, createdAt DESC)` composite each, which Firestore merges for any
 * combination of them, and a Joined range is a range on the sort field
 * itself. `site-account-query.spec.ts` holds the index file to it.
 */
export const SITE_ACCOUNT_LIST_QUERY: ListQueryDeclaration = {
  fields: SITE_MEMBER_LIST_FILTER_FIELDS,
  sorts: [{ path: 'createdAt', direction: 'desc' }],
  search: { tokensPath: 'searchTokens' },
}
