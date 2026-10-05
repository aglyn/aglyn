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
import { useMemo } from 'react'
import { type CrmPicklistResult, useCrmPicklist } from './use-crm-picklist'

export type LeadSourcePicklistResult = Omit<CrmPicklistResult, 'definition'>

/**
 * The org's lead source values (AGL-3298) — {@link useCrmPicklist} for the
 * lead source: the lead page's select, the New lead drawer, the contact's
 * card, the leads list's filter and the import drawer.
 */
export function useLeadSourcePicklist(orgId: string | null | undefined): LeadSourcePicklistResult {
  const { picklist, stored, ready, fromCache } = useCrmPicklist(CRM_LEAD_SOURCE_PICKLIST, orgId)
  return useMemo(() => ({ picklist, stored, ready, fromCache }), [picklist, stored, ready, fromCache])
}

export default useLeadSourcePicklist
