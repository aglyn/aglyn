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

import { mdiStorefrontOutline } from '@aglyn/shared-data-mdi'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert } from '@mui/material'
import { useParams } from 'next/navigation'
import { useMemo } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Container } from '@aglyn/shared-ui-jsx'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import PluginWidgetSlot from '../../../../../components/plugin-widget-slot.component'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { useOrgHosts } from '../../../../../hooks/use-org-hosts'
import { useOrgScope, useOrgSlug } from '../../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'

/**
 * Org marketplace listing detail (AGL-772): the org-scope counterpart of the
 * per-site listing page. The app owns the Dashboard chrome; the body is the
 * community plugin's `communityListing` widget, rendered with `orgScoped` so
 * its links resolve to the org marketplace. Install pins validate against a
 * site, so the detail acts through the org's first site until targeting
 * lands (AGL-773).
 */
const OrgMarketplaceListing: NextPageWithLayout<Record<string, never>> = () => {
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { permissions } = useOrgPermissions()
  const params = useParams<{ listingId: string }>()
  const listingId = String(params.listingId ?? '')

  const { hosts } = useOrgHosts(
    firestore,
    user?.uid,
    loading ? undefined : (currentOrg?.$id ?? null),
  )
  const hostList = useMemo(
    () =>
      ((hosts as Array<{ $id: string; subdomain?: string; displayName?: string }>) ??
        []).map((host) => ({
        id: host.$id,
        label: host.displayName || host.subdomain || host.$id,
      })),
    [hosts],
  )
  // Install pins resolve the org from a site, so org-scope installs still
  // act through the first site; the picker (AGL-773) chooses the real targets.
  const actingHost = hostList[0]?.id ?? ''

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Marketplace',
          href: buildRoute(Route.ORG_MARKETPLACE, { orgSlug }),
        },
        {
          children: 'Listing',
          href: buildRoute(Route.ORG_MARKETPLACE_LISTING, {
            orgSlug,
            listingId,
          }),
        },
      ]}
      header={{
        children: 'Marketplace listing',
        icon: { path: mdiStorefrontOutline.path },
      }}
    >
      {!actingHost ? (
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <Alert severity="info">
            {'Add a site to your organization to view and install marketplace ' +
              'items.'}
          </Alert>
        </Container>
      ) : (
        <PluginWidgetSlot
          slot="communityListing"
          hostId={actingHost}
          listingId={listingId}
          permissions={permissions}
          orgScoped
          hosts={hostList}
        />
      )}
    </DashboardLayout>
  )
}
OrgMarketplaceListing.displayName = 'Page:OrgMarketplaceListing'

export default OrgMarketplaceListing
