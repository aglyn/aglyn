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
  useHostCampaigns,
  useOrgCampaigns,
  type HostCampaigns,
} from '@aglyn/tenant-feature-instance'

/**
 * THE CAMPAIGNS A CRM SURFACE OFFERS AND NAMES, at either level.
 *
 * Campaigns belong to the organization, and so do leads. Under a site the
 * list is the campaigns placed on that site — the ones its hub shows and
 * its captures file under. At the organization level (`hostId` null) it is
 * every campaign in the org, because the list there spans every site and a
 * lead from any of them may be filed under any campaign.
 *
 * Both hooks are called on every render, since a hook may not be called
 * conditionally; only the one for this level is enabled, so only one
 * listener opens.
 */
export function useCrmCampaigns(
  scope: {
    hostId: string | null | undefined
    orgId: string | null | undefined
  },
  options?: { enabled?: boolean },
): HostCampaigns {
  const enabled = options?.enabled ?? false
  const hostId = scope.hostId || null
  const site = useHostCampaigns(hostId ?? undefined, {
    enabled: enabled && Boolean(hostId),
  })
  const org = useOrgCampaigns(scope.orgId, {
    enabled: enabled && !hostId,
  })
  return hostId ? site : org
}

export default useCrmCampaigns
