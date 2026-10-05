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

import type { CrmPicklist, CrmPicklistId } from '@aglyn/aglyn'
import { useMemo } from 'react'
import { useCrmPicklist } from './use-crm-picklist'

export interface CompanyPicklistsResult {
  /** Each list a company field holds a value of, by picklist id. */
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>
  /** Every list has answered from the server. */
  ready: boolean
}

/**
 * The org's lists behind a company's picklist fields (AGL-3514): Type,
 * Industry, Rating and Ownership, and the lead source list Account Source
 * holds a value of. One document listen each, shared with every other
 * mount asking for the same list.
 */
export function useCompanyPicklists(orgId: string | null | undefined): CompanyPicklistsResult {
  const accountType = useCrmPicklist('accountType', orgId)
  const industry = useCrmPicklist('industry', orgId)
  const rating = useCrmPicklist('rating', orgId)
  const ownership = useCrmPicklist('ownership', orgId)
  const leadSource = useCrmPicklist('leadSource', orgId)
  return useMemo(
    () => ({
      lists: {
        accountType: accountType.picklist,
        industry: industry.picklist,
        rating: rating.picklist,
        ownership: ownership.picklist,
        leadSource: leadSource.picklist,
      },
      ready: [accountType, industry, rating, ownership, leadSource].every((list) => list.ready),
    }),
    [accountType, industry, rating, ownership, leadSource],
  )
}

export default useCompanyPicklists
