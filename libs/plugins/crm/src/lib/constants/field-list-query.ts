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

import type { CrmFieldObject } from '@aglyn/aglyn'
import {
  LIST_QUERY_ID_PATH,
  type ListQueryDeclaration,
  type ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT THE CRM › FIELDS TABLE ASKS FIRESTORE (AGL-3335).
 *
 * One query over `orgs/{orgId}/contactFields`, narrowed to the tab
 * (`object ==`, the list's base) and read whole — at most
 * `CONTACT_FIELDS_MAX_PER_ORG` — in document-id order. Every clause the
 * Filters panel offers and the search box are predicates on it:
 *
 *   type          the stored type;
 *   required      the stored flag, a boolean on every definition;
 *   search        `searchTokens`: every prefix of the field's name and of its
 *                 key, whole and split at `_`, `-` and `.`.
 *
 * All three are equalities beside the base, and the order is the document
 * id, so Firestore answers every combination by merging the single-field
 * indexes it keeps on its own: the table costs no composite. The stored
 * `order`, and the grid's sorts by Field, Key and Type, are applied to the
 * answer, which is every match there is — so none of them reorders a
 * window. The three fields are stamped by the Fields section's writes
 * (`crmFieldListFields`) and, for the definitions written before, by
 * `tools/scripts/backfill-crm-list-fields.mjs`.
 */

/** The array the search box reads. */
export const CRM_FIELD_SEARCH_TOKENS = 'searchTokens'

export const CRM_FIELD_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'type',
      kind: 'exact',
      path: 'type',
      presence: 'always',
      operators: ['equals', 'isAnyOf'],
    },
    { column: 'required', kind: 'boolean', path: 'required', operators: ['equals'] },
  ],
  sorts: [{ path: LIST_QUERY_ID_PATH, direction: 'asc' }],
  search: { tokensPath: CRM_FIELD_SEARCH_TOKENS },
}

/** The scope every read of the table carries: this tab's definitions. */
export function crmFieldListBase(object: CrmFieldObject): ListQueryFilter[] {
  return [{ path: 'object', op: '==', value: object }]
}
