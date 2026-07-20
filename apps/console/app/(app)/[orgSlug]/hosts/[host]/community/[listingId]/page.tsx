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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useParams } from 'next/navigation'
import HostDisplayNameComponent from '../../../../../../../components/host-display-name.component'
import { useHostId, useHostSubdomain } from '../../../../../../../components/host-id-provider'
import DashboardLayout from '../../../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../../../components/plugin-widget-slot.component'
import hostNavTabItems from '../../../../../../../constants/host-nav-tabs'
import { buildRoute, Route } from '../../../../../../../constants/route-links'
import { useOrgSlug } from '../../../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../../../hooks/use-org-permissions'

/**
 * Community listing detail route (AGL-95/419): the app owns only the
 * Dashboard chrome — the listing content is the community plugin's
 * 'communityListing' widget (the app never imports the plugin).
 */
const CommunityListingDetail: NextPageWithLayout<Record<string, never>> = () => {
  const hostId = useHostId()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const params = useParams<{ listingId: string }>()
  const listingId = String(params.listingId ?? '')
  const { permissions } = useOrgPermissions()

  return (
    <DashboardLayout
      navTabItems={hostNavTabItems(orgSlug, host)}
      breadcrumbItems={[
        {
          children: <HostDisplayNameComponent hostId={hostId} />,
          href: buildRoute(Route.HOST_DASHBOARD, { orgSlug,  host }),
        },
        {
          children: 'Community',
          href: buildRoute(Route.HOST_COMMUNITY, { orgSlug,  host }),
        },
        {
          children: 'Listing',
          href: buildRoute(Route.HOST_COMMUNITY_LISTING, { orgSlug,  host, listingId }),
        },
      ]}
      header={{
        children: 'Community listing',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <PluginWidgetSlot
        slot="communityListing"
        hostId={hostId}
        listingId={listingId}
        permissions={permissions}
      />
    </DashboardLayout>
  )
}
CommunityListingDetail.displayName = 'Page:CommunityListingDetail'

export default CommunityListingDetail
