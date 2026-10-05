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
  CRM_FACET_KEY_ANY_GROUP,
  type CrmFacetKeyField,
  crmContactCustomColumn,
  crmFacetKey,
  crmFacetKeyValue,
  EMAIL_STATE_STATUSES,
} from '@aglyn/aglyn'
import type {
  ListFilterField,
  ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import type {
  ListQueryDeclaration,
  ListQuerySort,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import {
  CRM_LIST_SEARCH,
  type CrmClauseAsked,
  crmAnyOf,
  crmClauseValues,
} from '../model/crm-list-query'

/*==========================================
 * CONTACTS (`orgs/{orgId}/contacts`, read scoped to a host) — WHAT THE
 * PANEL OFFERS, AND WHAT THE QUERY ASKS (AGL-3321).
 *
 * Every clause and the search word are on the list's one Firestore query,
 * newest change first, paged by it. A contact is one row shared by every
 * holder, and most of what a holder filters by — the owner, the stage, the
 * sources, the company, the tags, a custom value, whether the person has
 * bought — lives on that holder's FACET, a path per holder no index can
 * reach. So every writer stamps `facetKeys` (`crmContactFacetKeys` in
 * `@aglyn/aglyn`): `{group}:{field}={value}` for each holder's value,
 * `{group}:{field}` for "has one", and the same under `*` for any holder.
 * Under a site a facet clause asks the viewing holder's key; at the
 * organization level, any holder's.
 *
 * What one query holds decides the rest:
 *
 *   - ONE array clause. The scope clause (`visibleTo array-contains-any`),
 *     the search (`searchTokens`), a name word (`nameTokens`), a form
 *     (`formIds`) and a facet clause (`facetKeys`) all are one. The search
 *     folds into the scope clause for a reader who may drop it; a facet or
 *     form clause stands in the scope clause's place for that reader, since
 *     only a record the viewing holder keeps carries its key. Two of them
 *     at once is refused by name.
 *   - ONE range. `updatedAt`, the field the list is ordered by, composes
 *     with anything; Created and a name or address prefix order the list by
 *     their own field and so stand alone beside the scope clause
 *     (`contactSoloClause`), served by the `(visibleTo, field)` composites.
 *   - equalities (the address, the site, the verdict, "No next activity")
 *     compose freely, one `(field, updatedAt DESC)` composite each.
 *
 * The per-holder FIGURES (orders, lifetime value) live on each holder's
 * facet, where no range reaches — a top-level `ordersCount` was never
 * written — so they offer "is not empty" alone: "has bought".
 *
 * A collaborator's search is the start of the name (`CONTACT_PREFIX_SEARCH`).
 *=========================================*/

/**
 * A word of the canonical name (`nameTokens`), the whole of it, or its start
 * or end — `nameLower`, which every contact carries, and `nameReversed`.
 */
const NAME_FIELD: ListFilterField = {
  column: 'name',
  kind: 'text',
  path: 'name',
  lowerPath: 'nameLower',
  tokensPath: 'nameTokens',
  reversedPath: 'nameReversed',
  operators: ['contains', 'equals', 'startsWith', 'endsWith'],
}

/**
 * The address. `normalizeContactEmail` lower-cases before every write, so the
 * stored value IS its own normalized key.
 */
const EMAIL_FIELD: ListFilterField = {
  column: 'email',
  kind: 'text',
  path: 'email',
  lowerPath: 'email',
  presence: 'always',
  operators: ['equals', 'startsWith'],
}

/** When the person was first captured — a range the list is then ordered by. */
const CREATED_FIELD: ListFilterField = {
  column: CRM_CONTACT_VIEW_FIELDS.createdAt,
  kind: 'date',
  path: 'createdAt',
  presence: 'always',
  operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
}

/**
 * The forms a person came in through — the top-level `formIds` mirror of the
 * interactions' `formId` (AGL-2612), matched whole and as typed because a
 * form id is minted with mixed case. The form's own page links here with its
 * id; nobody types one.
 */
const FORM_FIELD: ListFilterField = {
  column: 'formIds',
  kind: 'text',
  path: 'formIds',
  tokensPath: 'formIds',
  verbatimTokens: true,
  operators: ['contains'],
}

/** The column a contact's lead source filters as (AGL-3511). */
export const CONTACT_LEAD_SOURCE_COLUMN = 'leadSource'

/** What the Filters panel offers on a contact, in the grid's grammar. */
export const CONTACT_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  NAME_FIELD,
  EMAIL_FIELD,
  {
    // A holder's tags, matched whole and case-insensitively.
    column: CRM_CONTACT_VIEW_FIELDS.tags,
    kind: 'exact',
    path: 'tags',
    operators: ['contains', 'isAnyOf', 'isNotEmpty'],
  },
  FORM_FIELD,
  { column: 'hostId', kind: 'exact', path: 'hostId', presence: 'always' },
  // Per-holder figures: "has bought", never a range across holders.
  {
    column: CRM_CONTACT_VIEW_FIELDS.orders,
    kind: 'number',
    path: 'ordersCount',
    operators: ['isNotEmpty'],
  },
  {
    column: CRM_CONTACT_VIEW_FIELDS.ltv,
    kind: 'number',
    path: 'ltvCents',
    operators: ['isNotEmpty'],
  },
  CREATED_FIELD,
  {
    column: CRM_CONTACT_VIEW_FIELDS.updatedAt,
    kind: 'date',
    path: 'updatedAt',
    presence: 'always',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
  /*
   * "No next activity" (AGL-2661): `nextTaskAtMs == null`, which every
   * contact carries from its creation until a task is scheduled against it.
   */
  {
    column: 'nextTaskAtMs',
    kind: 'date',
    path: 'nextTaskAtMs',
    presence: 'nullable',
    storedAs: 'millis',
    operators: ['isEmpty'],
  },
  /*
   * THE FACET FIELDS (AGL-2617). The values are picked, not typed — a uid
   * from the roster, a stage from the fixed list, a source from its labels,
   * a company from the picker — so `equals` and `isAnyOf` are what they
   * offer; the section supplies the choices. The column names are the
   * contract `CRM_CONTACT_VIEW_FIELDS` states, because the dynamic-list
   * translator reads a view by them. The paths are the flattened ROW'S.
   */
  {
    column: CRM_CONTACT_VIEW_FIELDS.owner,
    kind: 'exact',
    path: 'ownerUid',
    operators: ['equals', 'isAnyOf', 'isNotEmpty'],
  },
  {
    column: CRM_CONTACT_VIEW_FIELDS.stage,
    kind: 'exact',
    path: 'lifecycleStage',
    operators: ['equals', 'isAnyOf', 'isNotEmpty'],
  },
  {
    // The `sources` presence map, matched on its keys — see `keysOf`.
    column: CRM_CONTACT_VIEW_FIELDS.source,
    kind: 'exact',
    path: 'sources',
    keysOf: true,
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: CRM_CONTACT_VIEW_FIELDS.company,
    kind: 'exact',
    path: 'companyId',
    operators: ['equals', 'isNotEmpty'],
  },
  /*
   * A holder's lead source (AGL-3511), picked from the org's Lead source
   * values and asked through its `leadSource` facet key — the label as the
   * picklist compares it.
   */
  {
    column: CONTACT_LEAD_SOURCE_COLUMN,
    kind: 'exact',
    path: 'leadSource',
    operators: ['equals', 'isAnyOf', 'isNotEmpty'],
  },
  /*
   * The verdict on the address (AGL-3245), asked through `emailStatus` —
   * `none` for a person nothing has been said about, which is what "is
   * empty" asks.
   */
  {
    column: 'emailState',
    kind: 'exact',
    path: 'emailState.status',
    presence: 'nullable',
    operators: ['equals', 'isAnyOf', 'isEmpty', 'isNotEmpty'],
  },
]

/**
 * One filter field per active custom contact field (AGL-2617). A custom
 * value lives under the holder's `custom` map, so it is asked through the
 * holder's facet key: equality on a picked, typed or ticked value, and
 * "is not empty". Its column is the one the table shows it under —
 * `crmContactCustomColumn(key)` — so a clause and a column agree on the name.
 */
export function contactCustomFilterFields(
  definitions: readonly Pick<
    ContactFieldDefinition,
    'key' | 'type' | 'retiredAt'
  >[],
): ListFilterField[] {
  return definitions
    .filter((definition) => !definition.retiredAt)
    .map((definition): ListFilterField => {
      const column = crmContactCustomColumn(definition.key)
      const path = `custom.${definition.key}`
      switch (definition.type) {
        case 'number':
          return {
            column,
            kind: 'number',
            path,
            operators: ['=', 'isNotEmpty'],
          }
        case 'date':
          return { column, kind: 'date', path, operators: ['isNotEmpty'] }
        case 'checkbox':
          return { column, kind: 'boolean', path }
        case 'select':
          return {
            column,
            kind: 'exact',
            path,
            operators: ['equals', 'isAnyOf', 'isNotEmpty'],
          }
        default:
          return {
            column,
            kind: 'text',
            path,
            lowerPath: path,
            operators: ['equals', 'isNotEmpty'],
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
  nextTaskAtMs: 'Next activity',
  [CRM_CONTACT_VIEW_FIELDS.owner]: 'Owner',
  [CRM_CONTACT_VIEW_FIELDS.stage]: 'Stage',
  [CRM_CONTACT_VIEW_FIELDS.source]: 'Source',
  [CRM_CONTACT_VIEW_FIELDS.company]: 'Company',
  [CONTACT_LEAD_SOURCE_COLUMN]: 'Lead source',
  emailState: 'Email',
}

/*------------------------------------------
 * THE QUERY THE CONTACTS LIST RUNS.
 *-----------------------------------------*/

/** The list's one order: newest change first. */
export const CONTACT_LIST_SORTS: readonly ListQuerySort[] = [
  { path: 'updatedAt', direction: 'desc' },
]

/** The stored array a facet clause is asked of. */
export const CONTACT_FACET_KEYS_PATH = 'facetKeys'

/** The fields the Contacts query asks — each a stored field, as named. */
export const CONTACT_QUERY_FIELDS: readonly ListFilterField[] = [
  NAME_FIELD,
  EMAIL_FIELD,
  FORM_FIELD,
  CREATED_FIELD,
  { column: 'hostId', kind: 'exact', path: 'hostId', presence: 'always' },
  {
    column: 'updatedAt',
    kind: 'date',
    path: 'updatedAt',
    presence: 'always',
    operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
  },
  {
    column: 'nextTaskAtMs',
    kind: 'date',
    path: 'nextTaskAtMs',
    presence: 'nullable',
    storedAs: 'millis',
    operators: ['isEmpty'],
  },
  {
    column: 'emailStatus',
    kind: 'exact',
    path: 'emailStatus',
    operators: ['equals', 'isAnyOf'],
  },
  {
    column: CONTACT_FACET_KEYS_PATH,
    kind: 'exact',
    path: CONTACT_FACET_KEYS_PATH,
    tokensPath: CONTACT_FACET_KEYS_PATH,
    operators: ['contains', 'isAnyOf'],
  },
]

export const CONTACT_LIST_DECLARATION: ListQueryDeclaration = {
  fields: CONTACT_QUERY_FIELDS,
  sorts: CONTACT_LIST_SORTS,
  search: CRM_LIST_SEARCH,
}

/** The grid fields a stored clause passes to the query unchanged. */
const AS_STORED = new Set([
  'name',
  'email',
  'formIds',
  'hostId',
  'createdAt',
  'updatedAt',
  'nextTaskAtMs',
])

/**
 * The ranges that stand ALONE beside the scope clause: Created and a name
 * or address prefix each order the list by their own field, which the
 * `(visibleTo, field)` composites serve and nothing beside them. Updated is
 * not one: the list is ordered by it already, so it composes freely.
 */
export function contactSoloClause(clause: ListFilterRequest): boolean {
  if (clause.field === 'createdAt') return true
  if (clause.field === 'name') return clause.op === 'startsWith' || clause.op === 'endsWith'
  return clause.field === 'email' && clause.op === 'startsWith'
}

/**
 * A collaborator's search (see `prefixSearch` in `useCrmListQuery`): the
 * start of the contact's name, beside the scope clause.
 */
export const CONTACT_PREFIX_SEARCH = {
  field: NAME_FIELD,
  notice: 'Search matches the start of a contact’s name for access limited to specific sites.',
}

/** The facet field each grid column is keyed under. */
const FACET_FIELDS: Readonly<Record<string, CrmFacetKeyField>> = {
  [CRM_CONTACT_VIEW_FIELDS.owner]: 'owner',
  [CRM_CONTACT_VIEW_FIELDS.stage]: 'stage',
  [CRM_CONTACT_VIEW_FIELDS.source]: 'source',
  [CRM_CONTACT_VIEW_FIELDS.company]: 'company',
  [CRM_CONTACT_VIEW_FIELDS.tags]: 'tag',
  [CRM_CONTACT_VIEW_FIELDS.orders]: 'orders',
  [CRM_CONTACT_VIEW_FIELDS.ltv]: 'ltv',
  [CONTACT_LEAD_SOURCE_COLUMN]: 'leadSource',
}

/** Who is asking: the viewing holder, and whether their query may drop the scope clause. */
export interface ContactQueryReader {
  /** The viewing holder's group id under a site; `null` at the organization level. */
  groupId: string | null
  /**
   * Whether the reader's query may stand a facet or form clause in the
   * scope clause's place (`useCrmFoldsScope`) — always at the organization
   * level, where there is no scope clause.
   */
  foldsScope: boolean
}

/** Why a reader whose access is some sites cannot filter by a holder's field. */
const LIMITED_ACCESS =
  'your access is limited to specific sites, which this filter cannot be combined with — an organization administrator can use it'

/** The facet field a grid column names, or null for one that is not a facet field. */
function facetFieldOf(column: string): CrmFacetKeyField | null {
  if (FACET_FIELDS[column]) return FACET_FIELDS[column]
  if (column.startsWith(CRM_CONTACT_VIEW_FIELDS.custom)) {
    return `custom.${column.slice(CRM_CONTACT_VIEW_FIELDS.custom.length)}`
  }
  return null
}

/**
 * One grid clause as the clause the Contacts query asks — see the block at
 * the top. A clause a query cannot serve for this reader is refused by
 * name, never matched over the rows a page loaded.
 */
export function contactQueryClause(
  clause: ListFilterRequest,
  reader: ContactQueryReader,
): CrmClauseAsked {
  if (AS_STORED.has(clause.field)) {
    if (clause.field === 'formIds' && !reader.foldsScope)
      return { refused: LIMITED_ACCESS }
    return { field: clause.field, op: clause.op, value: clause.value }
  }
  if (clause.field === 'emailState') {
    if (clause.op === 'isEmpty')
      return { field: 'emailStatus', op: 'equals', value: 'none' }
    if (clause.op === 'isNotEmpty')
      return crmAnyOf('emailStatus', EMAIL_STATE_STATUSES)
    const values = crmClauseValues(clause)
    if (
      values.some(
        (value) => !(EMAIL_STATE_STATUSES as readonly string[]).includes(value),
      )
    ) {
      return { refused: 'pick one of the choices' }
    }
    return crmAnyOf('emailStatus', values)
  }
  const facet = facetFieldOf(clause.field)
  if (!facet) return { refused: 'this list does not filter by that' }
  if (!reader.foldsScope) return { refused: LIMITED_ACCESS }
  const group = reader.groupId ?? CRM_FACET_KEY_ANY_GROUP
  if (clause.op === 'isNotEmpty') {
    return {
      field: CONTACT_FACET_KEYS_PATH,
      op: 'contains',
      value: crmFacetKey(group, facet),
    }
  }
  const keys: string[] = []
  for (const value of crmClauseValues(clause)) {
    const key = crmFacetKeyValue(clause.op === '=' ? Number(value) : value)
    if (key === null) return { refused: 'no value yet' }
    keys.push(crmFacetKey(group, facet, key))
  }
  const asked = crmAnyOf(CONTACT_FACET_KEYS_PATH, keys)
  // One key is an `array-contains`; several, an `array-contains-any`.
  return 'refused' in asked || asked.op === 'isAnyOf'
    ? asked
    : { ...asked, op: 'contains' }
}

/**
 * Whether an asked clause stands in for the scope clause: a facet key of
 * the viewing holder, which only a record that holder keeps carries, or a
 * form, which only its site's captures carry.
 */
export function contactClauseImpliesScope(groupId: string | null) {
  return (clause: ListFilterRequest): boolean => {
    if (clause.field === 'formIds') return true
    if (clause.field !== CONTACT_FACET_KEYS_PATH || !groupId) return false
    return crmClauseValues(clause).every((key) => key.startsWith(`${groupId}:`))
  }
}

/**
 * The query shapes the Contacts list can send, as declarations the index
 * pin enumerates (AGL-3321): the list's own, without its solo ranges, whose
 * every equality rides `(field, updatedAt DESC)`; and each solo range beside
 * the scope clause alone.
 */
export function contactIndexShapes(): ListQueryDeclaration[] {
  const soloOps = new Set(['startsWith', 'endsWith'])
  const main: ListQueryDeclaration = {
    ...CONTACT_LIST_DECLARATION,
    fields: CONTACT_QUERY_FIELDS.filter((field) => field !== CREATED_FIELD).map((field) =>
      field.operators
        ? { ...field, operators: field.operators.filter((op) => !soloOps.has(op)) }
        : field,
    ),
  }
  const solo: ListQueryDeclaration = {
    fields: [
      { ...NAME_FIELD, operators: ['startsWith', 'endsWith'] },
      { ...EMAIL_FIELD, operators: ['startsWith'] },
      CREATED_FIELD,
    ],
    sorts: [],
  }
  return [main, solo]
}
