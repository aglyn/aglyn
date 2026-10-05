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

import { CRM_LEAD_STATUS_PICKLIST } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { type CrmPicklistResult, useCrmPicklist } from './use-crm-picklist'

export type LeadStatusPicklistResult = Omit<CrmPicklistResult, 'definition'>

/**
 * The org's lead status values (AGL-3512) — {@link useCrmPicklist} for the
 * lead status: every chip, select and filter that shows a lead's status by
 * the label the org gave its meaning. One shared document listen.
 */
export function useLeadStatusPicklist(orgId: string | null | undefined): LeadStatusPicklistResult {
  const { picklist, stored, ready, fromCache } = useCrmPicklist(CRM_LEAD_STATUS_PICKLIST, orgId)
  return useMemo(() => ({ picklist, stored, ready, fromCache }), [picklist, stored, ready, fromCache])
}

export default useLeadStatusPicklist
