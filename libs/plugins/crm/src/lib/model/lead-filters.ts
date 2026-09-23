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
const LEAD_SEARCH_FIELDS = ['name', 'email', 'company', 'jobTitle'] as const

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
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const values = [
    ...LEAD_SEARCH_FIELDS.map((field) => lead[field]),
    ...(Array.isArray(lead['tags']) ? lead['tags'] : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => value.toLowerCase())
  return words.every((word) => values.some((value) => value.includes(word)))
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
