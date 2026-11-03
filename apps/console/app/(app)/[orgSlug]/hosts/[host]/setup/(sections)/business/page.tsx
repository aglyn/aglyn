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
import BusinessProfileCard from '../../../../../../../../components/business-profile-card.component'
import { useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import PluginWidgetSlot from '../../../../../../../../components/plugin-widget-slot.component'
import useCurrentOrg from '../../../../../../../../hooks/use-current-org'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import {
  HostSettingsForm,
  useHostSettingsScope,
} from '../../../host-settings-scope'

/**
 * Business — what the business is and how to reach it (AGL-3661, AGL-4136).
 *
 * Three cards, in the order an owner fills them in:
 *
 * - BUSINESS DETAILS, the one place a site's name, slogan, phone, email,
 *   postal address and social links are entered (AGL-4136). Every other
 *   screen stopped asking for them, and every reader — the pages' `host.*`
 *   variables, the email footer, the documents, the structured data — takes
 *   them from here. A host settings form, saved by the same guarded save as
 *   the SEO cards, so the AI SEO audit's proposals for the name, email and
 *   phone land in it as unsaved edits.
 * - the BUSINESS PROFILE the owner writes for Aglyn AI: services, audience
 *   and tone. The area served is not on it; that is SEO → Local business.
 * - the `hostBusinessProfile` zone, where a plugin shows what it keeps about
 *   the business — the preferences Aglyn AI learned from the owner's edits,
 *   which they can read and clear.
 */
export default function HostSetupBusinessSection() {
  const { hostId } = useHostSettingsScope()
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  return (
    <Stack spacing={3}>
      <HostSettingsForm schemaId="hostBusinessDetails" />
      {orgId ? <BusinessProfileCard orgId={orgId} hostId={hostId} /> : null}
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
