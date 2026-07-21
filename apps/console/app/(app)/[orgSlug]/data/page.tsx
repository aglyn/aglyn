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
import { Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { Alert } from '@mui/material'
import FeatureGate from '../../../../components/feature-gate.component'
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useCurrentOrg from '../../../../hooks/use-current-org'

/**
 * Organization Data page (AGL-239): datasets are org-owned (AGL-237 §11)
 * and shared by every site, so their home is the org area — the host
 * Data page shows the same collections in host context.
 */
const OrgData: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { currentOrg, loading } = useOrgScope()
  const { org } = useCurrentOrg()
  return (
    <>
      <NextPageTitle screen={'Data – Organization'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.ORG_DATA, { orgSlug })}
        breadcrumbItems={[
          { children: 'Data', href: buildRoute(Route.ORG_DATA, { orgSlug }) },
        ]}
        help="datasets"
        header={{
          children: 'Organization Data',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {!loading && !currentOrg ? (
            <Alert severity="info">
              {'Create your first site to start an organization, or accept ' +
                'a pending invite from your dashboard.'}
            </Alert>
          ) : currentOrg?.$id ? (
            <FeatureGate flag="release_data_store">
              <PluginWidgetSlot
                slot="orgData"
                orgId={currentOrg.$id}
                org={org}
              />
            </FeatureGate>
          ) : null}
        </Container>
      </DashboardLayout>
    </>
  )
}
OrgData.displayName = 'Page:OrgData'

export default OrgData
