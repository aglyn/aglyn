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
  CRM_LEAD_STATUS_LABELS,
  type CrmLeadFields,
  type CrmLeadStatus,
  crmLeadStatus,
} from '@aglyn/aglyn'
import { Chip, type ChipProps } from '@mui/material'

/**
 * One palette key per status, so the list and the record page paint the same
 * state the same way. `qualified` is the converted state and reads as the
 * success it is; `unqualified` is outlined and neutral — closed, not wrong.
 */
const STATUS_COLOR: Record<CrmLeadStatus, ChipProps['color']> = {
  new: 'info',
  working: 'primary',
  qualified: 'success',
  unqualified: 'default',
}

export interface LeadStatusChipProps {
  lead: Pick<CrmLeadFields, 'status'> | null | undefined
  size?: ChipProps['size']
}

/** A lead's status as a chip (AGL-2608). An absent status reads as New. */
export function LeadStatusChip(props: LeadStatusChipProps) {
  const { lead, size = 'small' } = props
  const status = crmLeadStatus(lead)
  return (
    <Chip
      size={size}
      label={CRM_LEAD_STATUS_LABELS[status]}
      color={STATUS_COLOR[status]}
      variant={status === 'unqualified' ? 'outlined' : 'filled'}
    />
  )
}
LeadStatusChip.displayName = 'LeadStatusChip'

export default LeadStatusChip
