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
  CRM_LEAD_SOURCE_DIRECTIONS,
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmLeadSourceDirection,
  type CrmPicklist,
  crmLeadSourceDirection,
  crmPicklistDefinition,
  effectiveCrmLeadSourcePicklist,
  isCrmLeadSourceDirection,
} from '@aglyn/aglyn/app-utils/crm'

/*==========================================
 * A LEAD SOURCE'S DIRECTION (AGL-3511).
 *
 * Every lead source value sits in a group of the Lead source picklist —
 * Inbound for a person who came to the organization, Outbound for one the
 * organization went to — or in none. A record stores the label, and the
 * label's group is read off the organization's list: a sharing rule and
 * the Lead sources report read it when they are asked, and a lead also
 * carries it as `leadSourceDirection` (AGL-3577), the field the Leads
 * filter asks, which every move of the list that changes a label's group
 * rewrites (`crm/picklist-values`). Moving a value between groups moves
 * every record that holds it, in all three alike.
 *
 * The resolution itself is core's (`crmLeadSourceDirection`), because the
 * list-field writers that stamp a lead live there.
 *=========================================*/

/** The directions a lead source can have: the Lead source picklist's groups. */
export type LeadSourceDirection = CrmLeadSourceDirection

export const LEAD_SOURCE_DIRECTIONS: readonly LeadSourceDirection[] = CRM_LEAD_SOURCE_DIRECTIONS

/** How each direction reads, from the picklist's own group labels. */
export const LEAD_SOURCE_DIRECTION_LABELS: Readonly<Record<LeadSourceDirection, string>> = {
  inbound: groupLabel('inbound', 'Inbound'),
  outbound: groupLabel('outbound', 'Outbound'),
}

/** A lead with no lead source, or one in no group. */
export const LEAD_SOURCE_UNSPECIFIED_LABEL = 'Unspecified'

function groupLabel(id: LeadSourceDirection, fallback: string): string {
  const groups = crmPicklistDefinition(CRM_LEAD_SOURCE_PICKLIST)?.groups ?? []
  return groups.find((group) => group.id === id)?.label ?? fallback
}

export const isLeadSourceDirection = isCrmLeadSourceDirection

/**
 * The direction a lead source label has in `picklist` — `null` for no label,
 * a value in no group, or a label the list does not hold.
 */
export function leadSourceDirectionOf(
  picklist: CrmPicklist,
  label: unknown,
): LeadSourceDirection | null {
  return crmLeadSourceDirection(picklist, label)
}

/** The standard values alone — the answer before an organization's own list is read. */
export const STANDARD_LEAD_SOURCES: CrmPicklist = effectiveCrmLeadSourcePicklist(null)
