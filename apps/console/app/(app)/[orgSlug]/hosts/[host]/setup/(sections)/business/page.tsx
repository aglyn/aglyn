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
import BusinessFactsCard from '../../../../../../../../components/business-facts-card.component'
import BusinessProfileCard from '../../../../../../../../components/business-profile-card.component'
import { useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import PluginWidgetSlot from '../../../../../../../../components/plugin-widget-slot.component'
import useCurrentOrg from '../../../../../../../../hooks/use-current-org'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import { useHostSettingsScope } from '../../../host-settings-scope'

/**
 * Business profile — what the business is, for everything that writes about
 * it (AGL-3661).
 *
 * Three cards, in the order an owner checks them: the profile they write
 * (services, audience, area, tone), the facts read from the site's settings
 * (name and every way to reach the business, which have a home already and
 * are linked to it rather than copied), and the `hostBusinessProfile` zone,
 * where a plugin shows what it keeps about the business — the preferences
 * Aglyn AI learned from the owner's edits, which they can read and clear.
 */
export default function HostSetupBusinessSection() {
  const { hostId } = useHostSettingsScope()
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  return (
    <Stack spacing={3}>
      {orgId ? <BusinessProfileCard orgId={orgId} hostId={hostId} /> : null}
      <BusinessFactsCard hostId={hostId} orgSlug={orgSlug} host={host ?? null} />
      <PluginWidgetSlot
        slot="hostBusinessProfile"
        hostId={hostId}
        orgId={orgId}
        orgSlug={orgSlug}
        host={host ?? null}
      />
    </Stack>
  )
}
