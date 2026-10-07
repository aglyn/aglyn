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
  type CrmLeadFields,
  type CrmLeadStatus,
  type CrmPicklist,
  crmLeadStatusOptions,
} from '@aglyn/aglyn/app-utils/crm'

/**
 * The meanings a person sets by hand from a lead's status select: every one
 * but Qualified, which only a conversion sets (AGL-2608, AGL-3512).
 */
export const LEAD_STATUS_HAND_SET: readonly CrmLeadStatus[] = [
  'new',
  'nurturing',
  'working',
  'unqualified',
]

/** One choice of a lead status select: the org's label, and the meaning it sets. */
export interface LeadStatusChoice {
  label: string
  status: CrmLeadStatus
  inactive: boolean
}

/** What a lead status select offers a lead: the org's active values of the hand-set meanings, and its own. */
export function leadStatusChoices(
  picklist: CrmPicklist,
  lead: Pick<CrmLeadFields, 'status' | 'statusLabel'>,
): LeadStatusChoice[] {
  return crmLeadStatusOptions(picklist, LEAD_STATUS_HAND_SET, lead)
}

/** The most a reason may say — shared with the bulk bar's one-reason-for-all (AGL-2662). */
export const UNQUALIFY_REASON_MAX = 500
