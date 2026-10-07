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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  CRM_COLLECTIONS,
  CRM_CONTACT_VIEW_FIELDS,
} from '@aglyn/aglyn/app-utils/crm'
import type { ListFilterField, ListFilterRequest } from '@aglyn/shared-util-tools/list-query/list-filter'
import type { ListQueryPlan } from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  COMPANY_LIST_DECLARATION,
  COMPANY_LIST_FILTER_FIELDS,
  COMPANY_PREFIX_SEARCH,
} from '../lib/constants/company-filters'
import {
  CONTACT_LIST_DECLARATION,
  CONTACT_LIST_FILTER_FIELDS,
  CONTACT_LIST_FILTER_HEADERS,
  CONTACT_PREFIX_SEARCH,
  contactClauseImpliesScope,
  contactQueryClause,
  contactSoloClause,
} from '../lib/constants/contact-filters'
import {
  DEAL_LIST_DECLARATION,
  DEAL_LIST_FILTER_FIELDS,
  DEAL_PREFIX_SEARCH,
  dealPipelineBase,
  dealQueryClause,
} from '../lib/constants/deal-filters'
import {
  type CrmAskedClauses,
  type CrmListAsk,
  crmAskClauses,
  crmListAsk,
  crmListPlanReadBack,
  crmQueryRefusals,
} from '../lib/model/crm-list-query'
import { CRM_NEXT_ACTIVITY_FILTER_HEADER, CRM_NO_NEXT_ACTIVITY_CLAUSE } from '../lib/model/crm-next-activity'
import {
  LEAD_FILTER_LABELS,
  LEAD_FILTERS,
  LEAD_LIST_DECLARATION,
  LEAD_LIST_FILTER_FIELDS,
  LEAD_LIST_FILTER_HEADERS,
  LEAD_PREFIX_SEARCH,
  type LeadFilter,
  leadClauseImpliesScope,
  leadQueryClause,
} from '../lib/model/lead-filters'
import type { CrmMobileScope } from './crm-mobile-scope'

/*==========================================
 * THE FOUR LISTS, ON THE CONSOLE'S QUERIES (AGL-3622).
 *
 * Each list is the console section's own query: the stored clauses a chip
 * sets are asked through the section's translator (`leadQueryClause`,
 * `contactQueryClause`, `dealQueryClause`), and `crmListAsk` puts the scope
 * clause, the search and every clause on ONE Firestore query, exactly as
 * `useCrmListQuery` does on the web — so the app is served by the same
 * composite indexes and proven by the same rules. What a query cannot hold
 * is refused by name above the list, never matched over the loaded rows.
 *
 * The chips are the main filters each console section offers: a lead's
 * status (Open by default, as the Leads section opens) and its owner; a
 * contact's stage and owner (a holder's facet, so an org-wide reader's);
 * a company's owner and "No next activity"; a deal's status in a pipeline.
 *=========================================*/

export type CrmListKind = 'leads' | 'contacts' | 'companies' | 'deals'

/** In the console rail's order. */
export const CRM_LIST_KINDS: readonly CrmListKind[] = ['contacts', 'leads', 'companies', 'deals']

export const CRM_LIST_LABELS: Readonly<Record<CrmListKind, string>> = {
  leads: 'Leads',
  contacts: 'Contacts',
  companies: 'Companies',
  deals: 'Deals',
}

/** The Firestore collection under `orgs/{orgId}` each list reads. */
export const CRM_LIST_COLLECTIONS: Readonly<Record<CrmListKind, string>> = {
  leads: 'leads',
  contacts: 'contacts',
  companies: CRM_COLLECTIONS.companies,
  deals: CRM_COLLECTIONS.deals,
}

export function isCrmListKind(value: unknown): value is CrmListKind {
  return typeof value === 'string' && (CRM_LIST_KINDS as readonly string[]).includes(value)
}

/** One chip of a list's status row. */
export interface CrmChoice {
  value: string
  label: string
}

/** The value of the "every record" choice on each status row. */
export const CRM_ALL = 'all'

/** Each list's status row, first choice the default — the console section's own opening view. */
export const CRM_STATUS_CHOICES: Readonly<Record<CrmListKind, readonly CrmChoice[]>> = {
  // The Leads section opens on Open (new, nurturing or working).
  leads: LEAD_FILTERS.map((filter) => ({ value: filter, label: LEAD_FILTER_LABELS[filter] })),
  contacts: [
    { value: CRM_ALL, label: 'All' },
    ...CONTACT_LIFECYCLE_STAGES.map((stage) => ({ value: stage, label: CONTACT_LIFECYCLE_STAGE_LABELS[stage] })),
  ],
  companies: [
    { value: CRM_ALL, label: 'All' },
    { value: 'no-next-activity', label: 'No next activity' },
  ],
  deals: [
    { value: 'open', label: 'Open' },
    { value: 'won', label: 'Won' },
    { value: 'lost', label: 'Lost' },
    { value: CRM_ALL, label: 'All' },
  ],
}

export const crmDefaultStatus = (kind: CrmListKind): string => CRM_STATUS_CHOICES[kind][0].value

/** What the reader picked above a list. */
export interface CrmListFilters {
  status: string
  /** Only the records the reader owns. */
  mine: boolean
  /** The deals list's pipeline; the console's table reads one pipeline at a time. */
  pipelineId?: string | null
}

/** One list, asked: where it reads, what it asks, and what it reads back. */
export interface CrmListSpec {
  kind: CrmListKind
  path: readonly string[]
  /** The stored clauses, translated — for naming the refusals by what the reader set. */
  asked: CrmAskedClauses
  ask: CrmListAsk
  /** False while the query has nothing provable to ask (an empty scope, no pipeline). */
  enabled: boolean
  /** How the refusals name a clause. */
  fields: readonly ListFilterField[]
  headers: Readonly<Record<string, string>>
}

const eq = (field: string, value: string): ListFilterRequest => ({ field, op: 'equals', value })

/** The clauses a list's chips store, in the grid's own grammar. */
export function crmStoredClauses(kind: CrmListKind, filters: CrmListFilters, uid: string): ListFilterRequest[] {
  const { status, mine } = filters
  const picked = status && status !== CRM_ALL
  switch (kind) {
    case 'leads':
      // No status clause is Open (`leadClausesForGrid`), so `all` asks none.
      return [...(picked ? [eq('status', status)] : []), ...(mine ? [eq('ownerUid', uid)] : [])]
    case 'contacts':
      return [
        ...(picked ? [eq(CRM_CONTACT_VIEW_FIELDS.stage, status)] : []),
        ...(mine ? [eq(CRM_CONTACT_VIEW_FIELDS.owner, uid)] : []),
      ]
    case 'companies':
      return [
        ...(status === 'no-next-activity' ? [{ ...CRM_NO_NEXT_ACTIVITY_CLAUSE }] : []),
        ...(mine ? [eq('ownerUid', uid)] : []),
      ]
    case 'deals':
      return picked ? [eq('status', status)] : []
  }
}

/** Whether a list offers "Mine": the deals table has no owner filter in the console. */
export const crmOffersMine = (kind: CrmListKind): boolean => kind !== 'deals'

/**
 * The list's query, as the console section asks it for this reader. `search`
 * is the box's words (`searchWords`).
 */
export function crmListSpec(input: {
  kind: CrmListKind
  scope: CrmMobileScope
  uid: string
  filters: CrmListFilters
  search: readonly string[]
}): CrmListSpec {
  const { kind, scope, uid, filters, search } = input
  const { visibleTo, foldsScope } = scope
  const stored = crmStoredClauses(kind, filters, uid)
  const path = ['orgs', scope.orgId, CRM_LIST_COLLECTIONS[kind]]
  const listable = visibleTo === null || visibleTo.length > 0
  switch (kind) {
    case 'leads': {
      const asked = crmAskClauses(stored, (clause) =>
        leadQueryClause(clause, { scopeTokens: visibleTo, foldsScope }),
      )
      return {
        kind,
        path,
        asked,
        ask: crmListAsk({
          visibleTo,
          foldsScope,
          declaration: LEAD_LIST_DECLARATION,
          clauses: asked.clauses,
          search,
          impliesScope: leadClauseImpliesScope,
          prefixSearch: LEAD_PREFIX_SEARCH,
        }),
        enabled: listable,
        fields: LEAD_LIST_FILTER_FIELDS,
        headers: LEAD_LIST_FILTER_HEADERS,
      }
    }
    case 'contacts': {
      const groupId = scope.consentGroup?.groupId ?? null
      const asked = crmAskClauses(stored, (clause) => contactQueryClause(clause, { groupId, foldsScope }))
      return {
        kind,
        path,
        asked,
        ask: crmListAsk({
          visibleTo,
          foldsScope,
          declaration: CONTACT_LIST_DECLARATION,
          clauses: asked.clauses,
          search,
          impliesScope: contactClauseImpliesScope(groupId),
          soloClause: contactSoloClause,
          prefixSearch: CONTACT_PREFIX_SEARCH,
        }),
        enabled: listable,
        fields: CONTACT_LIST_FILTER_FIELDS,
        headers: CONTACT_LIST_FILTER_HEADERS,
      }
    }
    case 'companies': {
      // The Companies section asks its view's clauses as stored.
      const asked = crmAskClauses(stored, (clause) => clause)
      return {
        kind,
        path,
        asked,
        ask: crmListAsk({
          visibleTo,
          foldsScope,
          declaration: COMPANY_LIST_DECLARATION,
          clauses: asked.clauses,
          search,
          prefixSearch: COMPANY_PREFIX_SEARCH,
        }),
        enabled: listable,
        fields: COMPANY_LIST_FILTER_FIELDS,
        headers: { ownerUid: 'Owner', nextTaskAtMs: CRM_NEXT_ACTIVITY_FILTER_HEADER },
      }
    }
    case 'deals': {
      const pipelineId = filters.pipelineId ?? null
      const asked = crmAskClauses(stored, dealQueryClause)
      return {
        kind,
        path,
        asked,
        ask: crmListAsk({
          visibleTo,
          foldsScope,
          declaration: DEAL_LIST_DECLARATION,
          clauses: asked.clauses,
          search,
          base: dealPipelineBase(pipelineId),
          prefixSearch: DEAL_PREFIX_SEARCH,
        }),
        // The console's table reads one pipeline; with none there is no table.
        enabled: listable && Boolean(pipelineId),
        fields: DEAL_LIST_FILTER_FIELDS,
        headers: { status: 'Status', nextTaskAtMs: CRM_NEXT_ACTIVITY_FILTER_HEADER },
      }
    }
  }
}

/** What the list says above its rows: the plan's notices and every refusal, named by the clause set. */
export function crmListNotices(spec: CrmListSpec, plan: ListQueryPlan): string[] {
  const read = crmListPlanReadBack(plan, spec.ask)
  const refusals = crmQueryRefusals(read, spec.asked, { fields: spec.fields, headers: spec.headers })
  return [
    ...read.notices,
    ...refusals.map((refusal) => `${refusal.label} is not applied: ${refusal.reason}.`),
  ]
}

export type { LeadFilter }
