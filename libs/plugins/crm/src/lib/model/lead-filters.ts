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
  EMAIL_STATE_LABELS,
  EMAIL_STATE_STATUSES,
  CRM_LEAD_STATUS_LABELS,
  type EmailStateStatus,
  type CrmLeadFields,
  type CrmLeadStatus,
  emailStateForbidsEmail,
  crmLeadStatus,
  isCrmLeadOpen,
  normalizeCrmPicklistLabel,
  readCampaignIds,
  readEmailState,
} from '@aglyn/aglyn'
import type { CrmViewFilterClause } from '@aglyn/aglyn'
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import { type CrmGridFilterCodec, crmSelectCodec, crmRowMatchesSearch } from './crm-grid-filter'

/**
 * What the Leads section's `Show` control offers (AGL-2608): the two
 * aggregate views and each status on its own. `open` is the default — the
 * list opens on the work — and it is the one view a Firestore query cannot
 * express, because a lead nobody has touched carries no status field at all;
 * see the section for why the filter runs over a loaded window.
 */
export type LeadFilter = 'open' | 'all' | CrmLeadStatus

export const LEAD_FILTERS: readonly LeadFilter[] = [
  'open',
  'new',
  'working',
  'qualified',
  'unqualified',
  'all',
]

export const LEAD_FILTER_LABELS: Record<LeadFilter, string> = {
  open: 'Open',
  all: 'All',
  new: CRM_LEAD_STATUS_LABELS.new,
  working: CRM_LEAD_STATUS_LABELS.working,
  qualified: CRM_LEAD_STATUS_LABELS.qualified,
  unqualified: CRM_LEAD_STATUS_LABELS.unqualified,
}

/** Whether a lead belongs in a filter's view. An absent status is `new`. */
export function leadMatchesFilter(
  lead: Pick<CrmLeadFields, 'status'>,
  filter: LeadFilter,
): boolean {
  if (filter === 'all') return true
  if (filter === 'open') return isCrmLeadOpen(lead)
  return crmLeadStatus(lead) === filter
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

/** Whether a lead belongs in an email filter's view. */
export function leadMatchesEmailFilter(
  lead: Readonly<Record<string, unknown>>,
  filter: LeadEmailFilter,
): boolean {
  if (filter === 'any') return true
  const state = readEmailState(lead)
  if (filter === 'none') return state === null
  if (filter === 'problem') return emailStateForbidsEmail(state)
  return state?.status === filter
}

/**
 * The Leads section's `Campaign` control (AGL-3254): every lead, or the
 * ones filed under one campaign — read off the lead's own `campaignIds`,
 * the field every campaign member carries. `''` is every lead, which is
 * what the control opens on; the ids are the site's containers', and the
 * section resolves their names for the menu.
 */
export function leadMatchesCampaignFilter(
  lead: Readonly<Record<string, unknown>>,
  campaignId: string,
): boolean {
  if (!campaignId) return true
  return readCampaignIds(lead).includes(campaignId)
}

/**
 * The fields the Leads section's search box reads (AGL-3246): who the lead
 * is and where they work — the words a person types to find one — plus the
 * tags, which are how an import names its batch (`sal-15`). `name` and
 * `email` are the capture door's fields rather than the CRM's, so the row is
 * read as a record rather than through `CrmLeadFields`.
 */
export const LEAD_SEARCH_FIELDS = ['name', 'email', 'company', 'jobTitle', 'tags'] as const

/**
 * Whether a lead answers a search term.
 *
 * Case-insensitive, and every whitespace-separated word of the term must
 * appear in SOME searched field: `morgan lamphere` and `lamphere sal-15`
 * both find Morgan Lamphere, `morgan smith` does not. A blank term matches
 * every lead, so the box emptied is the list unfiltered.
 */
export function leadMatchesSearch(
  lead: Readonly<Record<string, unknown>>,
  term: string,
): boolean {
  // Tags are a list; a stray string there is no tag of the lead's.
  const tags = Array.isArray(lead['tags']) ? lead['tags'] : undefined
  return crmRowMatchesSearch({ ...lead, tags }, LEAD_SEARCH_FIELDS, term.trim().split(/\s+/))
}

/**
 * The `Lead source` control's "no lead source" choice (AGL-3298). Held in
 * the saved view as an `isEmpty` clause, never as this string; it is only
 * the select's own value for the choice.
 */
export const LEAD_SOURCE_FILTER_NONE = '\u0000none'

/**
 * The Leads section's `Lead source` control (AGL-3298): every lead (`''`),
 * the ones holding one value — compared the way the picklist compares
 * labels, so a value typed in another case before the list existed is
 * still found — or the ones holding none.
 */
export function leadMatchesLeadSourceFilter(
  lead: Readonly<Record<string, unknown>>,
  filter: string,
): boolean {
  if (!filter) return true
  const held = normalizeCrmPicklistLabel(lead['leadSource']).toLowerCase()
  if (filter === LEAD_SOURCE_FILTER_NONE) return held === ''
  return held === normalizeCrmPicklistLabel(filter).toLowerCase()
}

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
 *
 * Every one narrows the loaded window, never the query — see the section's
 * `LEADS_WINDOW` for why a status cannot be asked of Firestore.
 *=========================================*/

/** The fields the grid's panel offers on Leads. */
export const LEAD_LIST_FILTER_FIELDS: readonly ListFilterField[] = [
  { column: 'status', kind: 'exact', path: 'status', operators: ['equals', 'isAnyOf'] },
  { column: 'emailState', kind: 'exact', path: 'emailState', operators: ['equals', 'isAnyOf'] },
  { column: 'ownerUid', kind: 'exact', path: 'ownerUid', operators: ['equals', 'isAnyOf'] },
  { column: 'leadSource', kind: 'exact', path: 'leadSource', operators: ['equals', 'isAnyOf'] },
  { column: 'campaignIds', kind: 'exact', path: 'campaignIds', operators: ['equals'] },
]

/** What each filter field reads as on a chip. */
export const LEAD_LIST_FILTER_HEADERS: Readonly<Record<string, string>> = {
  status: 'Status',
  emailState: 'Email',
  ownerUid: 'Owner',
  leadSource: 'Lead source',
  campaignIds: 'Campaign',
}

/** The choices for Status: Open (new or working) and each status on its own. */
export const LEAD_STATUS_FILTER_OPTIONS = LEAD_FILTERS.filter(
  (option) => option !== 'all',
).map((option) => ({
  value: option,
  label: option === 'open' ? 'Open (new or working)' : LEAD_FILTER_LABELS[option],
}))

/** The choices for Email: every verdict, plus the two aggregates. */
export const LEAD_EMAIL_FILTER_OPTIONS = LEAD_EMAIL_FILTERS.filter(
  (option) => option !== 'any',
).map((option) => ({ value: option, label: LEAD_EMAIL_FILTER_LABELS[option] }))

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

const listed = (clause: CrmViewFilterClause): string[] =>
  clause.op === 'isAnyOf'
    ? clause.value.split(',').map((entry) => entry.trim()).filter(Boolean)
    : [clause.value]

/** Whether a lead answers every clause the grid shows. */
export function leadMatchesClauses(
  lead: Readonly<Record<string, unknown>> & Pick<CrmLeadFields, 'status'>,
  clauses: readonly CrmViewFilterClause[],
): boolean {
  return clauses.every((clause) => {
    switch (clause.field) {
      case 'status':
        return listed(clause).some((value) =>
          (LEAD_FILTERS as readonly string[]).includes(value)
            ? leadMatchesFilter(lead, value as LeadFilter)
            : true,
        )
      case 'emailState':
        return listed(clause).some((value) =>
          (LEAD_EMAIL_FILTERS as readonly string[]).includes(value)
            ? leadMatchesEmailFilter(lead, value as LeadEmailFilter)
            : true,
        )
      case 'campaignIds':
        return listed(clause).some((value) => leadMatchesCampaignFilter(lead, value))
      case 'leadSource':
        return clause.op === 'isEmpty'
          ? leadMatchesLeadSourceFilter(lead, LEAD_SOURCE_FILTER_NONE)
          : listed(clause).some((value) => leadMatchesLeadSourceFilter(lead, value))
      case 'ownerUid':
        return listed(clause).includes(String(lead['ownerUid'] ?? ''))
      default:
        // A clause on a field this list does not answer narrows nothing,
        // rather than emptying the list.
        return true
    }
  })
}

/** Campaign clauses were stored as `contains`; the panel's select says `is`. */
export const LEAD_CAMPAIGN_CODEC: CrmGridFilterCodec = {
  toItem: (clause) =>
    clause.op === 'contains' || clause.op === 'equals'
      ? { operator: 'is', value: clause.value }
      : null,
  toClause: (item) => {
    const clause = crmSelectCodec.toClause(item)
    return clause && clause.op === 'equals' ? { ...clause, op: 'contains' } : null
  },
}

/** "No lead source" is an `isEmpty` clause, shown as a choice of the select. */
export const LEAD_SOURCE_CODEC: CrmGridFilterCodec = {
  toItem: (clause) =>
    clause.op === 'isEmpty'
      ? { operator: 'is', value: LEAD_SOURCE_FILTER_NONE }
      : crmSelectCodec.toItem(clause),
  toClause: (item) => {
    const clause = crmSelectCodec.toClause(item)
    if (clause?.op === 'equals' && clause.value === LEAD_SOURCE_FILTER_NONE) {
      return { field: clause.field, op: 'isEmpty', value: '' }
    }
    return clause
  },
}

/** The Leads fields whose stored clauses translate their own way. */
export const LEAD_FILTER_CODECS: Readonly<Record<string, CrmGridFilterCodec>> = {
  campaignIds: LEAD_CAMPAIGN_CODEC,
  leadSource: LEAD_SOURCE_CODEC,
}
