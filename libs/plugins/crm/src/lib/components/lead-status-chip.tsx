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
  crmLeadStatus,
  crmLeadStatusLabel,
} from '@aglyn/aglyn'
import { Chip, type ChipProps } from '@mui/material'

/**
 * One palette key per status, so the list and the record page paint the same
 * state the same way. `qualified` is the converted state and reads as the
 * success it is; `nurturing` — automation is reaching it, no person yet —
 * takes its own hue between New and Working; `unqualified` is outlined and neutral — closed, not wrong.
 */
const STATUS_COLOR: Record<CrmLeadStatus, ChipProps['color']> = {
  new: 'info',
  nurturing: 'secondary',
  working: 'primary',
  qualified: 'success',
  unqualified: 'default',
}

export interface LeadStatusChipProps {
  lead: Pick<CrmLeadFields, 'status' | 'statusLabel'> | null | undefined
  /** The org's Lead status list, whose labels the chip reads (AGL-3512); the standard ones without it. */
  statuses?: CrmPicklist
  size?: ChipProps['size']
}

/**
 * A lead's status as a chip (AGL-2608). An absent status reads as New. The
 * color is the MEANING's and the words are the org's label for the value
 * the lead holds (AGL-3512).
 */
export function LeadStatusChip(props: LeadStatusChipProps) {
  const { lead, statuses, size = 'small' } = props
  const status = crmLeadStatus(lead)
  return (
    <Chip
      size={size}
      label={crmLeadStatusLabel(lead, statuses)}
      color={STATUS_COLOR[status]}
      variant={status === 'unqualified' ? 'outlined' : 'filled'}
    />
  )
}
LeadStatusChip.displayName = 'LeadStatusChip'

export default LeadStatusChip
