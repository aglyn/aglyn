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

import { Stack } from '@mui/material'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import CustomDomainCard from '../../../../../../../../components/custom-domain-card.component'
import SiteBrandingBadgeCard from '../../../../../../../../components/site-branding-badge-card.component'
import { useHostId } from '../../../../../../../../components/host-id-provider'

/** The site's address, and the badge that ships on it. */
const HostAdminDomain: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  return (
    <Stack spacing={2}>
      <CustomDomainCard hostId={hostId} />
      {/* The badge is a fact about the PUBLISHED site, so it belongs beside
          the domain it is published on (AGL-2081). There is nothing to toggle
          — the entitlement is the switch — but "do my sites show the Aglyn
          badge" is a question an owner should be able to answer somewhere. */}
      <SiteBrandingBadgeCard />
    </Stack>
  )
}
HostAdminDomain.displayName = 'Page:HostAdminDomain'

export default HostAdminDomain
