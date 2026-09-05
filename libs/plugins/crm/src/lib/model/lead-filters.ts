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
  type CrmLeadFields,
  type CrmLeadStatus,
  crmLeadStatus,
  isCrmLeadOpen,
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
