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
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmPicklist,
  crmPicklistDefinition,
  crmPicklistValueByLabel,
  effectiveCrmLeadSourcePicklist,
} from '@aglyn/aglyn/app-utils/crm'

/*==========================================
 * A LEAD SOURCE'S DIRECTION (AGL-3511).
 *
 * Every lead source value sits in a group of the Lead source picklist —
 * Inbound for a person who came to the organization, Outbound for one the
 * organization went to — or in none. The direction is never stored on a
 * record: a record stores the label, and the label's group is read off the
 * organization's list when it is asked, so moving a value between groups
 * moves every record that holds it — in a filter, a sharing rule and the
 * Lead sources report alike.
 *=========================================*/

/** The directions a lead source can have: the Lead source picklist's groups. */
export type LeadSourceDirection = 'inbound' | 'outbound'

export const LEAD_SOURCE_DIRECTIONS: readonly LeadSourceDirection[] = ['inbound', 'outbound']

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

export function isLeadSourceDirection(value: unknown): value is LeadSourceDirection {
  return (LEAD_SOURCE_DIRECTIONS as readonly unknown[]).includes(value)
}

/**
 * The direction a lead source label has in `picklist` — `null` for no label,
 * a value in no group, or a label the list does not hold.
 */
export function leadSourceDirectionOf(
  picklist: CrmPicklist,
  label: unknown,
): LeadSourceDirection | null {
  const group = crmPicklistValueByLabel(picklist, label)?.group
  return isLeadSourceDirection(group) ? group : null
}

/**
 * Every label in `picklist` whose value is in `direction` — the inactive
 * ones too, since a record keeps a value after it is deactivated and a
 * direction asked of the records must still find it.
 */
export function leadSourceLabelsOfDirection(
  picklist: CrmPicklist,
  direction: LeadSourceDirection,
): string[] {
  return picklist.values.filter((value) => value.group === direction).map((value) => value.label)
}

/** The standard values alone — the answer before an organization's own list is read. */
export const STANDARD_LEAD_SOURCES: CrmPicklist = effectiveCrmLeadSourcePicklist(null)
