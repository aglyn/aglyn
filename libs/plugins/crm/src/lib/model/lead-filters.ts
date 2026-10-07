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
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_OPEN_STATUSES,
  CRM_LEAD_SCOPED_CAMPAIGNS_FIELD,
  CRM_LEAD_SOURCE_DIRECTION_FIELD,
  CRM_LEAD_STATUSES,
  type CrmLeadStatus,
  type CrmPicklist,
  crmLeadSourceKey,
  crmPicklistKey,
} from '@aglyn/aglyn/app-utils/crm'
import { EMAIL_STATE_LABELS, EMAIL_STATE_STATUSES, type EmailStateStatus } from '@aglyn/aglyn/app-utils/email-state'
import type { CrmViewFilterClause } from '@aglyn/aglyn/app-utils/crm'
import { SCOPED_SEARCH_JOIN } from '@aglyn/aglyn/app-utils/name-search'
import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import { type ListGridFilterCodec, listSelectCodec } from '@aglyn/shared-util-tools/list-query/list-filter-codecs'
import type { ListQueryDeclaration, ListQuerySort } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  CRM_LIST_SEARCH,
  type CrmClauseAsked,
  crmAnyOf,
  crmClauseValues,
  crmSelectField,
} from './crm-list-query'
import {
  isLeadSourceDirection,
  LEAD_SOURCE_DIRECTION_LABELS,
  LEAD_SOURCE_DIRECTIONS,
} from './lead-source-direction'

/**
 * What the Leads section's `Show` control offers (AGL-2608): the two
 * aggregate views and each status on its own. `open` is the default — the
 * list opens on the work — asked of the query as
 * `status in [new, nurturing, working]`,
 * which every lead answers because every lead writer stores a status, `new`
 * for one nobody has touched (`crmLeadListFields`, AGL-3321).
 */
export type LeadFilter = 'open' | 'all' | CrmLeadStatus

export const LEAD_FILTERS: readonly LeadFilter[] = [
  'open',
  'new',
  'nurturing',
  'working',
  'qualified',
  'unqualified',
  'all',
]

export const LEAD_FILTER_LABELS: Record<LeadFilter, string> = {
  open: 'Open',
  all: 'All',
  new: CRM_LEAD_STATUS_LABELS.new,
  nurturing: CRM_LEAD_STATUS_LABELS.nurturing,
  working: CRM_LEAD_STATUS_LABELS.working,
  qualified: CRM_LEAD_STATUS_LABELS.qualified,
  unqualified: CRM_LEAD_STATUS_LABELS.unqualified,
}

/**
 * The Leads section's `Email` control (AGL-3245): every lead, the ones a
 * member must not email — any verdict but `ok` — the ones nothing has been
 * said about, or one verdict on its own. Beside `Show`, not inside it: a
 * bounce does not move a lead out of Open, and a queue of bounced leads is
 * a queue of people to reach some other way.
 */
export type LeadEmailFilter = 'any' | 'problem' | 'none' | EmailStateStatus

export const LEAD_EMAIL_FILTERS: readonly LeadEmailFilter[] = [
  'any',
  'problem',
  ...EMAIL_STATE_STATUSES,
  'none',
]

export const LEAD_EMAIL_FILTER_LABELS: Record<LeadEmailFilter, string> = {
  any: 'Any',
  problem: 'Cannot be emailed',
  none: 'Nothing known',
  ...EMAIL_STATE_LABELS,
}

/**
 * The `Lead source` control's "no lead source" choice (AGL-3298). Held in
 * the saved view as an `isEmpty` clause, never as this string; it is only
 * the select's own value for the choice.
 */
export const LEAD_SOURCE_FILTER_NONE = '\u0000none'

/*==========================================
 * THE LEADS GRID'S FILTERS (AGL-3313).
 *
 * The Show, Email, Campaign and Lead source dropdowns became columns of the
 * grid's own Filters panel. Their clauses keep the shape the dropdowns
 * stored, so every saved view of leads reads as it did:
 *
 *   status       `equals <filter>`; none at all is Open, `all` is every lead
 *   emailState   `equals <filter>`
 *   campaignIds  `contains <campaign id>`
 *   leadSource   `equals <label>`, or `isEmpty` for the leads holding none
 *   leadSourceDirection   `equals inbound|outbound` (AGL-3511): every lead
 *                whose lead source is a value of that group
 *   industry, rating   `equals <key>` (AGL-3513): a value of the org's
 *                Industry or Rating list, by the key the query compares
 *
 * Every one is asked of the Leads query (AGL-3321) through the field a
 * writer stores for it — see {@link leadQueryClause}.
 *=========================================*/

/** The fields the grid's panel offers on Leads. */
export const LEAD_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'status', kind: 'exact', path: 'status', operators: ['equals', 'isAnyOf'] },
  { column: 'emailState', kind: 'exact', path: 'emailState', operators: ['equals', 'isAnyOf'] },
  { column: 'ownerUid', kind: 'exact', path: 'ownerUid', operators: ['equals', 'isAnyOf'] },
  { column: 'leadSource', kind: 'exact', path: 'leadSource', operators: ['equals', 'isAnyOf'] },
  {
    column: 'leadSourceDirection',
    kind: 'exact',
    path: 'leadSourceDirection',
    operators: ['equals', 'isAnyOf'],
  },
  { column: 'campaignIds', kind: 'exact', path: 'campaignIds', operators: ['equals'] },
  // Salesforce's Industry and Rating (AGL-3513), the lists companies keep.
  { column: 'industry', kind: 'exact', path: 'industry', operators: ['equals', 'isAnyOf'] },
  { column: 'rating', kind: 'exact', path: 'rating', operators: ['equals', 'isAnyOf'] },
]

/**
 * The lead picklist columns the list filters by (AGL-3513), each with the
 * list its choices come from: a choice's value is the KEY the query
 * compares, its caption the label.
 */
export const LEAD_PICKLIST_FILTERS = [
  { column: 'industry', picklistId: 'industry', header: 'Industry' },
  { column: 'rating', picklistId: 'rating', header: 'Rating' },
] as const

/** What each filter field reads as on a chip. */
export const LEAD_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  emailState: 'Email',
  ownerUid: 'Owner',
  leadSource: 'Lead source',
  leadSourceDirection: 'Lead source direction',
  campaignIds: 'Campaign',
  industry: 'Industry',
  rating: 'Rating',
}

/** The choices for Status: Open (new, nurturing or working) and each status on its own. */
export const LEAD_STATUS_FILTER_OPTIONS = LEAD_FILTERS.filter(
  (option) => option !== 'all',
).map((option) => ({
  value: option,
  label: option === 'open' ? 'Open (new, nurturing or working)' : LEAD_FILTER_LABELS[option],
}))

/** The choices for Email: every verdict, plus the two aggregates. */
export const LEAD_EMAIL_FILTER_OPTIONS = LEAD_EMAIL_FILTERS.filter(
  (option) => option !== 'any',
).map((option) => ({ value: option, label: LEAD_EMAIL_FILTER_LABELS[option] }))

/** The choices for Lead source direction: each group of the Lead source picklist. */
export const LEAD_SOURCE_DIRECTION_FILTER_OPTIONS = LEAD_SOURCE_DIRECTIONS.map((direction) => ({
  value: direction,
  label: LEAD_SOURCE_DIRECTION_LABELS[direction],
}))

/**
 * The Status choices as an org reads them (AGL-3512): still one choice per
 * MEANING — the query asks `status` — each named by the org's values of that
 * meaning, so a list that keeps "Contacted" and "Meeting set" as Working
 * reads "Working: Contacted, Meeting set".
 */
export function leadStatusFilterOptions(
  picklist: CrmPicklist,
): Array<{ value: string; label: string }> {
  const named = (status: CrmLeadStatus): string => {
    const labels = picklist.values
      .filter((value) => value.meaning === status && value.active)
      .map((value) => value.label)
    const meaning = picklistMeaningName(status)
    if (!labels.length) return meaning
    if (labels.length === 1 && labels[0] === meaning) return meaning
    return `${meaning}: ${labels.join(', ')}`
  }
  return LEAD_FILTERS.filter((option) => option !== 'all').map((option) => ({
    value: option,
    label: option === 'open' ? 'Open (new, nurturing or working)' : named(option),
  }))
}

const picklistMeaningName = (status: CrmLeadStatus): string => CRM_LEAD_STATUS_LABELS[status]

const STATUS_OPEN: CrmViewFilterClause = { field: 'status', op: 'equals', value: 'open' }
const STATUS_ALL: CrmViewFilterClause = { field: 'status', op: 'equals', value: 'all' }

/**
 * The clauses the grid shows for a view's stored ones. A stored list with
 * no status clause is Open, which the list opened on before views existed,
 * so it is shown as the clause it means; `status equals all` is every lead
 * and so no clause at all.
 */
export function leadClausesForGrid(
  stored: readonly CrmViewFilterClause[],
): CrmViewFilterClause[] {
  const status = stored.find((clause) => clause.field === 'status')
  if (!status) return [STATUS_OPEN, ...stored]
  if (status.op === 'equals' && status.value === 'all') {
    return stored.filter((clause) => clause.field !== 'status')
  }
  return [...stored]
}

/** The inverse of {@link leadClausesForGrid}: what the view stores. */
export function leadClausesToStore(
  shown: readonly CrmViewFilterClause[],
): CrmViewFilterClause[] {
  const status = shown.find((clause) => clause.field === 'status')
  if (!status) return [...shown, STATUS_ALL]
  if (status.op === 'equals' && status.value === 'open') {
    return shown.filter((clause) => clause.field !== 'status')
  }
  return [...shown]
}

/** Campaign clauses were stored as `contains`; the panel's select says `is`. */
export const LEAD_CAMPAIGN_CODEC: ListGridFilterCodec = {
  toItem: (clause) =>
    clause.op === 'contains' || clause.op === 'equals'
      ? { operator: 'is', value: clause.value }
      : null,
  toClause: (item) => {
    const clause = listSelectCodec.toClause(item)
    return clause && clause.op === 'equals' ? { ...clause, op: 'contains' } : null
  },
}

/** "No lead source" is an `isEmpty` clause, shown as a choice of the select. */
export const LEAD_SOURCE_CODEC: ListGridFilterCodec = {
  toItem: (clause) =>
    clause.op === 'isEmpty'
      ? { operator: 'is', value: LEAD_SOURCE_FILTER_NONE }
      : listSelectCodec.toItem(clause),
  toClause: (item) => {
    const clause = listSelectCodec.toClause(item)
    if (clause?.op === 'equals' && clause.value === LEAD_SOURCE_FILTER_NONE) {
      return { field: clause.field, op: 'isEmpty', value: '' }
    }
    return clause
  },
}

/** The Leads fields whose stored clauses translate their own way. */
export const LEAD_FILTER_CODECS: Readonly<Record<string, ListGridFilterCodec>> = {
  campaignIds: LEAD_CAMPAIGN_CODEC,
  leadSource: LEAD_SOURCE_CODEC,
}

/*==========================================
 * THE LEADS QUERY (AGL-3321).
 *
 * `orgs/{orgId}/leads`, newest seen first, under a site narrowed by the
 * `visibleTo` scope clause. Each grid clause is asked through a field every
 * lead writer stores (`crmLeadListFields` in `@aglyn/aglyn`):
 *
 *   status       `status`, stored `new` on a lead nobody has touched, so
 *                Open is `status in [new, nurturing, working]`
 *   emailState   `emailStatus`, the verdict's status or `none`; "Cannot be
 *                emailed" is every verdict but `ok`
 *   leadSource   `leadSourceKey`, the label as the picklist compares it, or
 *                `null` for none
 *   leadSourceDirection   `leadSourceDirection` (AGL-3577), the group of
 *                the lead's value in the org's list, stamped by the writers
 *                from that list and rewritten on every lead holding a value
 *                the list regroups — so one equality asks a group however
 *                many values it holds
 *   ownerUid     as stored
 *   industry, rating   `industryKey`, `ratingKey` (AGL-3513), each label
 *                as the picklist compares it
 *   campaignIds  `array-contains` on the lead's own campaigns; under a site,
 *                `scopedCampaignIds` — the campaign behind each of the
 *                site's scope tokens — which stands in the scope clause's
 *                place, so the one array clause answers both
 *
 * and the search box reads `searchTokens` — word prefixes of the name,
 * address, company, title and tags. Every equality rides one
 * `(field, lastSeenAtMs DESC)` composite; the campaign and the search are
 * array clauses, so the two do not stand together (nor under a site, where
 * the scope clause is the query's one array clause, save the search, which
 * folds into it for a reader who may drop it).
 *=========================================*/

/** The one order the Leads list takes: newest seen first. */
export const LEAD_LIST_SORTS: readonly ListQuerySort[] = [{ path: 'lastSeenAtMs', direction: 'desc' }]

/** The fields the Leads query asks — each a stored field, as named. */
export const LEAD_QUERY_FIELDS: readonly ListFilterField[] = [
  crmSelectField('status'),
  crmSelectField('emailStatus'),
  crmSelectField('ownerUid'),
  {
    column: 'leadSourceKey',
    kind: 'exact',
    path: 'leadSourceKey',
    presence: 'nullable',
    operators: ['equals', 'isAnyOf', 'isEmpty'],
  },
  {
    column: 'campaignIds',
    kind: 'exact',
    path: 'campaignIds',
    tokensPath: 'campaignIds',
    operators: ['contains'],
  },
  // The lead source's group (AGL-3577), as stamped on the lead.
  crmSelectField(CRM_LEAD_SOURCE_DIRECTION_FIELD),
  // Industry and Rating (AGL-3513), by the key each writer stores.
  crmSelectField('industryKey'),
  crmSelectField('ratingKey'),
  {
    // A campaign under a site: the lead's campaigns behind its scope.
    column: CRM_LEAD_SCOPED_CAMPAIGNS_FIELD,
    kind: 'exact',
    path: CRM_LEAD_SCOPED_CAMPAIGNS_FIELD,
    tokensPath: CRM_LEAD_SCOPED_CAMPAIGNS_FIELD,
    operators: ['isAnyOf'],
  },
]

export const LEAD_LIST_DECLARATION: ListQueryDeclaration = {
  fields: LEAD_QUERY_FIELDS,
  sorts: LEAD_LIST_SORTS,
  search: CRM_LIST_SEARCH,
}

/**
 * A collaborator's search (see `prefixSearch` in `useCrmListQuery`): the
 * start of the address, beside the scope clause — the `(visibleTo, email)`
 * composite the Inbox's leads list reads too.
 */
export const LEAD_PREFIX_SEARCH = {
  field: {
    column: 'email',
    kind: 'text',
    path: 'email',
    lowerPath: 'email',
    presence: 'always',
    operators: ['startsWith'],
  } satisfies ListFilterField,
  notice: 'Search matches the start of a lead’s address for access limited to specific sites.',
}

/** Whether an asked clause stands in for the scope clause: a campaign behind the site's scope. */
export const leadClauseImpliesScope = (clause: ListFilterRequest): boolean =>
  clause.field === CRM_LEAD_SCOPED_CAMPAIGNS_FIELD

/** The verdicts a member must not email to: every one but `ok`. */
const EMAIL_PROBLEMS = EMAIL_STATE_STATUSES.filter((status) => status !== 'ok')

/** Who is asking, for the one clause whose shape depends on it: the Campaign. */
export interface LeadQueryReader {
  /** The site's scope tokens, or `null` at the organization level. */
  scopeTokens: readonly string[] | null
  /** Whether the reader may run a query without the scope clause (`useCrmFoldsScope`). */
  foldsScope: boolean
}

const ORG_READER: LeadQueryReader = { scopeTokens: null, foldsScope: true }

/**
 * One grid clause as the clause the Leads query asks — see the block above.
 * A value the list does not know is refused by name rather than dropped, so
 * a stored view that names a retired choice says so.
 */
export function leadQueryClause(
  clause: CrmViewFilterClause | ListFilterRequest,
  reader: LeadQueryReader = ORG_READER,
): CrmClauseAsked {
  const values = crmClauseValues(clause)
  switch (clause.field) {
    case 'status': {
      const statuses: string[] = []
      for (const value of values) {
        if (value === 'open') statuses.push(...CRM_LEAD_OPEN_STATUSES)
        else if ((CRM_LEAD_STATUSES as readonly string[]).includes(value)) statuses.push(value)
        else return { refused: `${value} is not a lead status` }
      }
      return crmAnyOf('status', statuses)
    }
    case 'emailState': {
      const keys: string[] = []
      for (const value of values) {
        if (value === 'problem') keys.push(...EMAIL_PROBLEMS)
        else if (value === 'none') keys.push('none')
        else if ((EMAIL_STATE_STATUSES as readonly string[]).includes(value)) keys.push(value)
        else return { refused: `${value} is not an email verdict` }
      }
      return crmAnyOf('emailStatus', keys)
    }
    case 'leadSource': {
      if (clause.op === 'isEmpty' || (values.length === 1 && values[0] === LEAD_SOURCE_FILTER_NONE)) {
        return { field: 'leadSourceKey', op: 'isEmpty', value: '' }
      }
      if (values.includes(LEAD_SOURCE_FILTER_NONE)) {
        return { refused: '"No lead source" cannot be picked beside a value' }
      }
      const keys = values.map((value) => crmLeadSourceKey(value)).filter((key): key is string => Boolean(key))
      return crmAnyOf('leadSourceKey', keys)
    }
    case 'leadSourceDirection': {
      for (const value of values) {
        if (!isLeadSourceDirection(value)) return { refused: `${value} is not a lead source direction` }
      }
      return crmAnyOf(CRM_LEAD_SOURCE_DIRECTION_FIELD, values)
    }
    case 'ownerUid':
      return crmAnyOf('ownerUid', values)
    case 'industry':
    case 'rating': {
      // A choice is the key; a label typed into a stored view keys the same way.
      const keys = values.map((value) => crmPicklistKey(value)).filter((key): key is string => Boolean(key))
      return crmAnyOf(clause.field === 'industry' ? 'industryKey' : 'ratingKey', keys)
    }
    case 'campaignIds': {
      if (values.length !== 1) return { refused: 'pick one campaign' }
      if (!reader.scopeTokens) return { field: 'campaignIds', op: 'contains', value: values[0] }
      if (!reader.foldsScope) {
        return {
          refused:
            'your access is limited to specific sites, which this filter cannot be combined with — an organization administrator can use it',
        }
      }
      return {
        field: CRM_LEAD_SCOPED_CAMPAIGNS_FIELD,
        op: 'isAnyOf',
        value: reader.scopeTokens.map((token) => `${token}${SCOPED_SEARCH_JOIN}${values[0]}`).join(','),
      }
    }
    default:
      return { refused: 'this list does not filter by that' }
  }
}

/**
 * The query shape the Leads list can send beyond its own declaration, for
 * the index pin (AGL-3321): a collaborator's address prefix beside the
 * equalities they may set.
 */
export function leadIndexShapes(): ListQueryDeclaration[] {
  const equalities = LEAD_QUERY_FIELDS.filter((field) => !field.tokensPath)
  return [{ fields: [LEAD_PREFIX_SEARCH.field, ...equalities], sorts: [] }]
}
