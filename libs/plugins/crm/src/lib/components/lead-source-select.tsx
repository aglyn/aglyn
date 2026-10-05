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

import { CRM_LEAD_SOURCE_PICKLIST } from '@aglyn/aglyn'
import { CrmPicklistSelect, type CrmPicklistSelectProps } from './picklist-select'

export type LeadSourceSelectProps = Omit<CrmPicklistSelectProps, 'picklistId'>

/**
 * The Lead source select (AGL-3298) — {@link CrmPicklistSelect} for the
 * lead source, its values under Inbound and Outbound.
 */
export function LeadSourceSelect(props: LeadSourceSelectProps) {
  return <CrmPicklistSelect picklistId={CRM_LEAD_SOURCE_PICKLIST} {...props} />
}
LeadSourceSelect.displayName = 'LeadSourceSelect'

export default LeadSourceSelect
