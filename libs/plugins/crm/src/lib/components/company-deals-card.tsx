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

import type { CrmOrgDoc } from '../hooks/use-deal-scope'
import { LinkedDealsCard } from './linked-deals-card'

export interface CompanyDealsCardProps {
  hostId: string
  org: CrmOrgDoc
  basePath: string
  companyId: string
  /** The name the drawer preselects with; the id is the link either way. */
  companyName?: string
}

/**
 * The deals with one company, on the company's page (AGL-2598) —
 * `orgs/{orgId}/deals` where `companyId ==` this organization, with a
 * "New deal" that starts one already linked to it.
 */
export function CompanyDealsCard(props: CompanyDealsCardProps) {
  const { hostId, org, basePath, companyId, companyName } = props
  return (
    <LinkedDealsCard
      hostId={hostId}
      org={org}
      basePath={basePath}
      link={{ companyId, companyName }}
    />
  )
}
CompanyDealsCard.displayName = 'CompanyDealsCard'

export default CompanyDealsCard
