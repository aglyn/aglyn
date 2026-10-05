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

export interface LeadPicklistsResult {
  /** Each list a lead field beside the lead source holds a value of, by picklist id. */
  lists: Readonly<Partial<Record<CrmPicklistId, CrmPicklist>>>
  /** Every list has answered from the server. */
  ready: boolean
}

/**
 * The org's lists behind a lead's Salutation, Industry and Rating
 * (AGL-3513) — the contact's and the company's own lists, one document
 * listen each, shared with every other mount asking for the same list.
 */
export function useLeadPicklists(orgId: string | null | undefined): LeadPicklistsResult {
  const salutation = useCrmPicklist('salutation', orgId)
  const industry = useCrmPicklist('industry', orgId)
  const rating = useCrmPicklist('rating', orgId)
  return useMemo(
    () => ({
      lists: {
        salutation: salutation.picklist,
        industry: industry.picklist,
        rating: rating.picklist,
      },
      ready: [salutation, industry, rating].every((list) => list.ready),
    }),
    [salutation, industry, rating],
  )
}

export default useLeadPicklists
