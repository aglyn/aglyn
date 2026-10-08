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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Stack } from '@mui/material'
import BusinessProfileCard from '../../../../../../components/business-profile-card.component'
import OrgProfileCard from '../../../../../../components/settings/org-profile-card.component'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * Logo, contact details, and the billing address Stripe Tax reads; then the
 * business profile every site inherits where its own says nothing
 * (AGL-3661), which only an owner or admin writes — the rules' `canManageOrg`.
 */
const SettingsProfile: NextPageWithLayout<Record<string, never>> = () => {
  const { orgId } = useCurrentOrg()
  const { loaded, role } = useOrgPermissions()
  return (
    <Stack spacing={3}>
      <OrgProfileCard />
      {orgId ? (
        <BusinessProfileCard orgId={orgId} canEdit={loaded && (role === 'owner' || role === 'admin')} />
      ) : null}
    </Stack>
  )
}
SettingsProfile.displayName = 'Page:SettingsProfile'

export default SettingsProfile
