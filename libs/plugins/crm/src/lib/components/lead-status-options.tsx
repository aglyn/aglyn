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
'use client'

import {
  type CrmLeadFields,
  type CrmLeadStatus,
  type CrmPicklist,
  crmLeadStatusOptions,
} from '@aglyn/aglyn'
import { ListItemText, MenuItem } from '@mui/material'

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

/**
 * The select's items, by label (AGL-3512). An Unqualified value ends in "…"
 * because it opens the dialog that asks why; the lead's own value, when the
 * list no longer offers it, is shown and not offered.
 */
export function leadStatusMenuItems(choices: readonly LeadStatusChoice[]) {
  return choices.map((choice) => (
    <MenuItem key={choice.label} value={choice.label} disabled={choice.inactive}>
      <ListItemText
        primary={choice.status === 'unqualified' ? `${choice.label}…` : choice.label}
        slotProps={choice.inactive ? { primary: { color: 'text.secondary' } } : undefined}
      />
    </MenuItem>
  ))
}
