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

import type { CrmOrgDoc } from '../hooks/use-crm-scope'
import { LinkedDealsCard } from './linked-deals-card'

export interface ContactDealsCardProps {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org: CrmOrgDoc
  basePath: string
  contactId: string
  /** The name the drawer preselects with; the id is the link either way. */
  contactName?: string
}

/**
 * The deals a contact is party to, on the contact's page (AGL-2598) —
 * `orgs/{orgId}/deals` where `contactId ==` this person, with a "New deal"
 * that starts one already linked to them.
 */
export function ContactDealsCard(props: ContactDealsCardProps) {
  const { hostId, org, basePath, contactId, contactName } = props
  return (
    <LinkedDealsCard
      hostId={hostId}
      org={org}
      basePath={basePath}
      link={{ contactId, contactName }}
    />
  )
}
ContactDealsCard.displayName = 'ContactDealsCard'

export default ContactDealsCard
