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

import { mdiAccountMultipleOutline } from '@aglyn/shared-data-mdi'
import { Container, GridItems } from '@aglyn/shared-ui-jsx'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import OrgActivityCard from '../../../../components/org-activity-card.component'
import OrgMembersCard from '../../../../components/org-members-card.component'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import useOrgPermissions from '../../../../hooks/use-org-permissions'
import OrgRolesCard from '../../../../components/org-roles-card.component'

/**
 * Organization team page (AGL-234/238): the org roster with roles,
 * invites and per-site access is the only membership system — the legacy
 * manager-seat and custom-role cards (AGL-108/133) retired with the
 * tenants collection. Per-site collaborators can also be added from a
 * site's own Users card, which grants org membership scoped to that site.
 */
const ManageTeam: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { currentOrg } = useOrgScope()
  const { can, loaded: permissionsLoaded } = useOrgPermissions()
  return (
    <>
      <NextPageTitle screen={'Team'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        activeTab={buildRoute(Route.MANAGE_TEAM, { orgSlug })}
        breadcrumbItems={[
          {
            children: 'Team',
            href: buildRoute(Route.MANAGE_TEAM, { orgSlug }),
          },
        ]}
        help="team"
        header={{
          children: 'Team',
          icon: { path: mdiAccountMultipleOutline.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <GridItems
            spacing={3}
            items={[
              {
                size: { xs: 12 },
                children: <OrgMembersCard />,
              },
              {
                size: { xs: 12 },
                children: <OrgRolesCard />,
              },
              // Activity is permission-gated (AGL-243, org.auditLog).
              ...(currentOrg?.$id &&
              (!permissionsLoaded || can('org.auditLog'))
                ? [
                    {
                      size: { xs: 12 },
                      children: <OrgActivityCard orgId={currentOrg.$id} />,
                    },
                  ]
                : []),
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
ManageTeam.displayName = 'Page:ManageTeam'

export default ManageTeam
