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

import { scopedSearch } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterField } from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListFilterOption } from '@aglyn/shared-util-tools/list-query/list-filter-codecs'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
  ListQueryRequest,
  ListQuerySort,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'

/*
 * WHAT EACH INBOX LIST CAN BE ASKED, ON ITS FIRESTORE QUERY (AGL-3321).
 *
 * Every clause the Filters panel offers and every quick-search word is a
 * predicate on the list's query, planned by `planListQuery`, so each page is
 * a page of the answer. A question no query can answer is not offered, and a
 * combination one query cannot hold is refused by name. `list-queries.spec.ts`
 * holds `cloud/firebase-firestore.indexes.json` to `listQueryIndexes` of each
 * declaration.
 */

/**
 * The header orders of a newest-first contacts list (AGL-3680): newest first
 * as the default, then oldest first and the address either way, each
 * `alone` — served while nothing narrows the list past its scope, so they
 * cost a composite only beside a scope clause. Both fields are on every row
 * (see each list below).
 */
const contactSorts = (createdLabel: string): ListQuerySort[] => [
  { path: 'createdAt', direction: 'desc', column: 'createdAt', label: createdLabel },
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: createdLabel, alone: true },
  { path: 'email', direction: 'asc', column: 'email', label: 'Email', alone: true },
  { path: 'email', direction: 'desc', column: 'email', label: 'Email', alone: true },
]

/*==========================================
 * SITE MEMBERS — `hosts/{hostId}/siteMembers`, newest first.
 *
 * The same fields and index shapes as the console's Site users list
 * (`apps/console/utils/site-account-query.ts`), so the composites are one
 * set. The search reads `searchTokens` — the start of any word of the
 * display name or of the address — which both writers of a member stamp
 * (`memberSearchTokens`, the commerce plugin's register and account routes)
 * and `backfill-site-member-search.mjs` stamps on the members written
 * before it. The register path lower-cases `email` before it stores it, so
 * the stored address is its own normalized key.
 *=========================================*/
export const SITE_MEMBER_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    {
      column: 'email',
      kind: 'text',
      path: 'email',
      lowerPath: 'email',
      presence: 'always',
      operators: ['equals'],
    },
  ],
  sorts: contactSorts('Joined'),
  search: { tokensPath: 'searchTokens' },
}

export const SITE_MEMBER_FILTER_HEADERS: Readonly<Record<string, string>> = {
  email: 'Email',
}

/*==========================================
 * LEADS — `orgs/{orgId}/leads`, newest first.
 *
 * Under a site the list is narrowed to what that site may see
 * (`visibleTo array-contains-any`, {@link leadListBase}); on the
 * organization's Inbox an org-wide member reads it unscoped.
 *
 * `searchTokens` — the lead's name, address, company, title and tags as word
 * prefixes — and `scopedSearchTokens` — the same behind each `visibleTo`
 * token — are the CRM's list fields, stamped on every lead write by
 * `crmLeadListFields` (`@aglyn/aglyn`'s CRM app-utils) and backfilled by the
 * CRM's own lane. Under a site the search folds into the scope clause
 * (`scopedSearch`), which the rules prove only for an org-wide member: a
 * collaborator whose reach is some sites keeps the scope clause, and their
 * search is asked as the start of the address beside it
 * (`leadListQueryFor`).
 *
 * Every current lead writer normalizes the address (`normalizeContactEmail`)
 * before `addHostLead` stores it, so Email is an equality on `email`.
 *=========================================*/
const LEAD_EMAIL_FIELD: ListFilterField = {
  column: 'email',
  kind: 'text',
  path: 'email',
  lowerPath: 'email',
  presence: 'always',
  operators: ['equals'],
}

export const LEAD_LIST_QUERY: ListQueryDeclaration = {
  fields: [LEAD_EMAIL_FIELD],
  sorts: contactSorts('Captured'),
  search: { tokensPath: 'searchTokens', scoped: scopedSearch('scopedSearchTokens') },
}

/**
 * The organization's Inbox adds what an unscoped read can ask: the surface
 * that captured the lead and the sites that did. Both are ARRAYS on the
 * lead (`sources`, `capturedByHostIds`, `arrayUnion`ed by `addHostLead`), so
 * each is the query's one array clause — "any of" — and cannot stand beside
 * the search or the other. Under a site the scope clause already holds that
 * one array clause, which is why neither is offered there.
 */
export const ORG_LEAD_LIST_QUERY: ListQueryDeclaration = {
  ...LEAD_LIST_QUERY,
  fields: [
    LEAD_EMAIL_FIELD,
    {
      column: 'sources',
      kind: 'exact',
      path: 'sources',
      tokensPath: 'sources',
      verbatimTokens: true,
      operators: ['isAnyOf'],
    },
    {
      column: 'capturedByHostIds',
      kind: 'exact',
      path: 'capturedByHostIds',
      tokensPath: 'capturedByHostIds',
      verbatimTokens: true,
      operators: ['isAnyOf'],
    },
  ],
}

/**
 * The column a site collaborator's search is asked through: the START of the
 * address, a prefix range on `email`. Not a Filters-panel field — the panel
 * reads the declaration the card shows, and this one rides only on the query.
 */
export const LEAD_ADDRESS_SEARCH_COLUMN = '$addressSearch'

const LEAD_ADDRESS_SEARCH_FIELD: ListFilterField = {
  column: LEAD_ADDRESS_SEARCH_COLUMN,
  kind: 'text',
  path: 'email',
  lowerPath: 'email',
  presence: 'always',
  operators: ['startsWith'],
}

/** The notice a site collaborator's search carries: what it matched, and the order. */
export const LEAD_ADDRESS_SEARCH_NOTICE =
  'Search on this site’s leads matches the start of the address, and lists them by address.'

/**
 * The query a reader may run for the Leads list, and whether its search was
 * asked as an address prefix (AGL-3321).
 *
 * An ORG-WIDE reader's search folds into the scope clause (`scopedSearch`):
 * a query without `visibleTo` is one the rules prove only for them. A reader
 * whose reach is some sites must keep `visibleTo array-contains-any` on the
 * query, which spends its one array clause — so their search is asked as a
 * prefix RANGE on the stored, normalized `email` beside the scope instead,
 * ordered by address (the `visibleTo, email` composite the lead list already
 * carries). Only the first word is asked.
 */
export function leadListQueryFor(
  declaration: ListQueryDeclaration,
  foldsScope: boolean,
  request: ListQueryRequest,
): { declaration: ListQueryDeclaration; request: ListQueryRequest; addressSearch: boolean } {
  if (foldsScope || !declaration.search?.scoped) return { declaration, request, addressSearch: false }
  const word = (request.search ?? []).join(' ').trim().split(/\s+/)[0] ?? ''
  return {
    declaration: {
      ...declaration,
      fields: [...declaration.fields, LEAD_ADDRESS_SEARCH_FIELD],
      search: undefined,
    },
    request: {
      ...request,
      search: [],
      clauses: word
        ? [...request.clauses, { field: LEAD_ADDRESS_SEARCH_COLUMN, op: 'startsWith', value: word }]
        : request.clauses,
    },
    addressSearch: Boolean(word),
  }
}

/** The scope clause a site's lead list always carries, or none on the org's. */
export function leadListBase(scopeTokens: readonly string[] | null): ListQueryFilter[] {
  return scopeTokens ? [{ path: 'visibleTo', op: 'array-contains-any', value: [...scopeTokens] }] : []
}

/** The base's shape for `listQueryIndexes`: the scope clause is an array clause. */
export const LEAD_LIST_BASE_INDEX = [{ path: 'visibleTo', array: true }] as const

export const LEAD_FILTER_HEADERS: Readonly<Record<string, string>> = {
  email: 'Email',
  sources: 'Source',
  capturedByHostIds: 'Site',
}

/**
 * The capture surfaces a Source filter can name. A lead routed from a form
 * is filed as `form:{formId}` — one value per form, so no fixed choice can
 * ask for "every form" and none is offered; the rest are the fixed words the
 * doors write: a booking, a lead added by hand, over the API or from a file,
 * and `signup`, which member sign-ups wrote before they filed a contact.
 */
export const LEAD_SOURCE_OPTIONS: readonly ListFilterOption[] = [
  { value: 'booking', label: 'Booking' },
  { value: 'manual', label: 'Added by hand' },
  { value: 'api', label: 'API' },
  { value: 'import', label: 'Import' },
  { value: 'signup', label: 'Sign-up' },
]

/** How one capture surface reads on a row. */
export function leadSourceLabel(source: string): string {
  if (source === 'form' || source.startsWith('form:')) return 'Form'
  return LEAD_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source
}

/*==========================================
 * FORM SUBMISSIONS — `hosts/{hostId}/formSubmissions` under a site, and the
 * `formSubmissions` collection group narrowed to `orgId` on the
 * organization's Inbox (the rules admit that group read only so narrowed).
 * Newest first.
 *
 * `senderTokens` and `searchTokens` are `messageSearchFields` of the
 * message, stamped by the submit route — the collection's only creator —
 * and by `backfill-form-submission-filters.mjs` on the rows before it; a
 * message's values never change after it arrives. `read` is a boolean on
 * every row: the route writes `false`, the reader and the API flip it, and
 * the same backfill stamps `false` on a row without one. `hostId` and
 * `orgId` are stamped by the route and frozen by the rules.
 *
 * ⛔ The form's NAME is not searched. The row keeps the name the form had
 * when the message arrived, and a rename would leave the search finding
 * rows by a name the reader no longer sees. Form is a filter by id instead,
 * which survives a rename.
 *=========================================*/
const SUBMISSION_FIELDS: readonly ListFilterField[] = [
  {
    column: 'from',
    kind: 'text',
    path: 'senderTokens',
    tokensPath: 'senderTokens',
    operators: ['contains'],
  },
  { column: 'read', kind: 'boolean', path: 'read', operators: ['equals'] },
]

/** Form: offered where a site's forms are read (not across every site). */
const FORM_FIELD: ListFilterField = {
  column: 'formId',
  kind: 'exact',
  path: 'formId',
  operators: ['equals'],
}

/** Site: the organization's Inbox only, where a row can be any site's. */
const SITE_FIELD: ListFilterField = {
  column: 'hostId',
  kind: 'exact',
  path: 'hostId',
  operators: ['equals', 'isAnyOf'],
}

/*
 * Received orders the query either way, and Read either way — unread first
 * (AGL-3680); both are on every row (see above). The headers past the
 * default are `alone`, served while nothing narrows the list past its scope.
 * From, Site and Message are drawn from the message, so they sort the page.
 */
const SUBMISSION_SORTS: ListQuerySort[] = [
  { path: 'createdAt', direction: 'desc', column: 'createdAt', label: 'Received' },
  { path: 'createdAt', direction: 'asc', column: 'createdAt', label: 'Received', alone: true },
  { path: 'read', direction: 'asc', column: 'read', label: 'Read', alone: true },
  { path: 'read', direction: 'desc', column: 'read', label: 'Read', alone: true },
]
const SUBMISSION_SEARCH = { tokensPath: 'searchTokens' }

/** A site's Inbox. */
export const SUBMISSION_LIST_QUERY: ListQueryDeclaration = {
  fields: [...SUBMISSION_FIELDS, FORM_FIELD],
  sorts: SUBMISSION_SORTS,
  search: SUBMISSION_SEARCH,
}

/** A card already narrowed to one form, where Form has nothing to pick. */
export const FORM_SCOPED_SUBMISSION_LIST_QUERY: ListQueryDeclaration = {
  fields: SUBMISSION_FIELDS,
  sorts: SUBMISSION_SORTS,
  search: SUBMISSION_SEARCH,
}

/** Every site's, on the organization's Inbox. */
export const ORG_SUBMISSION_LIST_QUERY: ListQueryDeclaration = {
  fields: [...SUBMISSION_FIELDS, SITE_FIELD],
  sorts: SUBMISSION_SORTS,
  search: SUBMISSION_SEARCH,
}

/** The organization's Inbox's scope, which the rules require. */
export const orgSubmissionBase = (orgId: string): ListQueryFilter[] => [
  { path: 'orgId', op: '==', value: orgId },
]

/** A form-scoped card's scope. */
export const formSubmissionBase = (formId: string): ListQueryFilter[] => [
  { path: 'formId', op: '==', value: formId },
]

export const SUBMISSION_FILTER_HEADERS: Readonly<Record<string, string>> = {
  from: 'From',
  read: 'Read',
  formId: 'Form',
  hostId: 'Site',
}

/** Read is the stored boolean, by the words a reader uses for it. */
export const SUBMISSION_READ_OPTIONS: readonly ListFilterOption[] = [
  { value: 'false', label: 'Unread' },
  { value: 'true', label: 'Read' },
]
