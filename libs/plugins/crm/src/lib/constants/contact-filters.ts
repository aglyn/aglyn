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
  type ContactFieldDefinition,
  CRM_CONTACT_VIEW_FIELDS,
  crmContactCustomColumn,
} from '@aglyn/aglyn'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'

/*
 * Contacts (`orgs/{orgId}/contacts`, read scoped to a host).
 *
 * The card's listener is `limit(1000)` and stays that way — nobody needs
 * forty thousand rows streamed into a table. What that cap must NOT do is
 * decide what a search can find, and it did: an org with 40,000 contacts
 * searched 1,000 of them and answered "no contacts match" for the rest. The
 * head-count already learned this lesson (AGL-1706, a server aggregate); the
 * search is the same mistake one field over.
 *
 * ⛔ `marketingConsent`, `ordersCount` and `ltvCents` are written only when
 * they apply, so a `false`/`0` filter would return nothing rather than
 * everyone else. `isNotEmpty` is exact on them and is what the menu offers.
 */
export const CONTACT_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  {
    column: 'name',
    kind: 'text',
    path: 'name',
    lowerPath: 'nameLower',
    tokensPath: 'nameTokens',
    reversedPath: 'nameReversed',
  },
  {
    // `normalizeContactEmail` lower-cases before every write, so the stored
    // value IS its own normalized key.
    column: 'email',
    kind: 'text',
    path: 'email',
    lowerPath: 'email',
    presence: 'always',
  },
  {
    /*
     * Already an array of lower-cased tags, so `contains` is a plain
     * `array-contains` — the one place the word-level caveat does not apply,
     * because a tag is matched whole rather than by word prefix.
     */
    column: 'tags',
    kind: 'text',
    path: 'tags',
    tokensPath: 'tags',
    // Ordered by the timestamp the list already sorts on, not by the tag
    // array — `orderBy` on the same field an `array-contains` matches is a
    // composite index nobody wants to explain.
    containsOrderBy: 'updatedAt',
    // `isAnyOf` is a saved segment's "any of these tags" (AGL-2617). The
    // query cannot serve it — `array-contains-any` is the scope clause's
    // — so the translator refuses it and the list matches it over the
    // window, which the caption says.
    operators: ['contains', 'isAnyOf', 'isNotEmpty'],
  },
  {
    /*
     * The forms a person came in through — the top-level `formIds` mirror
     * of the interactions' `formId` (AGL-2612), matched whole and as typed
     * because a form id is minted with mixed case. The form's own page links
     * here with its id; nobody types one. Ordered by the list's own
     * timestamp for the reason `tags` is, served by the
     * `(formIds CONTAINS, updatedAt DESC)` index.
     *
     * ⚠️ An `array-contains` on the mirror cannot share a query with the
     * `visibleTo` scope clause, so the list drops that clause for this one
     * filter and the rules admit the read to an org-wide member only — the
     * caveat the company contacts card states, stated again on the list.
     */
    column: 'formIds',
    kind: 'text',
    path: 'formIds',
    tokensPath: 'formIds',
    verbatimTokens: true,
    containsOrderBy: 'updatedAt',
    operators: ['contains'],
  },
  { column: 'hostId', kind: 'exact', path: 'hostId', presence: 'always' },
  { column: 'ordersCount', kind: 'number', path: 'ordersCount' },
  { column: 'ltvCents', kind: 'number', path: 'ltvCents' },
  { column: 'createdAt', kind: 'date', path: 'createdAt', presence: 'always' },
  { column: 'updatedAt', kind: 'date', path: 'updatedAt', presence: 'always' },
  /*
   * THE FACET FIELDS (AGL-2617) — window-only, every one of them.
   *
   * An owner, a stage, a company and the capture sources live on the
   * viewing group's facet of the shared contact row, and a facet path is
   * per group: a `where` on it would need an index per group, and the
   * translator would send a scoped member a query the rules deny. So these
   * are declared for the menu and for a saved view, matched over the loaded
   * window against the flattened row (`ContactRecord` carries each at the
   * top), and never put on a query — `windowOnly` is what holds that line.
   * The paths are the ROW'S, which is what the matcher reads.
   *
   * The values are picked, not typed — a uid from the roster, a stage from
   * the fixed list, a source from its labels, a company from the picker —
   * so `equals` and `isAnyOf` are what they offer; the section supplies
   * the choices. The column names are the contract `CRM_CONTACT_VIEW_FIELDS`
   * states, because the dynamic-list translator reads a view by them.
   */
  {
    column: CRM_CONTACT_VIEW_FIELDS.owner,
    kind: 'exact',
    path: 'ownerUid',
    windowOnly: true,
    operators: ['equals', 'isAnyOf', 'isNotEmpty'],
  },
  {
    column: CRM_CONTACT_VIEW_FIELDS.stage,
    kind: 'exact',
    path: 'lifecycleStage',
    windowOnly: true,
    operators: ['equals', 'isAnyOf', 'isNotEmpty'],
  },
  {
    // The `sources` presence map, matched on its keys — see `keysOf`.
    column: CRM_CONTACT_VIEW_FIELDS.source,
    kind: 'exact',
    path: 'sources',
    keysOf: true,
    windowOnly: true,
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: CRM_CONTACT_VIEW_FIELDS.company,
    kind: 'exact',
    path: 'companyId',
    windowOnly: true,
    operators: ['equals', 'isNotEmpty'],
  },
]

/**
 * One filter field per active custom contact field (AGL-2617).
 *
 * A custom value lives under the facet's `custom` map, so every one is
 * window-only for the reason the facet fields above are, and its column is
 * the one the table shows it under — `crmContactCustomColumn(key)` — so a
 * clause and a column agree on the name and a saved view's columns and
 * filters name the same thing. The kind follows the definition's type, and
 * `nullable` is how a cleared value is stored, which is what makes both
 * empty operators honest here.
 */
export function contactCustomFilterFields(
  definitions: readonly Pick<ContactFieldDefinition, 'key' | 'type' | 'retiredAt'>[],
): ListFilterField[] {
  return definitions
    .filter((definition) => !definition.retiredAt)
    .map((definition) => {
      const column = crmContactCustomColumn(definition.key)
      const path = `custom.${definition.key}`
      switch (definition.type) {
        case 'number':
          return { column, kind: 'number', path, windowOnly: true, presence: 'nullable' }
        case 'date':
          return { column, kind: 'date', path, windowOnly: true, presence: 'nullable' }
        case 'checkbox':
          return { column, kind: 'boolean', path, windowOnly: true }
        case 'select':
          return {
            column,
            kind: 'exact',
            path,
            windowOnly: true,
            presence: 'nullable',
            operators: ['equals', 'isAnyOf', 'isEmpty', 'isNotEmpty'],
          }
        default:
          return {
            column,
            kind: 'text',
            path,
            windowOnly: true,
            presence: 'nullable',
            operators: ['contains', 'equals', 'startsWith', 'isEmpty', 'isNotEmpty'],
          }
      }
    })
}

/** The custom fields' headers, keyed by the column each filters as. */
export function contactCustomFilterHeaders(
  definitions: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[],
): Record<string, string> {
  return Object.fromEntries(
    definitions.map((definition) => [
      crmContactCustomColumn(definition.key),
      definition.label || definition.key,
    ]),
  )
}

/**
 * How every filterable contact field reads — on a chip, in the add-filter
 * picker, and as the header of a filter-only hidden column.
 */
export const CONTACT_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Contact',
  email: 'Email',
  tags: 'Tags',
  formIds: 'Form ID',
  hostId: 'Site ID',
  ordersCount: 'Orders',
  ltvCents: 'Lifetime value (cents)',
  createdAt: 'Created',
  updatedAt: 'Updated',
  [CRM_CONTACT_VIEW_FIELDS.owner]: 'Owner',
  [CRM_CONTACT_VIEW_FIELDS.stage]: 'Stage',
  [CRM_CONTACT_VIEW_FIELDS.source]: 'Source',
  [CRM_CONTACT_VIEW_FIELDS.company]: 'Company',
}
