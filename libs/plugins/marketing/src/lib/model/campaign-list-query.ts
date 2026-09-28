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

import { nameSearchKey, nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import type {
  ListQueryDeclaration,
  ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT THE MARKETING LISTS ASK FIRESTORE (AGL-3321).
 *
 * Three tables read the org's campaign collections — the Campaigns list, a
 * campaign's own emails, and the Emails list — and every clause their
 * Filters panels offer, and their search boxes, is a predicate on ONE query,
 * newest first, paged by that query. Nothing is matched over the rows a read
 * happened to hold. Each field is here because a query can serve it.
 *
 * ## The fields the writers stamp
 *
 * A SEND (`orgs/{orgId}/campaigns`) carries:
 *
 *   `createdAtMs`      when the record was minted — the one date on every
 *                      send (a sent one has `sentAt`, a scheduled one
 *                      `sendAtMs`, a draft neither), so the order;
 *   `subjectTokens`    the subject's word prefixes, for search and
 *                      "Subject contains";
 *   `emailCampaignId`  the container it is filed under, or `null` for a
 *                      single send — stored null rather than left out,
 *                      because a query can ask for `== null` and can never
 *                      ask for a field that is missing.
 *
 * A CONTAINER (`orgs/{orgId}/emailCampaigns`) carries `createdAtMs`,
 * `nameTokens` (the org hub's search) and `nameLower` (a site hub's search,
 * as a prefix range — below).
 *
 * Every writer stamps them through the two helpers below, and
 * `tools/scripts/backfill-campaign-list-fields.mjs` stamps the records
 * written before them.
 *
 * ## What a site hub asks
 *
 * A send is sent AS one site, so a site hub's sends are `hostId == {site}` —
 * an equality, which merges with every other clause on single-field
 * indexes and leaves the query's one array clause for search. The security
 * rules admit that read for the site's collaborators (a send's `hostId` is
 * the site its `visibleTo` names). A container is placed on SEVERAL sites,
 * so its scope stays `visibleTo array-contains-any [org, host:{site}]` —
 * the query's one array clause, and the only one the rules can prove for a
 * site collaborator. So a site hub's campaign search is not a token lookup:
 * it is a PREFIX RANGE on `nameLower` beside the scope
 * (`campaignSiteSearchClause`), which orders the page by name while it
 * applies, and the list says search matches the start of a name. Folding
 * the word into the scope clause through scoped tokens would be refused by
 * the rules for such a reader: that query proves nothing about `visibleTo`.
 *
 * ## What is not offered
 *
 * - A send's STATE (Sending, Stopped, …) is derived from its counters at
 *   read time (`campaignSendDisplay`); no query can ask it. Its stored
 *   `status` is offered instead.
 * - A campaign's WINDOW (Upcoming, Running, Ended) is derived from its dates
 *   against the clock; "running" is a range on two fields. Not offered.
 * - The site NAME a row shows is not stored on the record; the Site filter
 *   asks by the site's id, and search reads the subject or the name only.
 * - Ranges: ONE, on `createdAtMs`, the field every list is ordered by — so
 *   it needs no order of its own and no index beyond the ones above.
 */

/** The send's subject, as word prefixes. */
export const CAMPAIGN_SEND_SUBJECT_TOKENS = 'subjectTokens'
/** The container's name, as word prefixes. */
export const CAMPAIGN_NAME_TOKENS = 'nameTokens'
/** The container's name, lower-cased whole, for a site hub's prefix search. */
export const CAMPAIGN_NAME_LOWER = 'nameLower'
/** The one date on every send and container, and every list's order. */
export const CAMPAIGN_LIST_ORDER_FIELD = 'createdAtMs'

/**
 * The Campaign filter's value for an email filed under no campaign. An
 * empty value reads as "no value" to the panel, so the choice needs one of
 * its own; the query asks `emailCampaignId == null` for it.
 */
export const SINGLE_SEND_FILTER_VALUE = '__single__'

/**
 * The search field a send carries beside its `subject`, stamped by every
 * write that sets the subject.
 */
export function campaignSendSearchFields(subject: unknown): {
  subjectTokens: string[]
} {
  return {
    subjectTokens: nameSearchTokens(typeof subject === 'string' ? subject : ''),
  }
}

/**
 * The search fields a container carries beside its `name`, stamped by every
 * write that sets the name.
 */
export function campaignContainerSearchFields(name: unknown): {
  nameLower: string
  nameTokens: string[]
} {
  const text = typeof name === 'string' ? name : ''
  return { nameLower: nameSearchKey(text), nameTokens: nameSearchTokens(text) }
}

const ORDER = [{ path: CAMPAIGN_LIST_ORDER_FIELD, direction: 'desc' as const }]

const CREATED: ListFilterField = {
  column: CAMPAIGN_LIST_ORDER_FIELD,
  kind: 'date',
  path: CAMPAIGN_LIST_ORDER_FIELD,
  storedAs: 'millis',
  operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
}

const SUBJECT: ListFilterField = {
  column: 'subject',
  kind: 'text',
  path: 'subject',
  tokensPath: CAMPAIGN_SEND_SUBJECT_TOKENS,
  operators: ['contains'],
}

const STATUS: ListFilterField = {
  column: 'status',
  kind: 'exact',
  path: 'status',
  operators: ['equals', 'isAnyOf'],
}

/**
 * The stored statuses a send can hold, for the Status filter. Stored
 * strings, not the State column's display states: an email between batches
 * is stored `scheduled` and SHOWN as Sending, which is why the filter is
 * headed Status and not State.
 */
export const CAMPAIGN_SEND_STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'failed', label: 'Failed' },
]

/**
 * The Emails list: every send, under a site or across the org.
 *
 * `site` is the org hub's only — under a site every row is that site's.
 */
export function campaignEmailsListQuery(orgHub: boolean): ListQueryDeclaration {
  return orgHub ? EMAILS_ORG : EMAILS_SITE
}

const EMAIL_CAMPAIGN: ListFilterField = {
  column: 'emailCampaignId',
  kind: 'exact',
  path: 'emailCampaignId',
  presence: 'nullable',
  // `is` only: "Single send" is `== null`, which cannot sit in an `in`
  // beside campaign ids.
  operators: ['equals', 'isEmpty'],
}

const EMAILS_SITE: ListQueryDeclaration = {
  fields: [SUBJECT, STATUS, EMAIL_CAMPAIGN, CREATED],
  sorts: ORDER,
  search: { tokensPath: CAMPAIGN_SEND_SUBJECT_TOKENS },
}
const EMAILS_ORG: ListQueryDeclaration = {
  ...EMAILS_SITE,
  fields: [
    ...EMAILS_SITE.fields,
    { column: 'site', kind: 'exact', path: 'hostId', operators: ['equals', 'isAnyOf'] },
  ],
}

/** A campaign's own emails: the container is the query's base. */
export const CAMPAIGN_EMAILS_QUERY: ListQueryDeclaration = {
  fields: [SUBJECT, STATUS, CREATED],
  sorts: ORDER,
  search: { tokensPath: CAMPAIGN_SEND_SUBJECT_TOKENS },
}

/**
 * The Campaigns list's CAMPAIGNS: the containers. The columns are the
 * table's (`name`, `listIds`, `sitesLabel`); Lists and Sites are the org
 * hub's only — under a site the scope clause is the query's one array
 * clause, so an any-of on another array could never be served beside it.
 */
export function campaignContainersListQuery(orgHub: boolean): ListQueryDeclaration {
  return orgHub ? CONTAINERS_ORG : CONTAINERS_SITE
}

const CONTAINER_NAME: ListFilterField = {
  column: 'name',
  kind: 'text',
  path: 'name',
  tokensPath: CAMPAIGN_NAME_TOKENS,
  operators: ['contains'],
}
/** A site hub's Campaign field: the name's start, a range beside the scope. */
const CONTAINER_NAME_PREFIX: ListFilterField = {
  column: 'name',
  kind: 'text',
  path: 'name',
  lowerPath: CAMPAIGN_NAME_LOWER,
  operators: ['startsWith'],
}
const CONTAINERS_SITE: ListQueryDeclaration = {
  fields: [CONTAINER_NAME_PREFIX, CREATED],
  sorts: ORDER,
}
const CONTAINERS_ORG: ListQueryDeclaration = {
  sorts: ORDER,
  search: { tokensPath: CAMPAIGN_NAME_TOKENS },
  fields: [
    CONTAINER_NAME,
    { column: 'listIds', kind: 'exact', path: 'listIds', tokensPath: 'listIds', operators: ['isAnyOf'] },
    // Asked by scope token — `org` is "every site", `host:{id}` one site.
    { column: 'sitesLabel', kind: 'exact', path: 'visibleTo', tokensPath: 'visibleTo', operators: ['isAnyOf'] },
    CREATED,
  ],
}

/**
 * The Campaigns list's SINGLE SENDS: sends filed under no campaign, drawn
 * in the same table. The `name` column is the send's subject; `sitesLabel`
 * is the site it was sent as, on the org hub.
 */
export function campaignSingleSendsListQuery(orgHub: boolean): ListQueryDeclaration {
  return orgHub ? SINGLE_ORG : SINGLE_SITE
}

const SINGLE_NAME: ListFilterField = { ...SUBJECT, column: 'name' }
const SINGLE_SITE: ListQueryDeclaration = {
  fields: [SINGLE_NAME, CREATED],
  sorts: ORDER,
  search: { tokensPath: CAMPAIGN_SEND_SUBJECT_TOKENS },
}
const SINGLE_ORG: ListQueryDeclaration = {
  ...SINGLE_SITE,
  fields: [
    SINGLE_NAME,
    { column: 'sitesLabel', kind: 'exact', path: 'hostId', operators: ['equals', 'isAnyOf'] },
    CREATED,
  ],
}

/** A site hub's sends: the ones sent as it. Nothing on the org hub. */
export function campaignSendsScope(hostId: string | null): ListQueryFilter[] {
  return hostId ? [{ path: 'hostId', op: '==', value: hostId }] : []
}

/** Said above a site hub's campaigns while its search is applied. */
export const CAMPAIGN_SITE_SEARCH_NOTICE =
  'Search on a site’s campaigns matches the start of a campaign’s name.'

/**
 * A site hub's campaign search, as the clause its query can serve: the typed
 * words as "Campaign starts with", or null when nothing was typed. The list
 * passes it among its clauses and no search words — see the file header for
 * why a site's search is a prefix range and not a token lookup.
 */
export function campaignSiteSearchClause(
  words: readonly string[],
): ListFilterClause | null {
  const typed = words.map((word) => word.trim()).filter(Boolean).join(' ')
  return typed ? { field: 'name', op: 'startsWith', value: typed } : null
}

/** A site hub's containers: the ones placed on every site or on it. */
export function campaignContainersScope(hostId: string | null): ListQueryFilter[] {
  return hostId
    ? [{ path: 'visibleTo', op: 'array-contains-any', value: scopeTokensForHost(hostId) }]
    : []
}

/** The sends filed under no campaign. */
export const SINGLE_SENDS_BASE: ListQueryFilter = {
  path: 'emailCampaignId',
  op: '==',
  value: null,
}

/**
 * The Campaign filter's clauses as the query asks them: "Single send" is
 * `emailCampaignId == null`, which the grammar spells `isEmpty`. The chips
 * keep reading the clause as the reader set it.
 */
export function emailCampaignQueryClauses(
  clauses: readonly ListFilterClause[],
): ListFilterClause[] {
  return clauses.map((clause) =>
    clause.field === 'emailCampaignId' &&
    clause.op === 'equals' &&
    clause.value === SINGLE_SEND_FILTER_VALUE
      ? { ...clause, op: 'isEmpty', value: '' }
      : clause,
  )
}
